// 负荷预测（纯函数）：按 FSRS 模拟未来 N 天每天要复习多少张，比较不同的每日新卡数。
// 简化：到期就复习；记住的概率按 FSRS 算，记住评"良好"，忘了评"忘了"并当天重学一次；
// 新卡第一天走一遍学习步骤，之后按 FSRS 间隔。只用来比较量级，不是精确排期。
import type { Card } from '../schema';
import { daysBetween, fromIso, studyDay } from '../lib/time';
import { intervalFor, nextMemory, retrievability, type Memory } from './fsrs';

export interface SimInput {
  cards: readonly Card[];
  memories: ReadonlyMap<string, Memory>;
  weights: readonly number[];
  retention: number;
  /** 学习步骤里 1 天及以上的步数（默认 10 分钟、1 天 → 1） */
  dayStepCount: number;
  /** 分钟级的学习步骤数（默认 1） */
  minuteStepCount: number;
  maxInterval: number;
  today: string;
  dayStartHour: number;
  days: number;
  newPerDay: number;
  /** 待学新卡有多少张（学完就没有了） */
  newAvailable: number;
  seed?: number;
}
export interface SimResult {
  /** 每天的复习次数（含学习步骤、重学） */
  perDay: number[];
  avg: number;
  peak: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimCard { s: number; d: number; last: number; due: number }

export function simulate(q: SimInput, runs = 3): SimResult {
  const total = new Array(q.days).fill(0);
  for (let run = 0; run < runs; run++) {
    const rand = rng((q.seed ?? 1) + run * 7919);
    const perDay = new Array(q.days).fill(0);
    const ivl = (s: number) => Math.min(q.maxInterval, Math.max(1, Math.round(intervalFor(q.weights, s, q.retention))));
    const deck: SimCard[] = [];
    for (const c of q.cards) {
      if (c.deleted || c.suspended || c.state === 'new') continue;
      const m = q.memories.get(c.id);
      if (!m) continue;
      const due = Math.max(0, daysBetween(q.today, studyDay(fromIso(c.due), q.dayStartHour)));
      deck.push({ s: m.s, d: m.d, last: daysBetween(q.today, m.day), due });
    }
    let left = q.newAvailable;
    for (let day = 0; day < q.days; day++) {
      // 今天的新卡：分钟级步骤当天各一次（评良好），天级步骤之后每天一次
      const n = Math.min(q.newPerDay, left);
      left -= n;
      for (let i = 0; i < n; i++) {
        let m = nextMemory(q.weights, null, 0, 3);
        perDay[day] += 1 + Math.max(0, q.minuteStepCount - 1);
        let d = day;
        for (let k = 0; k < q.dayStepCount; k++) {
          d++;
          if (d < q.days) perDay[d]++;
          m = nextMemory(q.weights, m, 1, 3);
        }
        deck.push({ s: m.s, d: m.d, last: d, due: d + ivl(m.s) });
      }
      for (const c of deck) {
        if (c.due !== day) continue;
        const r = retrievability(q.weights, day - c.last, c.s);
        const ok = rand() < r;
        let m = nextMemory(q.weights, c, day - c.last, ok ? 3 : 1);
        perDay[day]++;
        if (!ok) { m = nextMemory(q.weights, m, 0, 3); perDay[day]++; }
        c.s = m.s; c.d = m.d; c.last = day; c.due = day + ivl(m.s);
      }
    }
    perDay.forEach((x, i) => (total[i] += x));
  }
  const perDay = total.map((x) => Math.round(x / runs));
  return { perDay, avg: Math.round(perDay.reduce((a, b) => a + b, 0) / q.days), peak: Math.max(0, ...perDay) };
}

/** 学习步骤里分钟级 / 天级各有几步 */
export const stepCounts = (steps: readonly number[]) => ({
  minuteStepCount: Math.max(1, steps.filter((m) => m < 1440).length),
  dayStepCount: steps.filter((m) => m >= 1440).length,
});

