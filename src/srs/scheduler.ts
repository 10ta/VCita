// 调度（纯函数）。规则见 README「复习算法」。
// 两种算法共用学习 / 重学步骤（分钟级）和状态机，只是"天级间隔"的算法不同：
//  - FSRS（默认）：间隔 = 记住的概率降到目标保持率的那一天；记忆状态由 fsrs.ts 从日志重放，作为 mem 传进来
//  - SM-2：下面这些规则
//  - 新卡：按学习步骤（默认 10 分钟、1 天）走完后毕业，毕业间隔 3 天；"容易"直接毕业 4 天
//  - 复习卡：困难 ×1.2 / 良好 ×ease / 容易 ×ease×1.3；忘了 → 重学步骤，结束后间隔 ×0.5
//  - 逾期答对（困难/良好/容易）按逾期天数加成，但额外天数不超过 overdueBonusMaxDays
//  - 1 天以上的步骤和所有复习间隔都对齐到学习日开始（设置的切换时间）
import type { Card, CardState, Settings } from '../schema';
import { addDaysToDay, dayStartMs, daysBetween, fromIso, studyDay, toIso } from '../lib/time';
import { intervalFor, nextMemory, validWeights, type Grade, type Memory } from './fsrs';

export type Rating = 1 | 2 | 3 | 4;
export type SrsParams = Pick<
  Settings,
  | 'learningSteps' | 'relearnSteps' | 'graduatingInterval' | 'easyInterval' | 'startingEase' | 'minEase'
  | 'hardFactor' | 'easyBonus' | 'lapseFactor' | 'maxInterval' | 'leechThreshold' | 'dayStartHour' | 'fuzz'
> & Partial<Pick<Settings, 'overdueBonusMaxDays' | 'scheduler' | 'desiredRetention' | 'fsrsWeights'>>;

const useFsrs = (p: SrsParams) => (p.scheduler ?? 'sm2') === 'fsrs';

/** FSRS：四个评分各自的新记忆状态和天级间隔（复习卡的间隔保证 困难 ≤ 良好 < 容易） */
export function fsrsOutcomes(card: Sched, p: SrsParams, now: number, mem: Memory | null): Record<Rating, { mem: Pick<Memory, 's' | 'd'>; days: number }> {
  const w = validWeights(p.fsrsWeights);
  const r = p.desiredRetention ?? 0.9;
  const today = studyDay(now, p.dayStartHour);
  const t = mem ? Math.max(0, daysBetween(mem.day, today)) : 0;
  const days = (s: number) => Math.min(p.maxInterval, Math.max(1, Math.round(intervalFor(w, s, r))));
  const out = {} as Record<Rating, { mem: Pick<Memory, 's' | 'd'>; days: number }>;
  for (const g of [1, 2, 3, 4] as Grade[]) { const m = nextMemory(w, mem, t, g); out[g] = { mem: m, days: days(m.s) }; }
  if (card.state === 'review') {
    out[2].days = Math.min(out[2].days, out[3].days);
    out[3].days = Math.max(out[3].days, out[2].days + 1);
  }
  out[4].days = Math.max(out[4].days, out[3].days + 1);
  return out;
}

type Sched = Pick<Card, 'state' | 'due' | 'interval' | 'ease' | 'reps' | 'lapses' | 'step' | 'lastReviewedAt' | 'isLeech' | 'suspended'>;

/** 下一次出现的时间：分钟级步骤或天级间隔 */
export type NextIn = { minutes: number } | { days: number };

const MIN = 60_000;
const round2 = (x: number) => Math.round(x * 100) / 100;

function dueAfterDays(now: number, days: number, p: SrsParams): string {
  return toIso(dayStartMs(addDaysToDay(studyDay(now, p.dayStartHour), days), p.dayStartHour));
}
function dueAfterMinutes(now: number, minutes: number, p: SrsParams): string {
  // 1 天以上的步骤按学习日对齐，否则换天前学的卡会在第二天同一时刻才到期
  if (minutes >= 1440) return dueAfterDays(now, Math.round(minutes / 1440), p);
  return toIso(now + minutes * MIN);
}

