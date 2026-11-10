// 所有写操作。每次修改都更新 updatedAt（严格递增），删除一律打墓碑。
import { db } from './db';
import { SettingsSchema, type Card, type Clip, type Deck, type Encounter, type Text, type Note, type ReviewLog, type Settings } from '../schema';
import { addDaysToDay, bumpIso, dayStartMs, fromIso, nextDayStartMs, setTimeZone, studyDay, toIso } from '../lib/time';
import { relativeOverdue } from '../srs/queue';
import { newId } from '../lib/id';
import { paramsFor, schedule, type Rating } from '../srs/scheduler';
import { replayMemory, validWeights } from '../srs/fsrs';

// ---------- 设置 ----------

const SETTINGS_KEY = 'settings';

/** 未改过的默认设置用 1970 作为修改时间：同步时远端任何设置都会胜出 */
export const defaultSettings = (): Settings => SettingsSchema.parse({ updatedAt: toIso(0) });

export async function getSettings(): Promise<Settings> {
  const v = (await db.meta.get(SETTINGS_KEY))?.value;
  const s = v ? SettingsSchema.parse(v) : defaultSettings();
  // 学习日的时区：读设置时生效，之后所有按天的计算都用它
  setTimeZone(s.timeZone);
  return s;
}
export const putSettingsRaw = (s: Settings) => db.meta.put({ key: SETTINGS_KEY, value: s });
export async function updateSettings(patch: Partial<Omit<Settings, 'updatedAt'>>) {
  const cur = await getSettings();
  await putSettingsRaw(SettingsSchema.parse({ ...cur, ...patch, updatedAt: bumpIso(cur.updatedAt) }));
}

// ---------- 牌组 ----------

export async function createDeck(name: string): Promise<string> {
  const decks = await db.decks.toArray();
  const id = newId();
  await db.decks.put({ id, name: name.trim() || '新牌组', order: Math.max(-1, ...decks.map((d) => d.order)) + 1, updatedAt: toIso(Date.now()), deleted: false });
  return id;
}

export async function setDeckLangs(id: string, patch: Partial<Pick<Deck, 'sourceLang' | 'targetLang1' | 'targetLang2'>>) {
  const d = await db.decks.get(id);
  if (d) await db.decks.put({ ...d, ...patch, updatedAt: bumpIso(d.updatedAt) });
}

export async function renameDeck(id: string, name: string) {
  const d = await db.decks.get(id);
  if (d) await db.decks.put({ ...d, name: name.trim() || d.name, updatedAt: bumpIso(d.updatedAt) });
}

/** 删除牌组及其所有笔记、卡片（墓碑） */
export async function deleteDeck(id: string) {
  await db.transaction('rw', [db.decks, db.notes, db.cards], async () => {
    const d = await db.decks.get(id);
    if (d) await db.decks.put({ ...d, deleted: true, updatedAt: bumpIso(d.updatedAt) });
    const notes = await db.notes.where('deckId').equals(id).toArray();
    await tombstoneNotes(notes.map((n) => n.id));
  });
}

/**
 * 把一个牌组合并进另一个：笔记和卡片改归属（调度进度、日志原样保留），源牌组打墓碑。
 * 返回移动的笔记数。
 */
export async function mergeDeck(fromId: string, toId: string): Promise<number> {
  if (fromId === toId) return 0;
  return db.transaction('rw', [db.decks, db.notes, db.cards], async () => {
    const [from, to] = await db.decks.bulkGet([fromId, toId]);
    if (!from || !to || to.deleted) throw new Error('目标牌组不存在');
    const notes = await db.notes.where('deckId').equals(fromId).toArray();
    await db.notes.bulkPut(notes.map((n) => ({ ...n, deckId: toId, updatedAt: bumpIso(n.updatedAt) })));
    const cards = await db.cards.where('deckId').equals(fromId).toArray();
    await db.cards.bulkPut(cards.map((c) => ({ ...c, deckId: toId, updatedAt: bumpIso(c.updatedAt) })));
    await db.decks.put({ ...from, deleted: true, updatedAt: bumpIso(from.updatedAt) });
    return notes.filter((n) => !n.deleted).length;
  });
}

