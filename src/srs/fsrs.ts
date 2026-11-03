// FSRS-6（纯函数）。公式同 open-spaced-repetition 的 fsrs-rs / ts-fsrs（MIT）：
// https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm#fsrs-6
//
// 记忆状态（稳定性 S、难度 D）不存在卡片上，每次从这张卡的复习日志重放出来：
//  - 不用迁移、不改已有数据，同步不会因此多出上千条改动
//  - 换了参数（重新优化）立刻对所有卡生效
//  - 日志不完整的老卡（第一条日志不是从新卡开始，或者根本没有日志），用当时的 SM-2 间隔和倍率换算初始状态（同 Anki 的做法）
import type { Card, ReviewLog } from '../schema';
import { addDaysToDay, daysBetween, fromIso, studyDay } from '../lib/time';

export type Grade = 1 | 2 | 3 | 4;
export interface Memory {
  /** 稳定性：记住的概率降到 90% 需要的天数 */
  s: number;
  /** 难度 1–10 */
  d: number;
  /** 最后一次复习的学习日 */
  day: string;
}

export const FSRS6_DEFAULT = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483,
  0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
] as const;
const S_MIN = 0.001;
const S_MAX = 36500;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 参数不合法（不是 21 个有限数）时退回默认参数 */
export const validWeights = (w: readonly number[] | null | undefined): readonly number[] =>
  w && w.length === 21 && w.every((x) => Number.isFinite(x)) ? w : FSRS6_DEFAULT;

const decayOf = (w: readonly number[]) => {
  const decay = -w[20];
  return { decay, factor: Math.pow(0.9, 1 / decay) - 1 };
};

/** 过了 t 天后记住的概率 */
export function retrievability(w: readonly number[], t: number, s: number): number {
  const { decay, factor } = decayOf(w);
  return Math.pow(1 + (factor * Math.max(0, t)) / s, decay);
}

/** 记住的概率降到 r 时是第几天（不取整） */
export function intervalFor(w: readonly number[], s: number, r: number): number {
  const { decay, factor } = decayOf(w);
  return (s / factor) * (Math.pow(r, 1 / decay) - 1);
}

const initS = (w: readonly number[], g: Grade) => clamp(w[g - 1], S_MIN, 100);
const initD = (w: readonly number[], g: Grade) => w[4] - Math.exp((g - 1) * w[5]) + 1;
function nextD(w: readonly number[], d: number, g: Grade): number {
  const delta = -w[6] * (g - 3);
  const next = d + (delta * (10 - d)) / 9;
  return clamp(w[7] * initD(w, 4) + (1 - w[7]) * next, 1, 10);
}
function recallS(w: readonly number[], d: number, s: number, r: number, g: Grade): number {
  const hard = g === 2 ? w[15] : 1;
  const easy = g === 4 ? w[16] : 1;
  return clamp(s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hard * easy), S_MIN, S_MAX);
}
function forgetS(w: readonly number[], d: number, s: number, r: number): number {
  const fail = clamp(w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]), S_MIN, S_MAX);
  return clamp(s / Math.exp(w[17] * w[18]), S_MIN, fail);
}
function shortTermS(w: readonly number[], s: number, g: Grade): number {
  const sinc = Math.pow(s, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]));
  return clamp(s * (g >= 2 ? Math.max(sinc, 1) : sinc), S_MIN, S_MAX);
}

/** 一次复习后的记忆状态。t = 距上次复习的学习日数；0 = 同一天（学习步骤） */
export function nextMemory(w: readonly number[], mem: Pick<Memory, 's' | 'd'> | null, t: number, g: Grade): Pick<Memory, 's' | 'd'> {
  if (!mem) return { s: initS(w, g), d: clamp(initD(w, g), 1, 10) };
  const { s, d } = mem;
  let ns: number;
  if (t === 0) ns = shortTermS(w, s, g);
  else {
    const r = retrievability(w, t, s);
    ns = g === 1 ? forgetS(w, d, s, r) : recallS(w, d, s, r, g);
  }
  return { s: ns, d: nextD(w, d, g) };
}

/** SM-2 的间隔和倍率换算成 FSRS 记忆状态（同 fsrs-rs 的 memory_state_from_sm2，按 SM-2 保持率 90% 算） */
export function memoryFromSm2(w: readonly number[], ease: number, interval: number, sm2Retention = 0.9): Pick<Memory, 's' | 'd'> {
  const { decay, factor } = decayOf(w);
  const s = clamp((Math.max(interval, S_MIN) * factor) / (Math.pow(sm2Retention, 1 / decay) - 1), S_MIN, S_MAX);
  const d = 11 - (ease - 1) / (Math.exp(w[8]) * Math.pow(s, -w[9]) * Math.expm1((1 - sm2Retention) * w[10]));
  return { s, d: clamp(d, 1, 10) };
}

type LogLike = Pick<ReviewLog, 'ts' | 'day' | 'rating' | 'prevState' | 'prevInterval' | 'prevEase' | 'prevDue' | 'deleted'>;

/**
 * 从一张卡的日志重放出现在的记忆状态。
 * card 用来兜底：没有日志、日志不从新卡开始时，用卡片（或第一条日志作答前）的 SM-2 状态换算。
 * 新卡、从没复习过的卡返回 null
 */
export function replayMemory(
  w: readonly number[], logs: readonly LogLike[], card: Pick<Card, 'state' | 'interval' | 'ease' | 'due' | 'lastReviewedAt'> | null, dayStartHour: number,
): Memory | null {
  const live = logs.filter((l) => !l.deleted).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  let mem: Memory | null = null;
  for (const l of live) {
    const g = l.rating as Grade;
    if (!mem) {
      if (l.prevState === 'new') { mem = { ...nextMemory(w, null, 0, g), day: l.day }; continue; }
      // 日志不完整：从这条日志作答前的 SM-2 状态起算；上次复习日 ≈ 到期日 − 间隔
      const ivl = Math.max(1, l.prevInterval ?? 1);
      const lastDay = l.prevDue ? addDaysToDay(studyDay(fromIso(l.prevDue), dayStartHour), -ivl) : l.day;
      mem = { ...memoryFromSm2(w, l.prevEase ?? 2.5, ivl), day: lastDay };
    }
    const t = Math.max(0, daysBetween(mem.day, l.day));
    mem = { ...nextMemory(w, mem, t, g), day: l.day };
  }
  if (mem || !card || card.state === 'new') return mem;
  // 一条日志都没有的老卡（服务器时代迁移来的）
  const ivl = Math.max(1, card.interval);
  const last = card.lastReviewedAt ? studyDay(fromIso(card.lastReviewedAt), dayStartHour) : addDaysToDay(studyDay(fromIso(card.due), dayStartHour), -ivl);
  return { ...memoryFromSm2(w, card.ease, ivl), day: last };
}

/** 按卡分组重放所有卡的记忆状态 */
export function memoryMap(
  w: readonly number[], cards: readonly Card[], logs: readonly ReviewLog[], dayStartHour: number,
): Map<string, Memory> {
  const by = new Map<string, ReviewLog[]>();
  for (const l of logs) if (!l.deleted) (by.get(l.cardId) ?? by.set(l.cardId, []).get(l.cardId)!).push(l);
  const out = new Map<string, Memory>();
  for (const c of cards) {
    const m = replayMemory(w, by.get(c.id) ?? [], c, dayStartHour);
    if (m) out.set(c.id, m);
  }
  return out;
}

/** 现在记住的概率 */
export const currentR = (w: readonly number[], mem: Memory, today: string) => retrievability(w, Math.max(0, daysBetween(mem.day, today)), mem.s);
