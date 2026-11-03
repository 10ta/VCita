// 统计（纯函数）。文档 §5：保持率、顽固卡、今日、未来 30 天到期、产出使用次数
import type { Card, Note, ReviewLog } from '../schema';
import { addDaysToDay, daysBetween, fromIso, studyDay } from '../lib/time';

export interface Retention { pass: number; total: number; rate: number | null }
export interface Stats {
  young: Retention;
  mature: Retention;
  all: Retention;
  leeches: number;
  leechesThisWeek: number;
  forecast: number[];
  usedTotal: number;
  usedRecent: number;
  suggestion: 'more' | 'less' | null;
  /** 最近 30 天按卡型拆开：复习卡的保持率、作答用时 */
  byType: Array<{ type: Card['type']; ret: Retention; medianSec: number | null; p90Sec: number | null; reviews: number }>;
  /** 最近 30 天按主题的保持率（复习 ≥ 15 次的主题），最低的在前 */
  byTheme: Array<{ theme: string; ret: Retention }>;
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

const ret = (pass: number, total: number): Retention => ({ pass, total, rate: total ? pass / total : null });

/** logs：最近 30 个学习日的日志（含墓碑，这里过滤）；保持率、顽固卡只看最近 14 天，按卡型 / 主题拆分看 30 天 */
export function computeStats(input: { cards: Card[]; notes: Note[]; logs: ReviewLog[]; now: number; dayStartHour: number; deckId?: string }): Stats {
  const { now, dayStartHour } = input;
  const today = studyDay(now, dayStartHour);
  const from14 = addDaysToDay(today, -13);
  const from7 = addDaysToDay(today, -6);
  const cards = input.cards.filter((c) => !c.deleted && (!input.deckId || c.deckId === input.deckId));
  const cardIds = new Set(cards.map((c) => c.id));
  const logs30 = input.logs.filter((l) => !l.deleted && l.day >= addDaysToDay(today, -29) && l.day <= today && cardIds.has(l.cardId));
  const logs = logs30.filter((l) => l.day >= from14);

  // 保持率：复习状态卡（不含新卡、学习步骤）的评分 ≥2 的比例；成熟 = 作答前间隔 ≥21 天
  let yp = 0, yt = 0, mp = 0, mt = 0;
  for (const l of logs) {
    if (l.prevState !== 'review') continue;
    const pass = l.rating >= 2 ? 1 : 0;
    if ((l.prevInterval ?? 0) >= 21) { mt++; mp += pass; } else { yt++; yp += pass; }
  }
  const all = ret(yp + mp, yt + mt);

  const leeches = cards.filter((c) => c.isLeech).length;
  const leechCards = new Set(cards.filter((c) => c.isLeech).map((c) => c.id));
  const leechesThisWeek = new Set(logs.filter((l) => l.day >= from7 && l.rating === 1 && l.prevState === 'review' && leechCards.has(l.cardId)).map((l) => l.cardId)).size;

  const forecast = new Array(30).fill(0);
  for (const c of cards) {
    if (c.suspended || c.state === 'new') continue;
    const d = Math.max(0, daysBetween(today, studyDay(fromIso(c.due), dayStartHour)));
    if (d < 30) forecast[d]++;
  }

  const notes = input.notes.filter((n) => !n.deleted && (!input.deckId || n.deckId === input.deckId));
  const since = now - 14 * 86_400_000;
  const usedTotal = notes.reduce((s, n) => s + n.usedCount, 0);
  const usedRecent = notes.reduce((s, n) => s + (n.usedAt ?? []).filter((t) => fromIso(t) >= since).length, 0);

  const suggestion = all.rate === null || all.total < 30 ? null : all.rate > 0.95 ? 'more' : all.rate < 0.8 ? 'less' : null;
  // 按卡型、主题拆开：只看复习状态的卡（不含新卡、学习步骤）
  const typeOf = new Map(cards.map((c) => [c.id, c.type]));
  const tagsOf = new Map(notes.map((n) => [n.id, n.tags]));
  const tt = new Map<string, { pass: number; total: number; secs: number[]; reviews: number }>();
  const th = new Map<string, { pass: number; total: number }>();
  for (const l of logs30) {
    const t = typeOf.get(l.cardId)!;
    const e = tt.get(t) ?? tt.set(t, { pass: 0, total: 0, secs: [], reviews: 0 }).get(t)!;
    e.reviews++;
    // 超过 3 分钟的多半是走开了，不算用时
    if (l.elapsedMs && l.elapsedMs < 180_000) e.secs.push(l.elapsedMs / 1000);
    if (l.prevState !== 'review') continue;
    e.total++; e.pass += l.rating >= 2 ? 1 : 0;
    for (const tag of tagsOf.get(l.noteId) ?? []) {
      const x = th.get(tag) ?? th.set(tag, { pass: 0, total: 0 }).get(tag)!;
      x.total++; x.pass += l.rating >= 2 ? 1 : 0;
    }
  }
  const order = ['recognition', 'production', 'cloze', 'contrast'];
  const byType = [...tt.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([type, e]) => ({
    type: type as Card['type'], ret: ret(e.pass, e.total), medianSec: quantile(e.secs, 0.5), p90Sec: quantile(e.secs, 0.9), reviews: e.reviews,
  }));
  const byTheme = [...th.entries()].filter(([, e]) => e.total >= 15).map(([theme, e]) => ({ theme, ret: ret(e.pass, e.total) }))
    .sort((a, b) => (a.ret.rate ?? 1) - (b.ret.rate ?? 1));
  return { young: ret(yp, yt), mature: ret(mp, mt), all, leeches, leechesThisWeek, forecast, usedTotal, usedRecent, suggestion, byType, byTheme };
}