/** 没有任何牌组时建一个默认牌组 */
export async function ensureDeck(): Promise<string> {
  const live = (await db.decks.toArray()).filter((d) => !d.deleted).sort((a, b) => a.order - b.order);
  return live[0]?.id ?? createDeck('默认');
}

// ---------- 笔记与卡片 ----------

type NoteContent = Pick<Note, 'lemma' | 'sentence' | 'meaningZh' | 'meaningEn' | 'cueFamily' | 'promptFr' | 'intentZh' | 'hint' | 'clozeHint' | 'clozeSentence' | 'etymology' | 'answerFr' | 'extra' | 'source' | 'origin' | 'layer' | 'cardTypes' | 'tags' | 'altSentences' | 'altIntents' | 'contrastGroup' | 'contrastNote' | 'frame' | 'usage' | 'cluster'>;
export type NewNoteInput = { deckId: string; createdAtMs?: number } & Partial<NoteContent>;

export function blankCard(note: Pick<Note, 'id' | 'deckId' | 'createdAt'>, type: Card['type'], s: Settings, stamp: string): Card {
  return {
    id: newId(), noteId: note.id, deckId: note.deckId, createdAt: note.createdAt, type,
    state: 'new', due: note.createdAt, interval: 0, ease: s.startingEase, reps: 0, lapses: 0, step: 0,
    lastReviewedAt: null, isLeech: false, suspended: false, updatedAt: stamp, deleted: false,
  };
}

export async function addNote(input: NewNoteInput): Promise<{ noteId: string; cardId: string }> {
  const ids = await addNotes([input]);
  return ids[0];
}

/** 新建笔记，并按 cardTypes 生成卡片 */
export async function addNotes(inputs: NewNoteInput[]): Promise<Array<{ noteId: string; cardId: string }>> {
  const s = await getSettings();
  const now = Date.now();
  const stamp = toIso(now);
  const notes: Note[] = [];
  const cards: Card[] = [];
  for (const input of inputs) {
    const note: Note = {
      id: newId(), deckId: input.deckId, createdAt: toIso(input.createdAtMs ?? now),
      lemma: (input.lemma ?? '').trim(), sentence: (input.sentence ?? '').trim(),
      meaningZh: input.meaningZh ?? '', meaningEn: input.meaningEn ?? '',
      cueFamily: input.cueFamily ?? null, promptFr: input.promptFr?.trim() || null, intentZh: input.intentZh ?? null, hint: input.hint ?? null, clozeHint: input.clozeHint ?? null, clozeSentence: input.clozeSentence?.trim() || null, etymology: input.etymology ?? null, answerFr: input.answerFr ?? null,
      extra: input.extra ?? null, source: input.source ?? null, origin: input.origin ?? null,
      altSentences: input.altSentences ?? [], altIntents: input.altIntents ?? [],
      layer: input.layer ?? 'mid', cardTypes: input.cardTypes ?? ['recognition'], tags: input.tags ?? [],
      usedCount: 0, usedAt: [], rot: 0, contrastGroup: input.contrastGroup ?? null, contrastNote: input.contrastNote ?? null, frame: input.frame ?? null, legacy: null, updatedAt: stamp, deleted: false,
      ...(input.usage ? { usage: input.usage } : {}), ...(input.cluster?.trim() ? { cluster: input.cluster.trim() } : {}),
    };
    notes.push(note);
    for (const t of note.cardTypes) cards.push(blankCard(note, t, s, stamp));
  }
  await db.transaction('rw', [db.notes, db.cards], async () => {
    await db.notes.bulkPut(notes);
    await db.cards.bulkPut(cards);
  });
  return notes.map((n) => ({ noteId: n.id, cardId: cards.find((c) => c.noteId === n.id)!.id }));
}

/**
 * 让笔记的卡片和 cardTypes 一致：缺的补上（之前删掉过的同类卡直接恢复，进度保留），多的打墓碑；
 * 牌组、创建时间同步到卡片。必须在包含 notes、cards、meta 的事务里调用。
 */
