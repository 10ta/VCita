import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { clearAllLocalData, spreadBacklog } from '../src/db/actions';
import type { Card } from '../src/schema';
import { addDaysToDay, fromIso, studyDay, toIso } from '../src/lib/time';

beforeEach(async () => { await clearAllLocalData(); });
const NOW = new Date(2026, 9, 3, 15, 0).getTime();
const DAY = 86400000;
let n = 0;
const card = (over: Partial<Card>): Card => ({
  id: `c${++n}`, noteId: `n${n}`, deckId: 'd', createdAt: toIso(NOW - DAY * 300), type: 'recognition',
  state: 'review', due: toIso(NOW - DAY * 50), interval: 1, ease: 2.5, reps: 3, lapses: 0, step: 0,
  lastReviewedAt: null, isLeech: false, suspended: false, updatedAt: toIso(0), deleted: false, ...over,
});

describe('分散积压', () => {
  it('只改今天前到期的复习卡；均匀分到 N 天；危险的排前面；间隔倍率不变', async () => {
    const worst = card({ lapses: 5 });
    const lowEase = card({ ease: 1.5 });
    const others = Array.from({ length: 8 }, () => card({}));
    const todayDue = card({ due: toIso(NOW - 3600000) }); // 今天才到期：不动
    const learning = card({ state: 'learning' });
    const suspended = card({ suspended: true });
    await db.cards.bulkPut([...others, worst, lowEase, todayDue, learning, suspended]);
    expect(await spreadBacklog(5, undefined, NOW)).toBe(10);
    const get = async (c: Card) => (await db.cards.get(c.id))!;
    const today = studyDay(NOW, 4);
    const day = async (c: Card) => studyDay(fromIso((await get(c)).due), 4);
    expect(await day(worst)).toBe(today);
    expect(await day(lowEase)).toBe(today);
    const perDay = new Map<string, number>();
    for (const c of [...others, worst, lowEase]) { const d = await day(c); perDay.set(d, (perDay.get(d) ?? 0) + 1); }
    expect([...perDay.entries()].sort()).toEqual([0, 1, 2, 3, 4].map((i) => [addDaysToDay(today, i), 2]));
    expect([(await get(worst)).interval, (await get(worst)).ease]).toEqual([1, 2.5]);
    expect((await get(todayDue)).due).toBe(todayDue.due);
    expect((await get(learning)).due).toBe(learning.due);
    expect((await get(suspended)).due).toBe(suspended.due);
  });
});