export function fuzzInterval(ivl: number, p: SrsParams, rand: () => number): number {
  if (!p.fuzz || ivl < 3) return ivl;
  const f = Math.max(1, Math.round(ivl * 0.05));
  return Math.min(p.maxInterval, ivl - f + Math.floor(rand() * (2 * f + 1)));
}

/** 复习卡逾期了几个学习日（未到期为 0） */
export function overdueDays(card: Pick<Card, 'due'>, now: number, dayStartHour: number): number {
  return Math.max(0, daysBetween(studyDay(fromIso(card.due), dayStartHour), studyDay(now, dayStartHour)));
}

/** 复习卡四个评分的新间隔（不含扰动）。
 *  逾期加成同 Anki：困难 +逾期/4、良好 +逾期/2、容易 +逾期 天参与计算，
 *  但每个按钮因逾期多出的天数最多 overdueBonusMaxDays（0 = 不加成） */
function reviewIntervals(card: Sched, p: SrsParams, now?: number) {
  const ivl = Math.max(1, card.interval);
  const cap = (x: number) => Math.min(p.maxInterval, x);
  const maxBonus = p.overdueBonusMaxDays ?? 30;
  const delay = now === undefined || maxBonus <= 0 ? 0 : overdueDays(card, now, p.dayStartHour);
  const extra = (base: number, withDelay: number) => Math.min(maxBonus, Math.max(0, Math.round(withDelay) - base));
  const hard0 = Math.max(ivl + 1, Math.round(ivl * p.hardFactor));
  const good0 = Math.max(hard0 + 1, Math.round(ivl * card.ease));
  const easy0 = Math.max(good0 + 1, Math.round(ivl * card.ease * p.easyBonus));
  const hard = cap(hard0 + extra(hard0, (ivl + delay / 4) * p.hardFactor));
  const good = cap(Math.max(hard + 1, good0 + extra(good0, (ivl + delay / 2) * card.ease)));
  const easy = cap(Math.max(good + 1, easy0 + extra(easy0, (ivl + delay) * card.ease * p.easyBonus)));
  const lapse = Math.max(1, Math.round(ivl * p.lapseFactor));
  return { hard, good, easy, lapse };
}

/** 四个按钮上显示的"多久后再见" */
export function preview(card: Sched, p: SrsParams, now: number, mem: Memory | null = null): Record<Rating, NextIn> {
  const steps = p.learningSteps;
  const f = useFsrs(p) ? fsrsOutcomes(card, p, now, mem) : null;
  if (card.state === 'new' || card.state === 'learning') {
    const cur = card.state === 'new' ? 0 : card.step;
    const next = cur + 1;
    return {
      1: steps.length ? { minutes: steps[0] } : { days: f ? f[1].days : 1 },
      2: steps.length ? { minutes: steps[Math.min(cur, steps.length - 1)] } : { days: f ? f[2].days : p.graduatingInterval },
      3: next < steps.length ? { minutes: steps[next] } : { days: f ? f[3].days : p.graduatingInterval },
      4: { days: f ? f[4].days : p.easyInterval },
    };
  }
  if (card.state === 'relearning') {
    const rs = p.relearnSteps;
    const next = card.step + 1;
    return {
      1: rs.length ? { minutes: rs[0] } : { days: f ? f[1].days : card.interval },
      2: rs.length ? { minutes: rs[Math.min(card.step, rs.length - 1)] } : { days: f ? f[2].days : card.interval },
      3: next < rs.length ? { minutes: rs[next] } : { days: f ? f[3].days : Math.max(1, card.interval) },
      4: { days: f ? f[4].days : Math.max(1, card.interval) },
    };
  }
  if (f) return { 1: p.relearnSteps.length ? { minutes: p.relearnSteps[0] } : { days: f[1].days }, 2: { days: f[2].days }, 3: { days: f[3].days }, 4: { days: f[4].days } };
  const r = reviewIntervals(card, p, now);
  return { 1: p.relearnSteps.length ? { minutes: p.relearnSteps[0] } : { days: r.lapse }, 2: { days: r.hard }, 3: { days: r.good }, 4: { days: r.easy } };
}