async function reconcileCards(note: Note) {
  const s = await getSettings();
  const cards = await db.cards.where('noteId').equals(note.id).toArray();
  const puts: Card[] = [];
  for (const type of note.cardTypes) {
    const live = cards.find((c) => c.type === type && !c.deleted);
    const dead = cards.find((c) => c.type === type && c.deleted);
    if (!live) puts.push(dead ? { ...dead, deleted: false, updatedAt: bumpIso(dead.updatedAt) } : blankCard(note, type, s, toIso(Date.now())));
  }
  for (const c of cards) {
    if (c.deleted) continue;
    const keep = note.cardTypes.includes(c.type);
    const moved = c.deckId !== note.deckId || c.createdAt !== note.createdAt;
    if (!keep || moved) puts.push({ ...c, deleted: !keep, deckId: note.deckId, createdAt: note.createdAt, updatedAt: bumpIso(c.updatedAt) });
  }
  for (const p of puts) { p.deckId = note.deckId; p.createdAt = note.createdAt; }
  if (puts.length) await db.cards.bulkPut(puts);
}

/** 修改笔记；卡型、牌组、创建时间的变化同步到它的卡片 */
export async function updateNote(id: string, patch: Partial<Omit<Note, 'id' | 'updatedAt' | 'deleted'>>) {
  await db.transaction('rw', [db.notes, db.cards, db.meta], async () => {
    const n = await db.notes.get(id);
    if (!n) return;
    const next = { ...n, ...patch, updatedAt: bumpIso(n.updatedAt) };
    await db.notes.put(next);
    if (next.deckId !== n.deckId || next.createdAt !== n.createdAt || next.cardTypes.join() !== n.cardTypes.join()) await reconcileCards(next);
  });
}

// ---------- 易混组 ----------

const withContrast = (types: Note['cardTypes'], on: boolean): Note['cardTypes'] =>
  on ? (types.includes('contrast') ? types : [...types, 'contrast']) : types.filter((t) => t !== 'contrast');

/** 把几条笔记设成一个易混组（已经在别的组里的，整组并进来）；每条笔记生成一张辨析卡。
 *  没有带 {{…}} 例句的笔记出不了辨析卡，跳过。返回进组的笔记数 */
export async function groupContrast(noteIds: string[]): Promise<number> {
  return db.transaction('rw', [db.notes, db.cards, db.meta], async () => {
    const picked = (await db.notes.bulkGet(noteIds)).filter((n): n is Note => !!n && !n.deleted && /\{\{.+?\}\}/.test(n.sentence));
    const groups = new Set(picked.map((n) => n.contrastGroup).filter((g): g is string => !!g));
    const members = new Map(picked.map((n) => [n.id, n]));
    if (groups.size) for (const n of await db.notes.toArray()) if (!n.deleted && n.contrastGroup && groups.has(n.contrastGroup)) members.set(n.id, n);
    if (members.size < 2) return 0;
    const gid = [...groups][0] ?? newId();
    for (const n of members.values()) await updateNote(n.id, { contrastGroup: gid, cardTypes: withContrast(n.cardTypes, true) });
    return members.size;
  });
}

/** 移出易混组；组里只剩一条时整组解散（辨析卡打墓碑，复习记录保留） */
export async function leaveContrast(noteId: string) {
  await db.transaction('rw', [db.notes, db.cards, db.meta], async () => {
    const n = await db.notes.get(noteId);
    if (!n?.contrastGroup) return;
    const gid = n.contrastGroup;
    await updateNote(noteId, { contrastGroup: null, cardTypes: withContrast(n.cardTypes, false) });
    await dissolveIfAlone(gid);
  });
}

async function dissolveIfAlone(gid: string) {
  const rest = (await db.notes.toArray()).filter((x) => !x.deleted && x.contrastGroup === gid);
  if (rest.length === 1) await updateNote(rest[0].id, { contrastGroup: null, cardTypes: withContrast(rest[0].cardTypes, false) });
}

/** 产出表达在写作、口语里用上了一次 */
export const bumpUsed = (noteId: string) =>
  updateNotes([noteId], (n) => ({ usedCount: n.usedCount + 1, usedAt: [...(n.usedAt ?? []), toIso(Date.now())] }));

