// 预加载：接下来可能出的卡
import { describe, expect, it } from 'vitest';
import { upcomingCards } from '../src/srs/upcoming';
import type { Card, Settings } from '../src/schema';
import { toIso } from '../src/lib/time';

const NOW = new Date(2026, 9, 3, 15, 0).getTime();
const S = { newPerDay: 5, reviewsPerDay: 0, dayStartHour: 4 } as unknown as Settings;
let n = 0;
const card = (over: Partial<Card>): Card => ({
  id: `c${++n}`, noteId: `n${n}`, deckId: 'd', createdAt: toIso(NOW - 86400000 * 10), type: 'recognition',
  state: 'review', due: toIso(NOW - 3600000), interval: 5, ease: 2.5, reps: 3, lapses: 0, step: 0,
  lastReviewedAt: null, isLeech: false, suspended: false, updatedAt: toIso(0), deleted: false, ...over,
});
const base = { logs: [], deckId: 'd', settings: S, skipped: new Set<string>(), learnAheadAll: false, notes: new Map(), customQueue: null, now: NOW };

describe('接下来可能出的卡', () => {
  it('队列里的下两张，不含这张和它的兄弟卡', () => {
    const cur = card({});
    const sib = card({ noteId: cur.noteId });
    const a = card({ due: toIso(NOW - 7200000) }), b = card({}), c = card({});
    const ids = upcomingCards({ ...base, card: cur, cards: [cur, sib, a, b, c] }).map((x) => x.id);
    expect(ids.slice(0, 2)).toHaveLength(2);
    expect(ids).not.toContain(cur.id);
    expect(ids).not.toContain(sib.id);
  });
  it('15 分钟内到期的重学卡也算：它会突然插到前面', () => {
    const cur = card({});
    const r1 = card({}), r2 = card({});
    const relearn = card({ state: 'relearning', due: toIso(NOW + 5 * 60_000) });
    const later = card({ state: 'learning', due: toIso(NOW + 40 * 60_000) });
    const ids = upcomingCards({ ...base, card: cur, cards: [cur, r1, r2, relearn, later] }).map((x) => x.id);
    expect(ids).toContain(relearn.id);
    expect(ids).not.toContain(later.id);
  });
  it('自定义学习：队列里接下来的三张', () => {
    const cs = [card({}), card({}), card({}), card({}), card({})];
    const ids = upcomingCards({ ...base, card: cs[0], cards: cs, customQueue: cs.map((c) => c.id) }).map((x) => x.id);
    expect(ids).toEqual([cs[1].id, cs[2].id, cs[3].id]);
  });
});
