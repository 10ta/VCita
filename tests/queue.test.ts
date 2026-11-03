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
  it('servable：明天才到期的学习卡、兄弟卡不在可出范围；计数为 0 时没有可出的卡', () => {
    const tomorrow = card({ state: 'learning', step: 1, due: toIso(NOW + 86400000) });
    const a = card({ noteId: 'sib' }), b = card({ noteId: 'sib', type: 'production', state: 'learning', due: toIso(NOW - 1000) });
    const q = buildQueue({ cards: [tomorrow, b], todayLogs: [log(a, 'review')], deckId: 'd', now: NOW, settings: S });
    expect(q.counts).toEqual({ learning: 0, review: 0, new: 0 });
    expect(q.servable.size).toBe(0);
    expect(q.next).toBeNull();
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

describe('提前学习（learn ahead）', () => {
  it('刚答完的学习卡不立刻重复出现；有别的学习卡时先出别的；点了"提前复习"才出', () => {
    const a = card({ state: 'relearning', due: toIso(NOW + 10 * 60000) });
    const la = { ...log(a, 'relearning'), ts: toIso(NOW - 1000) };
    const q = buildQueue({ cards: [a], todayLogs: [la], deckId: 'd', now: NOW, settings: S });
    expect([q.next, q.canLearnAhead, q.nextLearningAt]).toEqual([null, true, NOW + 10 * 60000]);
    expect(buildQueue({ cards: [a], todayLogs: [la], deckId: 'd', now: NOW, settings: S, learnAheadAll: true }).next?.id).toBe(a.id);
    const b = card({ state: 'learning', due: toIso(NOW + 15 * 60000) });
    const lb = { ...log(b, 'learning'), ts: toIso(NOW - 60000) };
    expect(buildQueue({ cards: [a, b], todayLogs: [la, lb], deckId: 'd', now: NOW, settings: S }).next?.id).toBe(b.id);
  });
});

describe('学习中计数', () => {
  it('只算本学习日内到期的学习卡（明天 4 点到期的不算）', () => {
    const soon = card({ state: 'learning', due: toIso(NOW + 10 * 60000) });
    const tomorrow4 = card({ state: 'learning', due: toIso(new Date(2026, 9, 4, 4, 0).getTime()) });
    const q = buildQueue({ cards: [soon, tomorrow4], todayLogs: [], deckId: 'd', now: NOW, settings: S });
    expect(q.counts.learning).toBe(1);
  });
  it('新卡顺序：重点主题 → 核心 → 中频 → 添加时间；created 只按添加时间', () => {
    const at = (d: number) => toIso(NOW - 86400000 * d);
    const a = card({ state: 'new', createdAt: at(9) }); // 中频
    const b = card({ state: 'new', createdAt: at(8) }); // 核心
    const c = card({ state: 'new', createdAt: at(7) }); // 中频 + 重点主题
    const notes = new Map([
      [a.noteId, { layer: 'mid' as const, tags: ['GÉNÉRAL' as const] }],
      [b.noteId, { layer: 'core' as const, tags: ['GÉNÉRAL' as const] }],
      [c.noteId, { layer: 'mid' as const, tags: ['SANTÉ' as const] }],
    ]);
    const S3 = { ...S, newPerDay: 3 };
    const order = (settings: typeof S3 & { newSort?: 'layer' | 'created'; focusTags?: ('SANTÉ')[] }) => {
      let cards = [a, b, c];
      const logs: ReviewLog[] = [], ids: string[] = [];
      for (let q = buildQueue({ cards, todayLogs: logs, deckId: 'd', now: NOW, settings, notes }); q.next; q = buildQueue({ cards, todayLogs: logs, deckId: 'd', now: NOW, settings, notes })) {
        ids.push(q.next.id); logs.push(log(q.next, 'new')); cards = cards.filter((x) => x.id !== q.next!.id);
      }
      return ids;
    };
    expect(order(S3)).toEqual([b.id, a.id, c.id]);
    expect(order({ ...S3, focusTags: ['SANTÉ'] })).toEqual([c.id, b.id, a.id]);
    expect(order({ ...S3, newSort: 'created' })).toEqual([a.id, b.id, c.id]);
  });
  it('复习上限挡住的到期复习卡计入积压', () => {
    const rs = Array.from({ length: 5 }, () => card({}));
    const q = buildQueue({ cards: rs, todayLogs: [log(card({}), 'review')], deckId: 'd', now: NOW, settings: { ...S, reviewsPerDay: 3 } });
    expect([q.counts.review, q.reviewBacklog]).toEqual([2, 3]);
    expect(buildQueue({ cards: rs, todayLogs: [], deckId: 'd', now: NOW, settings: S }).reviewBacklog).toBe(0);
  });
});

describe('新卡额度拆分', () => {
  const at = (d: number) => toIso(NOW - 86400000 * d);
  type Meta = { layer: 'core' | 'mid'; tags: []; origin?: 'mined' | 'list' | null; source?: string | null };
  /** 一直答新卡直到队列空，返回出卡顺序 */
  const run = (cards: Card[], notes: Map<string, Meta>, settings: Record<string, unknown>, logs: ReviewLog[] = []) => {
    const ids: string[] = [];
    const st = { ...S, ...settings } as typeof S;
    for (let q = buildQueue({ cards, todayLogs: logs, deckId: 'd', now: NOW, settings: st, notes }); q.next; q = buildQueue({ cards, todayLogs: logs, deckId: 'd', now: NOW, settings: st, notes })) {
      // 和应用里一样：答过的卡留在卡片列表里，只是变成复习卡（明天到期）
      const id = q.next.id;
      ids.push(id); logs.push(log(q.next, 'new')); cards = cards.map((x) => (x.id === id ? { ...x, state: 'review' as const, due: toIso(NOW + 86400000) } : x));
    }
    return ids;
  };

  it('按来源：挖矿卡占 freshShare%，越新越先；词表卡按核心度消化积压', () => {
    const minedOld = card({ state: 'new', createdAt: at(30) });
    const minedNew = card({ state: 'new', createdAt: at(1) });
    const minedMid = card({ state: 'new', createdAt: at(5) });
    const listCore = card({ state: 'new', createdAt: at(20) });
    const listMid = card({ state: 'new', createdAt: at(40) });
    const listMid2 = card({ state: 'new', createdAt: at(10) });
    const notes = new Map<string, Meta>([
      [minedOld.noteId, { layer: 'mid', tags: [], origin: 'mined' }],
      [minedNew.noteId, { layer: 'mid', tags: [], source: 'InnerFrench · 第 12 集' }], // 没标过、填了出处 → 挖矿
      [minedMid.noteId, { layer: 'mid', tags: [], origin: 'mined' }],
      [listCore.noteId, { layer: 'core', tags: [], origin: 'list' }],
      [listMid.noteId, { layer: 'mid', tags: [] }], // 没标过、没出处 → 词表
      [listMid2.noteId, { layer: 'mid', tags: [], origin: 'list', source: 'B2 词表' }], // 标过的以标的为准
    ]);
    const all = [minedOld, minedNew, minedMid, listCore, listMid, listMid2];
    // 4 张：60% → 挖矿 2 张（最新的两张），词表 2 张（核心先）
    expect(run(all, notes, { newPerDay: 4, newSplit: 'source', freshShare: 60 })).toEqual([minedNew.id, minedMid.id, listCore.id, listMid.id]);
    // 不拆：按核心 → 添加时间
    expect(run(all, notes, { newPerDay: 4, newSplit: 'off' })).toEqual([listCore.id, listMid.id, minedOld.id, listMid2.id]);
  });

  it('一份不够时额度让给另一份', () => {
    const mined = card({ state: 'new', createdAt: at(1) });
    const lists = Array.from({ length: 5 }, (_, i) => card({ state: 'new', createdAt: at(10 + i) }));
    const notes = new Map<string, Meta>([[mined.noteId, { layer: 'mid', tags: [], origin: 'mined' }], ...lists.map((c) => [c.noteId, { layer: 'mid' as const, tags: [] as [] }] as const)]);
    const order = run([mined, ...lists], notes, { newPerDay: 4, newSplit: 'source', freshShare: 75 });
    expect(order).toHaveLength(4);
    expect(order[0]).toBe(mined.id);
    // 反过来：词表卡没有了，挖矿卡把整份额度用掉
    const ms = Array.from({ length: 5 }, (_, i) => card({ state: 'new', createdAt: at(i + 1) }));
    const notes2 = new Map<string, Meta>(ms.map((c) => [c.noteId, { layer: 'mid', tags: [], origin: 'mined' }]));
    expect(run(ms, notes2, { newPerDay: 4, newSplit: 'source', freshShare: 50 })).toEqual(ms.slice(0, 4).map((c) => c.id));
  });

  it('当天已学的新卡按各自那份扣额度', () => {
    const done = card({ state: 'review', createdAt: at(1), due: toIso(NOW + 86400000) }); // 今天学过的挖矿卡
    const m = card({ state: 'new', createdAt: at(2) });
    const l1 = card({ state: 'new', createdAt: at(20) }), l2 = card({ state: 'new', createdAt: at(21) });
    const notes = new Map<string, Meta>([
      [done.noteId, { layer: 'mid', tags: [], origin: 'mined' }], [m.noteId, { layer: 'mid', tags: [], origin: 'mined' }],
      [l1.noteId, { layer: 'mid', tags: [], origin: 'list' }], [l2.noteId, { layer: 'mid', tags: [], origin: 'list' }],
    ]);
    // 上限 2、挖矿 50%：挖矿那份已用完，剩下 1 张给词表
    expect(run([done, m, l1, l2], notes, { newPerDay: 2, newSplit: 'source', freshShare: 50 }, [log(done, 'new')])).toEqual([l2.id]); // 词表按添加时间，旧的先
  });

  it('按添加时间：最近 N 天的卡越新越先，更早的按核心度', () => {
    const recent1 = card({ state: 'new', createdAt: at(2) });
    const recent0 = card({ state: 'new', createdAt: at(0) });
    const oldCore = card({ state: 'new', createdAt: at(30) });
    const oldMid = card({ state: 'new', createdAt: at(60) });
    const notes = new Map<string, Meta>([
      [recent1.noteId, { layer: 'mid', tags: [] }], [recent0.noteId, { layer: 'mid', tags: [] }],
      [oldCore.noteId, { layer: 'core', tags: [] }], [oldMid.noteId, { layer: 'mid', tags: [] }],
    ]);
    expect(run([recent1, recent0, oldCore, oldMid], notes, { newPerDay: 4, newSplit: 'recent', freshDays: 7, freshShare: 50 }))
      .toEqual([recent0.id, recent1.id, oldCore.id, oldMid.id]);
    // 窗口只有 1 天：两天前的卡算旧卡
    expect(run([recent1, recent0, oldCore, oldMid], notes, { newPerDay: 2, newSplit: 'recent', freshDays: 1, freshShare: 50 }))
      .toEqual([recent0.id, oldCore.id]);
  });
  it('换日前 20 分钟：明天 4:00 才到期的"1 天"步骤学习卡不提前出（计数 0 0 0 时不能有卡）', () => {
    const now = new Date(2026, 10, 2, 3, 42).getTime(); // 凌晨 3:42，学习日还是前一天
    const tomorrow = card({ state: 'learning', step: 1, due: toIso(new Date(2026, 10, 2, 4, 0).getTime()) });
    const q = buildQueue({ cards: [tomorrow], todayLogs: [], deckId: 'd', now, settings: S });
    expect(q.counts).toEqual({ learning: 0, review: 0, new: 0 });
    expect(q.next).toBeNull();
    expect(q.servable.size).toBe(0);
    expect(q.canLearnAhead).toBe(false);
    expect(buildQueue({ cards: [tomorrow], todayLogs: [], deckId: 'd', now, settings: S, learnAheadAll: true }).next).toBeNull();
    // 4:00 换日后正常出
    const q2 = buildQueue({ cards: [tomorrow], todayLogs: [], deckId: 'd', now: new Date(2026, 10, 2, 4, 0).getTime(), settings: S });
    expect(q2.next?.id).toBe(tomorrow.id);
    expect(q2.counts.learning).toBe(1);
  });
  it('不变式：能出的卡一定在计数里（随机卡组 × 一天里每 7 分钟）', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const base = new Date(2026, 10, 1, 4, 0).getTime();
    const states: Card['state'][] = ['new', 'learning', 'relearning', 'review'];
    for (let round = 0; round < 40; round++) {
      const cards = Array.from({ length: 12 }, () => {
        const state = states[Math.floor(rnd() * 4)];
        const due = base + Math.floor((rnd() * 2.2 - 0.1) * 86400000);
        return card({ state, due: toIso(due), createdAt: toIso(base - 86400000 * 3), noteId: `n${Math.floor(rnd() * 8)}` });
      });
      const settings = { ...S, newPerDay: Math.floor(rnd() * 3), reviewsPerDay: Math.floor(rnd() * 3) };
      for (let t = base; t < base + 86400000; t += 7 * 60_000) {
        for (const learnAheadAll of [false, true]) {
          const q = buildQueue({ cards, todayLogs: [], deckId: 'd', now: t, settings, learnAheadAll });
          const total = q.counts.learning + q.counts.review + q.counts.new;
          if (q.next) expect(q.servable.has(q.next.id)).toBe(true);
          expect(q.servable.size).toBeLessThanOrEqual(total);
          if (total === 0) expect(q.next).toBeNull();
        }
      }
    }
  });
  it('新卡顺序：同一层里常用词先出；freq 模式不分核心 / 中频；查不到词频的排在最后', () => {
    const mk = (noteId: string, created: number) => card({ state: 'new', noteId, createdAt: toIso(NOW - 86400000 * created) });
    const a = mk('rare', 5), b = mk('common', 1), c = mk('unknown', 9), d = mk('midcommon', 3);
    const notes = new Map([
      ['rare', { layer: 'core' as const, tags: [] }], ['common', { layer: 'core' as const, tags: [] }],
      ['unknown', { layer: 'core' as const, tags: [] }], ['midcommon', { layer: 'mid' as const, tags: [] }],
    ]);
    const freq = new Map<string, number | null>([['rare', 0.5], ['common', 300], ['unknown', null], ['midcommon', 900]]);
    const order = (newSort: 'layer' | 'freq') => {
      const ids: string[] = []; let cards = [a, b, c, d];
      for (;;) {
        const q = buildQueue({ cards, todayLogs: [], deckId: 'd', now: NOW, settings: { ...S, newPerDay: 9, newSort, newSplit: 'off' }, notes, freq });
        if (!q.next) break;
        ids.push(q.next.noteId); cards = cards.filter((x) => x.id !== q.next!.id);
      }
      return ids.join(' ');
    };
    expect(order('layer')).toBe('common rare unknown midcommon');
    expect(order('freq')).toBe('midcommon common rare unknown');
  });
  it('同一个易混组的辨析卡当天只出一张', () => {
    const a = card({ noteId: 'ga', type: 'contrast' }), b = card({ noteId: 'gb', type: 'contrast' }), other = card({ noteId: 'x' });
    const notes = new Map([['ga', { layer: 'core' as const, tags: [], contrastGroup: 'g1' }], ['gb', { layer: 'core' as const, tags: [], contrastGroup: 'g1' }], ['x', { layer: 'core' as const, tags: [] }]]);
    const answered = { ...a, due: toIso(NOW + 86400000 * 3) };
    const q = buildQueue({ cards: [answered, b, other], todayLogs: [log(a, 'review')], deckId: 'd', now: NOW, settings: S, notes });
    expect(q.counts.review).toBe(1);
    expect(q.next?.id).toBe(other.id);
  });
});