/** 批量修改：放在一个事务里，界面和同步计数只刷新一次（原来每条笔记各一次） */
export async function updateNotes(ids: string[], fn: (n: Note) => Partial<Note>) {
  await db.transaction('rw', [db.notes, db.cards, db.meta], async () => {
    for (const n of await db.notes.bulkGet(ids)) if (n) await updateNote(n.id, fn(n));
  });
}

async function tombstoneNotes(ids: string[]) {
  const notes = (await db.notes.bulkGet(ids)).filter((n): n is Note => !!n);
  await db.notes.bulkPut(notes.map((n) => ({ ...n, deleted: true, updatedAt: bumpIso(n.updatedAt) })));
  const cards = await db.cards.where('noteId').anyOf(ids).toArray();
  await db.cards.bulkPut(cards.map((c) => ({ ...c, deleted: true, updatedAt: bumpIso(c.updatedAt) })));
}

/** 删除笔记；它所在的易混组只剩一条时解散 */
export const deleteNotes = (ids: string[]) => db.transaction('rw', [db.notes, db.cards, db.meta], async () => {
  const groups = new Set((await db.notes.bulkGet(ids)).map((n) => n?.contrastGroup).filter((g): g is string => !!g));
  await tombstoneNotes(ids);
  for (const g of groups) await dissolveIfAlone(g);
});

export async function updateCards(ids: string[], fn: (c: Card) => Partial<Card>) {
  await db.transaction('rw', db.cards, async () => {
    const cards = (await db.cards.bulkGet(ids)).filter((c): c is Card => !!c);
    await db.cards.bulkPut(cards.map((c) => ({ ...c, ...fn(c), updatedAt: bumpIso(c.updatedAt) })));
  });
}

export const cardsOfNotes = async (noteIds: string[]) => (await db.cards.where('noteId').anyOf(noteIds).toArray()).filter((c) => !c.deleted);

/** 重置为新卡（复习日志保留） */
export async function resetNotes(noteIds: string[]) {
  const s = await getSettings();
  const cards = await cardsOfNotes(noteIds);
  await updateCards(cards.map((c) => c.id), (c) => ({
    state: 'new', due: c.createdAt, interval: 0, ease: s.startingEase, reps: 0, lapses: 0, step: 0, isLeech: false, suspended: false,
  }));
}

export async function setSuspended(noteIds: string[], suspended: boolean) {
  const cards = await cardsOfNotes(noteIds);
  // 解除暂停时一并移出"待改造"
  await updateCards(cards.map((c) => c.id), () => (suspended ? { suspended } : { suspended, isLeech: false }));
}

/** 分散积压：把今天之前就到期的复习卡，均匀改到「今天起 days 天」内到期。
 *  最危险的（遗忘多、倍率低、相对逾期大）排在最前面；间隔和倍率不变。返回改动张数。 */
export async function spreadBacklog(days: number, deckId?: string, now = Date.now()): Promise<number> {
  const s = await getSettings();
  const today = studyDay(now, s.dayStartHour);
  const todayStart = dayStartMs(today, s.dayStartHour);
  const all = await db.cards.toArray();
  const backlog = all
    .filter((c) => !c.deleted && !c.suspended && c.state === 'review' && fromIso(c.due) < todayStart && (!deckId || c.deckId === deckId))
    .sort((a, b) => b.lapses - a.lapses || a.ease - b.ease || relativeOverdue(b, now) - relativeOverdue(a, now));
  const n = backlog.length;
  const span = Math.max(1, Math.floor(days));
  const dueOf = new Map(backlog.map((c, i) => [c.id, toIso(dayStartMs(addDaysToDay(today, Math.floor((i * span) / n)), s.dayStartHour))]));
  await updateCards([...dueOf.keys()], (c) => ({ due: dueOf.get(c.id)! }));
  return n;
}

// ---------- 复习 ----------

export interface AnswerResult {
  before: Card;
  after: Card;
  logId: string;
  leechNow: boolean;
  /** 产出卡答对时顺带给认读卡记的隐性复习（撤销时一起恢复） */
  implicit?: { before: Card; logId: string } | null;
}

