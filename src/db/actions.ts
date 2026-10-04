// 所有写操作。每次修改都更新 updatedAt（严格递增），删除一律打墓碑。
import { db } from './db';
import { SettingsSchema, type Card, type Deck, type Note, type ReviewLog, type Settings } from '../schema';
import { bumpIso, studyDay, toIso } from '../lib/time';
import { newId } from '../lib/id';
import { schedule, type Rating } from '../srs/scheduler';

// ---------- 设置 ----------

const SETTINGS_KEY = 'settings';

/** 未改过的默认设置用 1970 作为修改时间：同步时远端任何设置都会胜出 */
export const defaultSettings = (): Settings => SettingsSchema.parse({ updatedAt: toIso(0) });

export async function getSettings(): Promise<Settings> {
  const v = (await db.meta.get(SETTINGS_KEY))?.value;
  return v ? SettingsSchema.parse(v) : defaultSettings();
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

/** 没有任何牌组时建一个默认牌组 */
export async function ensureDeck(): Promise<string> {
  const live = (await db.decks.toArray()).filter((d) => !d.deleted).sort((a, b) => a.order - b.order);
  return live[0]?.id ?? createDeck('默认');
}

// ---------- 笔记与卡片 ----------

type NoteContent = Pick<Note, 'lemma' | 'sentence' | 'meaningZh' | 'meaningEn' | 'cueFamily' | 'intentZh' | 'hint' | 'answerFr' | 'extra' | 'source' | 'layer' | 'cardTypes' | 'tags'>;
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
      cueFamily: input.cueFamily ?? null, intentZh: input.intentZh ?? null, hint: input.hint ?? null, answerFr: input.answerFr ?? null,
      extra: input.extra ?? null, source: input.source ?? null,
      layer: input.layer ?? 'mid', cardTypes: input.cardTypes ?? ['recognition'], tags: input.tags ?? [],
      usedCount: 0, usedAt: [], rot: 0, legacy: null, updatedAt: stamp, deleted: false,
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

/** 产出表达在写作、口语里用上了一次 */
export async function bumpUsed(noteId: string) {
  const n = await db.notes.get(noteId);
  if (n) await updateNote(noteId, { usedCount: n.usedCount + 1, usedAt: [...(n.usedAt ?? []), toIso(Date.now())] });
}

export async function updateNotes(ids: string[], fn: (n: Note) => Partial<Note>) {
  for (const id of ids) {
    const n = await db.notes.get(id);
    if (n) await updateNote(id, fn(n));
  }
}

async function tombstoneNotes(ids: string[]) {
  const notes = (await db.notes.bulkGet(ids)).filter((n): n is Note => !!n);
  await db.notes.bulkPut(notes.map((n) => ({ ...n, deleted: true, updatedAt: bumpIso(n.updatedAt) })));
  const cards = await db.cards.where('noteId').anyOf(ids).toArray();
  await db.cards.bulkPut(cards.map((c) => ({ ...c, deleted: true, updatedAt: bumpIso(c.updatedAt) })));
}

export const deleteNotes = (ids: string[]) => db.transaction('rw', [db.notes, db.cards], () => tombstoneNotes(ids));

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

// ---------- 复习 ----------

export interface AnswerResult {
  before: Card;
  after: Card;
  logId: string;
  leechNow: boolean;
}

export async function answerCard(cardId: string, rating: Rating, opts: { now?: number; elapsedMs?: number | null } = {}): Promise<AnswerResult> {
  const now = opts.now ?? Date.now();
  const s = await getSettings();
  return db.transaction('rw', [db.cards, db.logs], async () => {
    const before = await db.cards.get(cardId);
    if (!before) throw new Error('卡片不存在');
    const r = schedule(before, rating, now, s);
    const after: Card = { ...r.card, updatedAt: bumpIso(before.updatedAt, now) };
    const log: ReviewLog = {
      id: newId(), cardId, noteId: before.noteId, ts: toIso(now), day: studyDay(now, s.dayStartHour), rating,
      prevState: before.state, newState: after.state,
      prevInterval: before.interval, newInterval: after.interval,
      prevEase: before.ease, newEase: after.ease,
      prevDue: before.due, newDue: after.due,
      elapsedMs: opts.elapsedMs ?? null, source: 'app',
      updatedAt: toIso(now), deleted: false,
    };
    await db.cards.put(after);
    await db.logs.put(log);
    return { before, after, logId: log.id, leechNow: r.leechNow };
  });
}

/** 撤销：卡片恢复到作答前（用更新的 updatedAt 才能在同步时胜出），日志打墓碑 */
export async function undoAnswer(res: Pick<AnswerResult, 'before' | 'logId'>) {
  await db.transaction('rw', [db.cards, db.logs], async () => {
    const cur = await db.cards.get(res.before.id);
    await db.cards.put({ ...res.before, updatedAt: bumpIso(cur?.updatedAt ?? res.before.updatedAt) });
    const log = await db.logs.get(res.logId);
    if (log) await db.logs.put({ ...log, deleted: true, updatedAt: bumpIso(log.updatedAt) });
  });
}

// ---------- 其他 ----------

export const ONBOARDED_KEY = 'onboarded';
export const markOnboarded = () => db.meta.put({ key: ONBOARDED_KEY, value: true });

/** 清空本地数据；保留同步设置（令牌） */
export async function clearAllLocalData() {
  await db.transaction('rw', [db.decks, db.notes, db.cards, db.logs, db.meta], async () => {
    await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.logs.clear()]);
    await db.meta.bulkDelete([SETTINGS_KEY, 'syncState', ONBOARDED_KEY]);
  });
}

export type { Deck };
