// 所有写操作。每次修改都更新 updatedAt（严格递增），删除一律打墓碑。
import { db } from './db';
import { SettingsSchema, type Card, type Deck, type Note, type ReviewLog, type Settings, type Theme } from '../schema';
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

export interface NewNoteInput {
  deckId: string;
  lemma: string;
  createdAtMs?: number;
  tags?: Theme[];
  meaningZh?: string;
  meaningEn?: string;
}

export function blankCard(note: Pick<Note, 'id' | 'deckId' | 'createdAt'>, type: Card['type'], s: Settings, stamp: string): Card {
  return {
    id: newId(), noteId: note.id, deckId: note.deckId, createdAt: note.createdAt, type,
    state: 'new', due: note.createdAt, interval: 0, ease: s.startingEase, reps: 0, lapses: 0, step: 0,
    lastReviewedAt: null, isLeech: false, suspended: false, updatedAt: stamp, deleted: false,
  };
}

export async function addNote(input: NewNoteInput): Promise<{ noteId: string; cardId: string }> {
  const s = await getSettings();
  const now = Date.now();
  const stamp = toIso(now);
  const note: Note = {
    id: newId(), deckId: input.deckId, createdAt: toIso(input.createdAtMs ?? now),
    lemma: input.lemma.trim(), sentence: '', meaningZh: input.meaningZh ?? '', meaningEn: input.meaningEn ?? '',
    cueFamily: null, intentZh: null, hint: null, answerFr: null, extra: null, source: null,
    layer: 'mid', cardTypes: ['recognition'], tags: input.tags ?? [], usedCount: 0, rot: 0, legacy: null,
    updatedAt: stamp, deleted: false,
  };
  const card = blankCard(note, 'recognition', s, stamp);
  await db.transaction('rw', [db.notes, db.cards], async () => {
    await db.notes.put(note);
    await db.cards.put(card);
  });
  return { noteId: note.id, cardId: card.id };
}

/** 修改笔记；牌组或创建时间变了，同步到它的卡片 */
export async function updateNote(id: string, patch: Partial<Omit<Note, 'id' | 'updatedAt' | 'deleted'>>) {
  await db.transaction('rw', [db.notes, db.cards], async () => {
    const n = await db.notes.get(id);
    if (!n) return;
    const next = { ...n, ...patch, updatedAt: bumpIso(n.updatedAt) };
    await db.notes.put(next);
    if (next.deckId !== n.deckId || next.createdAt !== n.createdAt) {
      const cards = await db.cards.where('noteId').equals(id).toArray();
      await db.cards.bulkPut(cards.map((c) => ({ ...c, deckId: next.deckId, createdAt: next.createdAt, updatedAt: bumpIso(c.updatedAt) })));
    }
  });
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
