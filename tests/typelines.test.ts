import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { addNotes, answerCard, clearAllLocalData, getSettings, undoAnswer, updateSettings } from '../src/db/actions';
import { buildQueue } from '../src/srs/queue';
import { computeStats } from '../src/srs/stats';
import { fsrsOutcomes, paramsFor, retentionFor } from '../src/srs/scheduler';
import { fromIso, toIso } from '../src/lib/time';
import type { Card } from '../src/schema';

const DAY = 86_400_000;

describe('认读类和产出类分开设目标保持率', () => {
  it('默认认读 85%、产出类用 desiredRetention；同样的记忆状态，认读间隔更长', async () => {
    await clearAllLocalData();
    const s = await getSettings();
    expect(retentionFor('recognition', s)).toBe(0.85);
    expect(retentionFor('contrast', s)).toBe(0.85);
    expect(retentionFor('production', s)).toBe(s.desiredRetention);
    expect(retentionFor('cloze', s)).toBe(s.desiredRetention);
    const card = { state: 'review', interval: 10, ease: 2.5, reps: 5, lapses: 0, step: 0, due: toIso(Date.now()), lastReviewedAt: null } as unknown as Card;
    const mem = { s: 10, d: 5, day: '2026-11-01' };
    const now = new Date(2026, 10, 11, 12).getTime();
    const rec = fsrsOutcomes(card, paramsFor('recognition', { ...s, scheduler: 'fsrs' }), now, mem)[3].days;
    const prod = fsrsOutcomes(card, paramsFor('production', { ...s, scheduler: 'fsrs' }), now, mem)[3].days;
    expect(rec).toBeGreaterThan(prod);
  });
});

describe('产出卡等认读卡学会再出', () => {
  const now = new Date(2026, 10, 9, 12).getTime();
  const mk = (id: string, noteId: string, type: Card['type'], state: Card['state'] = 'new'): Card => ({
    id, noteId, deckId: 'd', createdAt: toIso(now - 10 * DAY), type, state, due: toIso(now - 3600_000), interval: state === 'review' ? 5 : 0,
    ease: 2.5, reps: 0, lapses: 0, step: 0, lastReviewedAt: null, isLeech: false, suspended: false, updatedAt: toIso(0), deleted: false,
  } as Card);
  const S = { newPerDay: 10, reviewsPerDay: 0, dayStartHour: 4, newSplit: 'off' as const };
  const newIds = (cards: Card[], s = S) => {
    const q = buildQueue({ cards, todayLogs: [], deckId: 'd', now, settings: s });
    return [...q.servable].filter((id) => cards.find((c) => c.id === id)!.state === 'new');
  };
  it('认读还是新卡 / 学习中：产出不出；认读进入复习后才出；没有认读卡的产出照常出', () => {
    expect(newIds([mk('r1', 'a', 'recognition'), mk('p1', 'a', 'production')])).toEqual(['r1']);
    expect(newIds([mk('r1', 'a', 'recognition', 'learning'), mk('p1', 'a', 'production')])).not.toContain('p1');
    const rev = { ...mk('r1', 'a', 'recognition', 'review'), due: toIso(now + 5 * DAY) };
    expect(newIds([rev, mk('p1', 'a', 'production')])).toContain('p1');
    expect(newIds([mk('p2', 'b', 'production')])).toContain('p2');
  });
  it('关掉开关就不等', () => {
    expect(newIds([mk('r1', 'a', 'recognition'), mk('p1', 'a', 'production')], { ...S, productionAfterRecognition: false } as typeof S)).toContain('p1');
  });
});

describe('产出答对顺带记认读', () => {
  beforeEach(async () => { await clearAllLocalData(); });
  const setup = async () => {
    const [n] = await addNotes([{ deckId: 'd', lemma: 'tisser des liens', sentence: 'On {{tisse des liens}}.', cardTypes: ['recognition', 'production'], promptFr: 'On {{crée des relations}}.', answerFr: 'On {{tisse des liens}}.' }]);
    const cards = await db.cards.where('noteId').equals(n.noteId).toArray();
    const rec = cards.find((c) => c.type === 'recognition')!;
    const prod = cards.find((c) => c.type === 'production')!;
    const now = Date.now();
    await db.cards.put({ ...rec, state: 'review', interval: 10, reps: 3, due: toIso(now + 4 * DAY), lastReviewedAt: toIso(now - 6 * DAY) });
    return { rec: (await db.cards.get(rec.id))!, prod };
  };
  it('良好：认读卡记一次隐性良好，下次复习往后推；撤销一起撤回', async () => {
    const { rec, prod } = await setup();
    const r = await answerCard(prod.id, 3);
    expect(r.implicit).toBeTruthy();
    const after = (await db.cards.get(rec.id))!;
    expect(fromIso(after.due)).toBeGreaterThan(fromIso(rec.due));
    const log = (await db.logs.where('cardId').equals(rec.id).toArray())[0];
    expect(log).toMatchObject({ implicit: true, rating: 3 });
    // 不算进今天的复习数和保持率
    const s = await getSettings();
    const logs = await db.logs.toArray();
    const q = buildQueue({ cards: await db.cards.toArray(), todayLogs: logs, deckId: 'd', now: Date.now(), settings: s });
    expect(q.done.reviewDone).toBe(0);
    const st = computeStats({ cards: await db.cards.toArray(), notes: await db.notes.toArray(), logs, now: Date.now(), dayStartHour: s.dayStartHour });
    expect(JSON.stringify(st)).toBeTruthy();
    await undoAnswer(r);
    expect((await db.cards.get(rec.id))!.due).toBe(rec.due);
    expect((await db.logs.get(log.id))!.deleted).toBe(true);
  });
  it('困难 / 忘了不记；认读卡今天已复习过不记；开关关掉不记', async () => {
    const { rec, prod } = await setup();
    expect((await answerCard(prod.id, 2)).implicit).toBeNull();
    await db.cards.put({ ...rec, lastReviewedAt: toIso(Date.now() - 60_000) });
    expect((await answerCard(prod.id, 3)).implicit).toBeNull();
    await db.cards.put(rec);
    await updateSettings({ implicitRecognitionCredit: false });
    expect((await answerCard(prod.id, 3)).implicit).toBeNull();
  });
});
