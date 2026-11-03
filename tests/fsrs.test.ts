import { describe, expect, it } from 'vitest';
import { FSRS6_DEFAULT, intervalFor, memoryFromSm2, nextMemory, replayMemory, retrievability, type Grade } from '../src/srs/fsrs';
import { toIso } from '../src/lib/time';

// 参考值来自 fsrs-rs（open-spaced-repetition 的官方 Rust 实现，fsrs-rs-python 绑定）
const PERSONAL = [0.0296, 0.7327, 0.7327, 2.0592, 6.4135, 0.6031, 2.9799, 0.0212, 1.8035, 0.4076, 0.7537, 1.4858, 0.022, 0.2397, 1.7762, 0.4176, 1.7623, 0.6991, 0.1113, 0.2586, 0.104];
const SEQ: Array<[Grade, number]> = [[3, 0], [3, 0], [3, 1], [1, 3], [3, 0], [2, 2], [4, 5]];
const run = (w: readonly number[], k: number) => {
  let m: { s: number; d: number } | null = null;
  for (const [g, t] of SEQ.slice(0, k)) m = nextMemory(w, m, t, g);
  return m!;
};

describe('FSRS-6', () => {
  it('和 fsrs-rs 的结果一致（默认参数 / 个人参数）', () => {
    const cases: Array<[readonly number[], number, number, number]> = [
      [FSRS6_DEFAULT, 1, 2.3065, 2.1181040], [FSRS6_DEFAULT, 4, 1.1485633, 7.3899755], [FSRS6_DEFAULT, 7, 12.9855146, 7.6431208],
      [PERSONAL, 1, 0.7327, 4.0727339], [PERSONAL, 4, 0.8053226, 7.8175745], [PERSONAL, 7, 7.4553838, 7.5962276],
    ];
    for (const [w, k, s, d] of cases) {
      const m = run(w, k);
      expect(m.s).toBeCloseTo(s, 3);
      expect(m.d).toBeCloseTo(d, 3);
    }
  });
  it('稳定性的定义：过了 S 天记住的概率是 90%；目标 90% 时间隔 = S', () => {
    expect(retrievability(FSRS6_DEFAULT, 10, 10)).toBeCloseTo(0.9, 6);
    expect(intervalFor(FSRS6_DEFAULT, 10, 0.9)).toBeCloseTo(10, 6);
    expect(intervalFor(FSRS6_DEFAULT, 10, 0.95)).toBeLessThan(10);
  });
  it('SM-2 换算（同 fsrs-rs memory_state_from_sm2）：倍率 2.5、间隔 10 天 → S 10、D 6.914', () => {
    const m = memoryFromSm2(FSRS6_DEFAULT, 2.5, 10);
    expect(m.s).toBeCloseTo(10, 4);
    expect(m.d).toBeCloseTo(6.914, 2);
  });
  it('重放日志：按学习日算间隔；墓碑（撤销）不算；日志不完整的卡从 SM-2 状态起算', () => {
    const days = ['2026-10-01', '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-05', '2026-10-07', '2026-10-12'];
    const logs = SEQ.map(([g], i) => ({ ts: toIso(Date.UTC(2026, 9, 1) + i * 1000), day: days[i], rating: g, prevState: i === 0 ? 'new' as const : 'review' as const, prevInterval: null, prevEase: null, prevDue: null, deleted: false }));
    const undone = { ...logs[2], ts: toIso(Date.UTC(2026, 9, 1) + 2500), rating: 1, deleted: true };
    const m = replayMemory(PERSONAL, [...logs, undone], null, 4)!;
    expect(m.s).toBeCloseTo(7.4553838, 3);
    expect(m.day).toBe('2026-10-12');
    const legacy = replayMemory(FSRS6_DEFAULT, [{ ts: toIso(Date.UTC(2026, 9, 20)), day: '2026-10-20', rating: 3, prevState: 'review', prevInterval: 10, prevEase: 2.5, prevDue: toIso(Date.UTC(2026, 9, 20, 12)), deleted: false }], null, 4)!;
    expect(legacy.s).toBeGreaterThan(10);
    expect(replayMemory(FSRS6_DEFAULT, [], { state: 'new', interval: 0, ease: 2.5, due: toIso(0), lastReviewedAt: null }, 4)).toBeNull();
    expect(replayMemory(FSRS6_DEFAULT, [], { state: 'review', interval: 10, ease: 2.5, due: toIso(Date.UTC(2026, 9, 20, 12)), lastReviewedAt: null }, 4)!.day).toBe('2026-10-10');
  });
});

