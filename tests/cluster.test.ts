import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { addNotes, clearAllLocalData, clusterRecall, getSettings } from '../src/db/actions';
import { fromIso, nextDayStartMs, studyDay, toIso } from '../src/lib/time';
import type { Card } from '../src/schema';

const DAY = 86_400_000;

async function seed(cardTypes: Card['type'][]) {
  const [r] = await addNotes([{
    deckId: 'd', lemma: 'sidéré', sentence: 'Je suis resté {{sidéré}}.', cluster: '惊呆了', cardTypes,
    ...(cardTypes.includes('production') ? { promptFr: 'Je suis resté {{sans voix}}.', answerFr: 'Je suis resté {{sidéré}}.', intentZh: '惊呆' } : {}),
  }]);
  return r.noteId;
}
async function setReview(noteId: string, type: Card['type'], dueInDays: number) {
  const c = (await db.cards.where('noteId').equals(noteId).toArray()).find((x) => x.type === type)!;
  const now = Date.now();
  const card = { ...c, state: 'review' as const, interval: 10, reps: 3, due: toIso(now + dueInDays * DAY), lastReviewedAt: toIso(now - 6 * DAY) };
  await db.cards.put(card);
  return card;
}

describe('表达群（纯回忆）', () => {
  beforeEach(async () => { await clearAllLocalData(); });

  it('新建笔记保留用法和表达群', async () => {
    const [r] = await addNotes([{ deckId: 'd', lemma: 'nombre de', sentence: '{{Nombre d\'}}étudiants.', usage: 'nombre de + 复数名词：很多', cluster: '说「很多」' }]);
    expect(await db.notes.get(r.noteId)).toMatchObject({ usage: 'nombre de + 复数名词：很多', cluster: '说「很多」' });
  });

  it('想起来了：有产出卡就推产出卡，按「困难」记一次隐性评分，同一天不重复', async () => {
    const id = await seed(['recognition', 'production']);
    await setReview(id, 'recognition', 4);
    const prod = await setReview(id, 'production', 1);
    const r = await clusterRecall(id, true);
    expect(r).toMatchObject({ kind: 'credited', type: 'production', from: prod.due, hasProduction: true });
    expect(fromIso(r.to!)).toBeGreaterThan(fromIso(prod.due));
    expect((await db.logs.toArray())).toEqual([expect.objectContaining({ cardId: prod.id, implicit: true, rating: 2 })]);
    expect((await clusterRecall(id, true)).kind).toBe('kept');
  });

  it('想起来了：没有产出卡就推认读卡', async () => {
    const id = await seed(['recognition']);
    const rec = await setReview(id, 'recognition', 1);
    expect(await clusterRecall(id, true)).toMatchObject({ kind: 'credited', type: 'recognition', from: rec.due, hasProduction: false });
  });

  it('没想起来：那张卡提前到明天，不写复习记录；记下日期，第二次起提示', async () => {
    const id = await seed(['recognition', 'production']);
    const prod = await setReview(id, 'production', 9);
    const s = await getSettings();
    const r = await clusterRecall(id, false);
    const tomorrow = toIso(nextDayStartMs(Date.now(), s.dayStartHour));
    expect(r).toMatchObject({ kind: 'pulled', type: 'production', from: prod.due, to: tomorrow, misses: 1 });
    expect((await db.cards.get(prod.id))!.due).toBe(tomorrow);
    expect(await db.logs.count()).toBe(0);
    expect((await db.notes.get(id))!.recallMisses).toEqual([studyDay(Date.now(), s.dayStartHour)]);
    // 明天本来就到期：不再动；同一天只记一次
    expect(await clusterRecall(id, false)).toMatchObject({ kind: 'kept', misses: 1 });
  });

  it('没想起来：明天前本来就到期的不动', async () => {
    const id = await seed(['recognition']);
    const rec = await setReview(id, 'recognition', 0.5);
    expect((await clusterRecall(id, false)).kind).toBe('kept');
    expect((await db.cards.get(rec.id))!.due).toBe(rec.due);
  });

  it('还没进复习的卡：想起 / 没想起都不动排期', async () => {
    const id = await seed(['recognition']);
    expect(await clusterRecall(id, true)).toMatchObject({ kind: 'kept', type: null });
    expect(await clusterRecall(id, false)).toMatchObject({ kind: 'kept', type: null, misses: 1 });
    expect(await db.logs.count()).toBe(0);
  });
});

describe('表达群的意思', () => {
  it('括号里带法语的去掉，免得露出答案', async () => {
    const { firstMeaning } = await import('../src/features/review/ClusterStrip');
    const n = (meaningZh: string) => ({ meaningZh, meaningEn: 'x' }) as never;
    expect(firstMeaning(n('铺天盖地的指控（un déluge de … 大量的……）'))).toBe('铺天盖地的指控');
    expect(firstMeaning(n('（惊讶得）缓不过神来（ne pas en revenir）'))).toBe('（惊讶得）缓不过神来');
    expect(firstMeaning(n('压倒性的多数；écrasant：压倒性的'))).toBe('压倒性的多数');
  });
});