export async function answerCard(cardId: string, rating: Rating, opts: { now?: number; elapsedMs?: number | null } = {}): Promise<AnswerResult> {
  const now = opts.now ?? Date.now();
  const s = await getSettings();
  return db.transaction('rw', [db.cards, db.logs], async () => {
    const before = await db.cards.get(cardId);
    if (!before) throw new Error('卡片不存在');
    // FSRS：这张卡的记忆状态从它的全部日志重放
    const mem = s.scheduler === 'fsrs' ? replayMemory(validWeights(s.fsrsWeights), await db.logs.where('cardId').equals(cardId).toArray(), before, s.dayStartHour) : null;
    const r = schedule(before, rating, now, paramsFor(before.type, s), Math.random, mem);
    const after: Card = { ...r.card, updatedAt: bumpIso(before.updatedAt, now) };
    const log: ReviewLog = {
      id: newId(), cardId, noteId: before.noteId, ts: toIso(now), day: studyDay(now, s.dayStartHour), rating,
      prevState: before.state, newState: after.state,
      prevInterval: before.interval, newInterval: after.interval,
      prevEase: before.ease, newEase: after.ease,
      prevDue: before.due, newDue: after.due,
      elapsedMs: opts.elapsedMs ?? null, source: 'app', implicit: false,
      updatedAt: toIso(now), deleted: false,
    };
    await db.cards.put(after);
    await db.logs.put(log);
    const implicit = rating >= 3 && before.type === 'production' && s.implicitRecognitionCredit !== false
      ? await creditRecognition(before.noteId, now, s) : null;
    return { before, after, logId: log.id, leechNow: r.leechNow, implicit };
  });
}

/**
 * 写得出来就一定认得：产出卡答对时，同一条笔记已在复习中的认读卡记一次隐性「良好」，下次复习往后推。
 * 只往后推，不会提前；今天已经复习过这张认读卡就不记。在 answerCard 的事务里调用
 */
async function creditRecognition(noteId: string, now: number, s: Settings): Promise<{ before: Card; logId: string } | null> {
  const rec = (await db.cards.where('noteId').equals(noteId).toArray())
    .find((c) => c.type === 'recognition' && !c.deleted && !c.suspended && c.state === 'review');
  return rec ? creditImplicit(rec, 3, now, s) : null;
}

/** 给一张在复习中的卡记一次隐性评分：只往后推、不提前；今天已复习过就不记。在调用方的事务里执行 */
async function creditImplicit(card: Card, rating: Rating, now: number, s: Settings): Promise<{ before: Card; logId: string } | null> {
  const today = studyDay(now, s.dayStartHour);
  if (card.lastReviewedAt && studyDay(fromIso(card.lastReviewedAt), s.dayStartHour) === today) return null;
  const logs = await db.logs.where('cardId').equals(card.id).toArray();
  const mem = s.scheduler === 'fsrs' ? replayMemory(validWeights(s.fsrsWeights), logs, card, s.dayStartHour) : null;
  const r = schedule(card, rating, now, paramsFor(card.type, s), Math.random, mem);
  if (fromIso(r.card.due) <= fromIso(card.due)) return null;
  const after: Card = { ...r.card, updatedAt: bumpIso(card.updatedAt, now) };
  const log: ReviewLog = {
    id: newId(), cardId: card.id, noteId: card.noteId, ts: toIso(now), day: today, rating,
    prevState: card.state, newState: after.state, prevInterval: card.interval, newInterval: after.interval,
    prevEase: card.ease, newEase: after.ease, prevDue: card.due, newDue: after.due,
    elapsedMs: null, source: 'app', implicit: true, updatedAt: toIso(now), deleted: false,
  };
  await db.cards.put(after);
  await db.logs.put(log);
  return { before: card, logId: log.id };
}

