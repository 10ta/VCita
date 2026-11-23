// 每日新卡计划（queue.ts 规则 6）：当天新卡定下来后不再陆续冒出；计数里不含今天注定出不了的
import { describe, expect, it } from 'vitest';
import { buildQueue, newInfoText, type NewPlan, type QueueInput } from '../src/srs/queue';
import type { Card, Note, ReviewLog } from '../src/schema';
import { studyDay, toIso } from '../src/lib/time';

const NOW = new Date(2026, 10, 22, 9, 0).getTime();
const DAY = studyDay(NOW, 4);
const S = { newPerDay: 100, reviewsPerDay: 0, dayStartHour: 4, newSplit: 'off' as const };
let n = 0;
const card = (over: Partial<Card>): Card => ({
  id: `c${++n}`, noteId: `n${n}`, deckId: 'd', createdAt: toIso(NOW - 86400000 * 10), type: 'recognition',
  state: 'new', due: toIso(NOW - 3600000), interval: 0, ease: 2.5, reps: 0, lapses: 0, step: 0,
  lastReviewedAt: null, isLeech: false, suspended: false, updatedAt: toIso(0), deleted: false, ...over,
});
const log = (c: Card, prevState: Card['state'], at = NOW): ReviewLog => ({
  id: `l${++n}`, cardId: c.id, noteId: c.noteId, ts: toIso(at), day: studyDay(at, 4), rating: 3, prevState, newState: 'learning',
  prevInterval: null, newInterval: null, prevEase: null, newEase: null, prevDue: null, newDue: null, elapsedMs: null, source: 'app', updatedAt: toIso(at), deleted: false,
});
const noteMap = (cards: Card[], over: Record<string, Partial<Note>> = {}) =>
  new Map([...new Set(cards.map((c) => c.noteId))].map((id) => [id, { layer: 'core' as const, tags: [], ...over[id] }]));
const run = (cards: Card[], extra: Partial<QueueInput> = {}) =>
  buildQueue({ cards, todayLogs: [], deckId: 'd', now: NOW, settings: S, notes: noteMap(cards), newPlan: null, ...extra });

