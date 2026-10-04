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
}

const ret = (pass: number, total: number): Retention => ({ pass, total, rate: total ? pass / total : null });

/** logs：最近 14 个学习日的日志（含墓碑，这里过滤） */
export function computeStats(input: { cards: Card[]; notes: Note[]; logs: ReviewLog[]; now: number; dayStartHour: number; deckId?: string }): Stats {
  const { now, dayStartHour } = input;
  const today = studyDay(now, dayStartHour);
  const from14 = addDaysToDay(today, -13);
  const from7 = addDaysToDay(today, -6);
  const cards = input.cards.filter((c) => !c.deleted && (!input.deckId || c.deckId === input.deckId));
  const cardIds = new Set(cards.map((c) => c.id));
  const logs = input.logs.filter((l) => !l.deleted && l.day >= from14 && l.day <= today && cardIds.has(l.cardId));

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
  return { young: ret(yp, yt), mature: ret(mp, mt), all, leeches, leechesThisWeek, forecast, usedTotal, usedRecent, suggestion };
}