export interface ClusterOutcome {
  /** credited：往后推了；pulled：提前到明天；kept：没动（今天已复习、已经排得够远、明天本来就到期、或还没有在复习中的卡） */
  kind: 'credited' | 'pulled' | 'kept';
  /** 动的是哪张卡：有在复习中的产出卡就是产出卡，否则认读卡 */
  type: Card['type'] | null;
  from: string | null;
  to: string | null;
  /** 这条笔记累计没想起来的次数（最近 10 次以内） */
  misses: number;
  hasProduction: boolean;
}

/**
 * 表达群的纯回忆（只告诉还有几种说法，不给任何提示）：
 * - 想起来了 → 产出卡（没有在复习中的产出卡就用认读卡）记一次隐性「困难」：自评、非正式出卡，保守地只往后推一点
 * - 没想起来 → 同一张卡提前到明天到期，不写复习记录（FSRS 只看到明天那次正常复习）；并在笔记上记下日期
 */
export async function clusterRecall(noteId: string, recalled: boolean): Promise<ClusterOutcome> {
  const now = Date.now();
  const s = await getSettings();
  return db.transaction('rw', [db.cards, db.logs, db.notes], async () => {
    const cards = (await db.cards.where('noteId').equals(noteId).toArray()).filter((c) => !c.deleted && !c.suspended);
    const target = cards.find((c) => c.type === 'production' && c.state === 'review')
      ?? cards.find((c) => c.type === 'recognition' && c.state === 'review');
    const hasProduction = cards.some((c) => c.type === 'production');
    const n = await db.notes.get(noteId);
    let misses = n?.recallMisses?.length ?? 0;
    const out = (kind: ClusterOutcome['kind'], to: string | null = null): ClusterOutcome =>
      ({ kind, type: target?.type ?? null, from: target?.due ?? null, to, misses, hasProduction });
    if (recalled) {
      if (!target) return out('kept');
      const r = await creditImplicit(target, 2, now, s);
      return r ? out('credited', (await db.cards.get(target.id))!.due) : out('kept');
    }
    if (n) {
      const day = studyDay(now, s.dayStartHour);
      const list = [...(n.recallMisses ?? []).filter((d) => d !== day), day].slice(-10);
      misses = list.length;
      await db.notes.put({ ...n, recallMisses: list, updatedAt: bumpIso(n.updatedAt, now) });
    }
    if (!target) return out('kept');
    const tomorrow = nextDayStartMs(now, s.dayStartHour);
    if (fromIso(target.due) < dayStartMs(addDaysToDay(studyDay(now, s.dayStartHour), 2), s.dayStartHour)) return out('kept');
    const due = toIso(tomorrow);
    await db.cards.put({ ...target, due, updatedAt: bumpIso(target.updatedAt, now) });
    return out('pulled', due);
  });
}

/** 撤销：卡片恢复到作答前（用更新的 updatedAt 才能在同步时胜出），日志打墓碑 */
export async function undoAnswer(res: Pick<AnswerResult, 'before' | 'logId'> & Partial<Pick<AnswerResult, 'implicit'>>) {
  await db.transaction('rw', [db.cards, db.logs], async () => {
    for (const x of [res, res.implicit].filter((y): y is { before: Card; logId: string } => !!y)) {
      const cur = await db.cards.get(x.before.id);
      await db.cards.put({ ...x.before, updatedAt: bumpIso(cur?.updatedAt ?? x.before.updatedAt) });
      const log = await db.logs.get(x.logId);
      if (log) await db.logs.put({ ...log, deleted: true, updatedAt: bumpIso(log.updatedAt) });
    }
  });
}

// ---------- 其他 ----------

export const ONBOARDED_KEY = 'onboarded';
export const markOnboarded = () => db.meta.put({ key: ONBOARDED_KEY, value: true });

/** 清空本地数据；保留同步设置（令牌） */
export async function clearAllLocalData() {
  await db.transaction('rw', [db.decks, db.notes, db.cards, db.logs, db.clips, db.texts, db.encounters, db.known, db.meta], async () => {
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.logs.clear(), db.clips.clear(), db.texts.clear(), db.encounters.clear(), db.known.clear()]);
    await db.meta.bulkDelete([SETTINGS_KEY, 'syncState', ONBOARDED_KEY]);
  });
}

// ---------- 摘句篮 ----------