export interface ScheduleResult<C> {
  card: C;
  prevState: CardState;
  leechNow: boolean;
}

export function schedule<C extends Sched>(card: C, rating: Rating, now: number, p: SrsParams, rand: () => number = Math.random, mem: Memory | null = null): ScheduleResult<C> {
  const prevState = card.state;
  const f = useFsrs(p) ? fsrsOutcomes(card, p, now, mem) : null;
  const c = { ...card, reps: card.reps + 1, lastReviewedAt: toIso(now) };
  let leechNow = false;
  const graduate = (days: number) => {
    c.state = 'review';
    c.step = 0;
    c.interval = days;
    c.due = dueAfterDays(now, days, p);
  };
  const toStep = (state: 'learning' | 'relearning', steps: number[], i: number) => {
    c.state = state;
    c.step = i;
    c.due = dueAfterMinutes(now, steps[i], p);
  };

  if (card.state === 'new' || card.state === 'learning') {
    const steps = p.learningSteps;
    const cur = card.state === 'new' ? 0 : card.step;
    if (rating === 4 || steps.length === 0) graduate(f ? f[rating].days : rating === 4 ? p.easyInterval : rating === 1 ? 1 : p.graduatingInterval);
    else if (rating === 1) toStep('learning', steps, 0);
    else if (rating === 2) toStep('learning', steps, Math.min(cur, steps.length - 1));
    else if (cur + 1 < steps.length) toStep('learning', steps, cur + 1);
    else graduate(f ? f[3].days : p.graduatingInterval);
  } else if (card.state === 'relearning') {
    const rs = p.relearnSteps;
    const keep = f ? f[rating].days : Math.max(1, card.interval);
    if (rating === 4 || rs.length === 0) graduate(keep);
    else if (rating === 1) toStep('relearning', rs, 0);
    else if (rating === 2) toStep('relearning', rs, Math.min(card.step, rs.length - 1));
    else if (card.step + 1 < rs.length) toStep('relearning', rs, card.step + 1);
    else graduate(keep);
  } else {
    const r = reviewIntervals(card, p, now);
    if (rating === 1) {
      c.lapses = card.lapses + 1;
      c.ease = round2(Math.max(p.minEase, card.ease - 0.2));
      c.interval = f ? f[1].days : r.lapse;
      if (p.relearnSteps.length) toStep('relearning', p.relearnSteps, 0);
      else graduate(r.lapse);
      if (p.leechThreshold > 0 && c.lapses >= p.leechThreshold && !card.isLeech) {
        c.isLeech = true;
        c.suspended = true;
        leechNow = true;
      }
    } else {
      const ivl = fuzzInterval(f ? f[rating].days : rating === 2 ? r.hard : rating === 3 ? r.good : r.easy, p, rand);
      if (rating === 2) c.ease = round2(Math.max(p.minEase, card.ease - 0.15));
      if (rating === 4) c.ease = round2(card.ease + 0.15);
      graduate(ivl);
    }
  }
  return { card: c, prevState, leechNow };
}

export const fmtNextIn = (n: NextIn, fmtM: (m: number) => string, fmtD: (d: number) => string) =>
  'minutes' in n ? fmtM(n.minutes) : fmtD(n.days);

/**
 * 卡片当前是否已到期：学习 / 重学卡按到期时刻（分钟级），复习卡按学习日。
 * 复习卡的 due 是排期那一刻按当时的切换时间算的时间点；改过切换时间或时区（或在时区不同的设备上复习过）后，
 * 老卡的时间点和新的切换时间对不上，按时刻判断会在一天中途陆续冒出来。按学习日判断，新的一天开始时就全部到期。
 */
export function isDue(card: Pick<Card, 'due' | 'state'>, now: number, dayStartHour: number): boolean {
  if (card.state === 'review') return studyDay(fromIso(card.due), dayStartHour) <= studyDay(now, dayStartHour);
  return fromIso(card.due) <= now;
}