describe('每日新卡计划', () => {
  it('计划之后认读卡毕业放出的产出卡，今天不再补进来（清零后不会陆续冒出新卡）', () => {
    const rec = card({ noteId: 'a', state: 'learning', step: 1, due: toIso(NOW + 86400000 * 2) }); // 学习中、明天之后才到期
    const prod = card({ noteId: 'a', type: 'production' });
    const other = card({});
    const q1 = run([rec, prod, other]);
    expect(q1.counts.new).toBe(1); // 只有 other；prod 等认读卡
    // 一天中途认读卡进入复习（比如在另一台设备上答了，同步过来）
    const recGrad = { ...rec, state: 'review' as const, interval: 3 };
    const q2 = run([recGrad, prod, other], { newPlan: q1.newPlan });
    expect(q2.counts.new).toBe(1);
    expect(q2.newPlan).toBe(q1.newPlan); // 计划没变，不用保存
    // 答完 other 之后：0，不会冒出 prod
    const q3 = run([recGrad, prod, { ...other, state: 'learning' as const, due: toIso(NOW + 86400000) }], { newPlan: q1.newPlan, todayLogs: [log(other, 'new')] });
    expect(q3.counts.new).toBe(0);
    expect(q3.next).toBeNull();
    // 第二天重做计划，prod 进来
    const tomorrow = NOW + 86400000;
    const q4 = buildQueue({ cards: [recGrad, prod], todayLogs: [], deckId: 'd', now: tomorrow, settings: S, notes: noteMap([prod]), newPlan: q1.newPlan });
    expect(q4.counts.new).toBe(1);
    expect(q4.newPlan.day).not.toBe(DAY);
  });

  it('改好的待修笔记今天不回到新卡；明天再出', () => {
    const a = card({}), b = card({});
    const q1 = run([a, b], { notes: noteMap([a, b], { [a.noteId]: { fixme: '题面不唯一' } }) });
    expect(q1.counts.new).toBe(1);
    const q2 = run([a, b], { newPlan: q1.newPlan });
    expect(q2.counts.new).toBe(1);
  });

  it('计划之后新加 / 导入的笔记补进今天没用完的额度', () => {
    const a = card({});
    const q1 = run([a]);
    const added = card({ createdAt: toIso(NOW) });
    const q2 = run([a, added], { newPlan: q1.newPlan });
    expect(q2.counts.new).toBe(2);
    expect(q2.newPlan.ids).toContain(added.id);
    expect(q2.newPlan.knownNotes).toContain(added.noteId);
    // 补进计划后再算一次：计划不再变化
    expect(run([a, added], { newPlan: q2.newPlan }).newPlan).toBe(q2.newPlan);
  });

  it('额度用完时新加的笔记也不补', () => {
    const a = card({}), b = card({});
    const q1 = run([a, b], { settings: { ...S, newPerDay: 2 } });
    const q2 = run([a, b, card({ createdAt: toIso(NOW) })], { settings: { ...S, newPerDay: 2 }, newPlan: q1.newPlan });
    expect(q2.counts.new).toBe(2);
  });

  it('改了新卡上限：计划重做', () => {
    const cs = [card({}), card({}), card({})];
    const q1 = run(cs, { settings: { ...S, newPerDay: 1 } });
    expect(q1.counts.new).toBe(1);
    const q2 = run(cs, { settings: { ...S, newPerDay: 3 }, newPlan: q1.newPlan });
    expect(q2.counts.new).toBe(3);
    expect(q2.newPlan).not.toBe(q1.newPlan);
  });

  it('跳过的卡不掉出计划：这一轮不出，重开后还在', () => {
    const a = card({}), b = card({});
    const q1 = run([a, b], { skipped: new Set([a.id]) });
    expect(q1.counts.new).toBe(1);
    expect(q1.newPlan.ids).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(run([a, b], { newPlan: q1.newPlan }).counts.new).toBe(2);
  });

  it('今天要复习的笔记，它的新卡一开始就不算进今天（不会答完兄弟卡后计数突然变少）', () => {
    const rec = card({ noteId: 'x', state: 'learning', step: 1, due: toIso(NOW + 3600000) }); // 今天晚些时候到期
    const cloze = card({ noteId: 'x', type: 'cloze' });
    const other = card({});
    const q = run([rec, cloze, other]);
    expect(q.counts.new).toBe(1);
    expect(q.newInfo.waiting.busy).toBe(1);
  });

  it('昨天学了一批新认读卡：今天的新卡数 = 真正能学的笔记数，并说明其余的原因', () => {
    const cards: Card[] = [];
    // 昨天学的 3 条：认读卡今天到期（1 天步骤），产出卡等认读卡毕业
    for (let i = 0; i < 3; i++) {
      cards.push(card({ noteId: `y${i}`, state: 'learning', step: 1, due: toIso(NOW - 600000) }));
      cards.push(card({ noteId: `y${i}`, type: 'production' }));
    }
    // 之前学的 2 条：认读卡还在学习中、明天才到期，产出卡在等
    for (let i = 0; i < 2; i++) {
      cards.push(card({ noteId: `w${i}`, state: 'learning', step: 1, due: toIso(NOW + 86400000 * 2) }));
      cards.push(card({ noteId: `w${i}`, type: 'production' }));
    }
    // 全新的 4 条，各有认读 + 产出
    for (let i = 0; i < 4; i++) {
      cards.push(card({ noteId: `f${i}` }));
      cards.push(card({ noteId: `f${i}`, type: 'production' }));
    }
    const q = run(cards);
    expect(q.counts.new).toBe(4);
    expect(q.newInfo.notesWithNew).toBe(9);
    expect(q.newInfo.waiting).toMatchObject({ busy: 3, gated: 2, limit: 0 });
    const text = newInfoText(q.newInfo).join('\n');
    expect(text).toContain('今天不出的 5 条');
    expect(text).toContain('今天要复习它的另一张卡');
  });

  it('不传计划时（测试 / 预测下一张）照旧每次重算', () => {
    const a = card({});
    const q = buildQueue({ cards: [a], todayLogs: [], deckId: 'd', now: NOW, settings: S });
    expect(q.counts.new).toBe(1);
    expect(q.newPlan.ids).toEqual([a.id]);
  });

  it('别的牌组 / 别的日子的计划不用', () => {
    const a = card({});
    const stale: NewPlan = { day: '2026-01-01', deckId: 'd', sig: '', ids: [], knownNotes: [a.noteId], madeAt: 0 };
    expect(run([a], { newPlan: stale }).counts.new).toBe(1);
  });
});