import { preview, schedule, type SrsParams } from '../src/srs/scheduler';
import { SettingsSchema } from '../src/schema';
import { fromIso as fi, studyDay as sd } from '../src/lib/time';

describe('FSRS 调度', () => {
  const P: SrsParams = { ...SettingsSchema.parse({ updatedAt: toIso(0) }), fuzz: false };
  const NOW = new Date(2026, 9, 3, 15, 0).getTime();
  const card = (over = {}) => ({ state: 'review' as const, due: toIso(NOW), interval: 10, ease: 2.5, reps: 5, lapses: 0, step: 0, lastReviewedAt: null, isLeech: false, suspended: false, ...over });
  it('默认就是 FSRS；复习卡：间隔由稳定性和目标保持率决定，困难 ≤ 良好 < 容易，预览和实际一致', () => {
    expect(P.scheduler).toBe('fsrs');
    const mem = { s: 10, d: 5, day: '2026-09-23' };
    const pv = preview(card(), P, NOW, mem);
    const days = ([2, 3, 4] as const).map((r) => (pv[r] as { days: number }).days);
    expect(days[0]).toBeLessThanOrEqual(days[1]);
    expect(days[1]).toBeLessThan(days[2]);
    for (const r of [2, 3, 4] as const) expect(schedule(card(), r, NOW, P, Math.random, mem).card.interval).toBe((pv[r] as { days: number }).days);
    // 目标保持率越高，间隔越短
    const hi = schedule(card(), 3, NOW, { ...P, desiredRetention: 0.95 }, Math.random, mem).card.interval;
    expect(hi).toBeLessThan(days[1]);
  });
  it('新卡照常走学习步骤（10 分钟、1 天），毕业间隔由 FSRS 给', () => {
    let c = { ...card(), state: 'new' as const, interval: 0, reps: 0 };
    let r = schedule(c, 3, NOW, P);
    expect(r.card.state).toBe('learning');
    expect(sd(fi(r.card.due), 4)).toBe('2026-10-04'); // 良好 → 第二步（1 天）
    expect(fi(schedule(c, 1, NOW, P).card.due) - NOW).toBe(10 * 60_000); // 忘了 → 10 分钟
    c = r.card as typeof c;
    const tomorrow = new Date(2026, 9, 4, 9, 0).getTime();
    const mem = { ...nextMemory(FSRS6_DEFAULT, null, 0, 3), day: '2026-10-03' };
    const pv = preview(c, P, tomorrow, mem);
    expect(pv[1]).toEqual({ minutes: 10 });
    const good = (pv[3] as { days: number }).days;
    expect(good).toBeGreaterThanOrEqual(1);
    expect(schedule(c, 3, tomorrow, P, Math.random, mem).card).toMatchObject({ state: 'review', interval: good });
  });
  it('忘了：进入重学，重学完成后的间隔用失败后的稳定性', () => {
    const mem = { s: 30, d: 6, day: '2026-09-03' };
    const r = schedule(card({ interval: 30 }), 1, NOW, P, Math.random, mem);
    expect(r.card.state).toBe('relearning');
    expect(r.card.lapses).toBe(1);
    expect(r.card.interval).toBeLessThan(30);
    expect(sd(fi(r.card.due), 4)).toBe('2026-10-03');
  });
});
