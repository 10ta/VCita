import { describe, expect, it } from 'vitest';
import { buildQueue } from '../src/srs/queue';
import type { Card, ReviewLog } from '../src/schema';
import { studyDay, toIso } from '../src/lib/time';

const NOW = new Date(2026, 9, 3, 15, 0).getTime();
const S = { newPerDay: 2, reviewsPerDay: 0, dayStartHour: 4 };
let n = 0;
const card = (over: Partial<Card>): Card => ({
  id: `c${++n}`, noteId: `n${n}`, deckId: 'd', createdAt: toIso(NOW - 86400000 * 10), type: 'recognition',
  state: 'review', due: toIso(NOW - 3600000), interval: 5, ease: 2.5, reps: 3, lapses: 0, step: 0,
  lastReviewedAt: null, isLeech: false, suspended: false, updatedAt: toIso(0), deleted: false, ...over,
});
const log = (c: Card, prevState: Card['state']): ReviewLog => ({
  id: `l${++n}`, cardId: c.id, noteId: c.noteId, ts: toIso(NOW), day: studyDay(NOW, 4), rating: 3, prevState, newState: 'review',
  prevInterval: null, newInterval: null, prevEase: null, newEase: null, prevDue: null, newDue: null, elapsedMs: null, source: 'app', updatedAt: toIso(NOW), deleted: false,
});

describe('出题队列', () => {
  it('after 模式：有到期复习卡时不出新卡；复习完才出新卡', () => {
    const A = { ...S, newReviewOrder: 'after' as const };
    const r = card({}), r2 = card({}), nw = card({ state: 'new' });
    expect(buildQueue({ cards: [nw, r, r2], todayLogs: [], deckId: 'd', now: NOW, settings: A }).next?.id).toBe(r.id);
    expect(buildQueue({ cards: [nw, r2], todayLogs: [log(r, 'review')], deckId: 'd', now: NOW, settings: A }).next?.id).toBe(r2.id);
    expect(buildQueue({ cards: [nw], todayLogs: [log(r, 'review'), log(r2, 'review')], deckId: 'd', now: NOW, settings: A }).next?.id).toBe(nw.id);
  });
  it('mix 模式（默认）：新卡按比例均匀穿插在复习中', () => {
    const reviews = Array.from({ length: 10 }, () => card({}));
    const news = [card({ state: 'new' }), card({ state: 'new' })];
    let cards = [...news, ...reviews];
    const logs: ReviewLog[] = [];
    const order: string[] = [];
    while (true) {
      const q = buildQueue({ cards, todayLogs: logs, deckId: 'd', now: NOW, settings: S });
      if (!q.next) break;
      order.push(q.next.state === 'new' ? 'N' : 'R');
      logs.push(log(q.next, q.next.state));
      cards = cards.filter((c) => c.id !== q.next!.id);
    }
    expect(order.join('')).toBe('RNRRRRRNRRRR');
  });
  it('相对逾期排序：逾期天数 ÷ 间隔大的先出；due 模式按到期时间', () => {
    const a = card({ due: toIso(NOW - 86400000 * 30), interval: 100 }); // 0.3
    const b = card({ due: toIso(NOW - 86400000 * 5), interval: 1 }); // 5
    expect(buildQueue({ cards: [a, b], todayLogs: [], deckId: 'd', now: NOW, settings: S }).next?.id).toBe(b.id);
    expect(buildQueue({ cards: [a, b], todayLogs: [], deckId: 'd', now: NOW, settings: { ...S, reviewSort: 'due' } }).next?.id).toBe(a.id);
  });
  it('到期的学习卡最优先', () => {
    const r = card({}), l = card({ state: 'learning', due: toIso(NOW - 1000) });
    expect(buildQueue({ cards: [r, l], todayLogs: [], deckId: 'd', now: NOW, settings: S }).next?.id).toBe(l.id);
  });
  it('当天新卡数不超过上限', () => {
    const news = [card({ state: 'new' }), card({ state: 'new' }), card({ state: 'new' })];
    const q0 = buildQueue({ cards: news, todayLogs: [], deckId: 'd', now: NOW, settings: S });
    expect(q0.counts.new).toBe(2);
    const q1 = buildQueue({ cards: news.slice(2), todayLogs: [log(news[0], 'new'), log(news[1], 'new')], deckId: 'd', now: NOW, settings: S });
    expect(q1.next).toBeNull();
  });
  it('同一条笔记的两张卡不在同一天出现', () => {
    const a = card({ noteId: 'same' }), b = card({ noteId: 'same', type: 'production' });
    const q = buildQueue({ cards: [b], todayLogs: [log(a, 'review')], deckId: 'd', now: NOW, settings: S });
    expect(q.next).toBeNull();
    // 同一条笔记的两张新卡，当天也只出一张
    const x = card({ noteId: 'nn', state: 'new' }), y = card({ noteId: 'nn', state: 'new', type: 'cloze' });
    expect(buildQueue({ cards: [x, y], todayLogs: [], deckId: 'd', now: NOW, settings: { ...S, newPerDay: 20 } }).counts.new).toBe(1);
  });
  it('暂停、未到期、其他牌组的卡不出；20 分钟内到期的学习卡在没别的卡时提前出', () => {
    const cards = [card({ suspended: true }), card({ due: toIso(NOW + 86400000 * 2) }), card({ deckId: 'other' })];
    expect(buildQueue({ cards, todayLogs: [], deckId: 'd', now: NOW, settings: S }).next).toBeNull();
    const soon = card({ state: 'learning', due: toIso(NOW + 5 * 60000) });
    expect(buildQueue({ cards: [soon], todayLogs: [], deckId: 'd', now: NOW, settings: S }).next?.id).toBe(soon.id);
    const later = card({ state: 'learning', due: toIso(NOW + 60 * 60000) });
    const q = buildQueue({ cards: [later], todayLogs: [], deckId: 'd', now: NOW, settings: S });
    expect([q.next, q.nextLearningAt]).toEqual([null, NOW + 60 * 60000]);
  });
});