export interface NewClip { kind: Clip['kind']; text: string; context?: string; translation?: string; gloss?: string; source?: string | null; textId?: string | null }
/** 放进摘句篮。同一个词（或整句）在同一句里已经在篮子里待做时不重复放，返回已有那条 */
export async function addClip(input: NewClip): Promise<{ id: string; existed: boolean }> {
  const text = input.text.trim();
  const context = (input.context ?? '').trim();
  const same = (await db.clips.where('status').equals('todo').toArray())
    .find((c) => !c.deleted && c.text.toLowerCase() === text.toLowerCase() && c.context === context);
  if (same) return { id: same.id, existed: true };
  const stamp = toIso(Date.now());
  const clip: Clip = {
    id: newId(), createdAt: stamp, updatedAt: stamp, deleted: false, kind: input.kind, text, context,
    translation: input.translation ?? '', gloss: input.gloss ?? '', source: input.source ?? null, status: 'todo', noteId: null, textId: input.textId ?? null,
  };
  await db.clips.put(clip);
  return { id: clip.id, existed: false };
}

export async function updateClip(id: string, patch: Partial<Pick<Clip, 'status' | 'noteId' | 'translation' | 'gloss' | 'text' | 'context'>>) {
  const cur = await db.clips.get(id);
  if (!cur) return;
  await db.clips.put({ ...cur, ...patch, updatedAt: bumpIso(cur.updatedAt) });
}

/** 删除（墓碑，同步时传播到其他设备） */
export async function deleteClip(id: string) {
  const cur = await db.clips.get(id);
  if (cur) await db.clips.put({ ...cur, deleted: true, updatedAt: bumpIso(cur.updatedAt) });
}

// ---------- 阅读 ----------

export async function addText(input: { title: string; source?: string | null; body: string; cues?: Text['cues'] }): Promise<string> {
  const stamp = toIso(Date.now());
  const t: Text = {
    id: newId(), createdAt: stamp, updatedAt: stamp, deleted: false, title: input.title.trim() || '未命名',
    source: input.source?.trim() || null, body: input.body, cues: input.cues ?? [], summary: '',
  };
  await db.texts.put(t);
  return t.id;
}
export async function updateText(id: string, patch: Partial<Pick<Text, 'title' | 'source' | 'summary' | 'body' | 'cues'>>) {
  const cur = await db.texts.get(id);
  if (cur) await db.texts.put({ ...cur, ...patch, updatedAt: bumpIso(cur.updatedAt) });
}
export async function deleteText(id: string) {
  const cur = await db.texts.get(id);
  if (cur) await db.texts.put({ ...cur, deleted: true, updatedAt: bumpIso(cur.updatedAt) });
}

/** 记一次遇见；同一个词在同一句里只记一次。返回这个词一共遇见过几次（不同的句子） */
export async function recordEncounter(input: { key: string; form: string; sentence: string; textId?: string | null; source?: string | null }): Promise<Encounter[]> {
  const key = input.key.toLowerCase().trim();
  // 读和写放在一个事务里：同时打开两次（开发模式下 effect 会跑两遍）也只记一条
  return db.transaction('rw', db.encounters, async () => {
    const all = (await db.encounters.where('key').equals(key).toArray()).filter((e) => !e.deleted);
    if (!key || all.some((e) => e.sentence === input.sentence)) return all;
    const stamp = toIso(Date.now());
    const e: Encounter = { id: newId(), createdAt: stamp, updatedAt: stamp, deleted: false, key, form: input.form, sentence: input.sentence, textId: input.textId ?? null, source: input.source ?? null };
    await db.encounters.put(e);
    return [...all, e];
  });
}

/** 手动标为认识 / 取消（取消是墓碑，同步到其他设备） */
export async function setKnown(key: string, known: boolean) {
  const id = key.toLowerCase().trim();
  if (!id) return;
  const cur = await db.known.get(id);
  if (known && cur && !cur.deleted) return;
  if (!known && (!cur || cur.deleted)) return;
  await db.known.put({ id, deleted: !known, updatedAt: cur ? bumpIso(cur.updatedAt) : toIso(Date.now()) });
}

export type { Deck };
