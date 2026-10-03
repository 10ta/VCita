// 出题队列（纯函数）。每答一张重新计算，不冻结。
// 规则：
//  1. 到期的学习 / 重学卡优先（时间敏感）
//  2. 然后是到期的复习卡；有到期复习卡时不出新卡
//  3. 最后是新卡，受每日上限约束
//  4. 同一条笔记的卡当天只出一张（今天已答过这条笔记的其他卡，推到明天）
//  5. 都没有时，20 分钟内到期的学习卡提前出（Anki 的 learn ahead）
import type { Card, ReviewLog, Settings } from '../schema';
import { fromIso, studyDay } from '../lib/time';

export const LEARN_AHEAD_MS = 20 * 60_000;

export interface QueueInput {
  cards: Card[];
  /** 今天（当前学习日）的日志 */
  todayLogs: ReviewLog[];
  deckId: string;
  now: number;
  settings: Pick<Settings, 'newPerDay' | 'reviewsPerDay' | 'dayStartHour'>;
  /** 本轮跳过的卡 */
  skipped?: Set<string>;
}

export interface QueueState {
  next: Card | null;
  /** 当前还剩：学习中（今天内到期）、复习、新卡 */
  counts: { learning: number; review: number; new: number };
  done: { newDone: number; reviewDone: number };
  /** 队列为空时，下一张学习卡的到期时间 */
  nextLearningAt: number | null;
}

const byDue = (a: Card, b: Card) => fromIso(a.due) - fromIso(b.due) || (a.id < b.id ? -1 : 1);
const byCreated = (a: Card, b: Card) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1);

export function buildQueue(q: QueueInput): QueueState {
  const today = studyDay(q.now, q.settings.dayStartHour);
  const logs = q.todayLogs.filter((l) => !l.deleted && l.day === today);
  const newSeen = new Set<string>();
  const revSeen = new Set<string>();
  const notesToday = new Set<string>();
  const cardsToday = new Set<string>();
  for (const l of logs) {
    if (l.prevState === 'new') newSeen.add(l.cardId);
    else if (l.prevState === 'review') revSeen.add(l.cardId);
    notesToday.add(l.noteId);
    cardsToday.add(l.cardId);
  }
  // 今天已答过这条笔记的另一张卡 → 兄弟卡今天不出
  const sibling = (c: Card) => notesToday.has(c.noteId) && !cardsToday.has(c.id);
  const skipped = q.skipped ?? new Set<string>();
  const pool = q.cards.filter((c) => c.deckId === q.deckId && !c.deleted && !c.suspended && !skipped.has(c.id) && !sibling(c));

  const endOfToday = q.now + 24 * 3_600_000;
  const learningAll = pool.filter((c) => c.state === 'learning' || c.state === 'relearning').sort(byDue);
  const learningDue = learningAll.filter((c) => fromIso(c.due) <= q.now);

  const reviewLimit = q.settings.reviewsPerDay > 0 ? Math.max(0, q.settings.reviewsPerDay - revSeen.size) : Infinity;
  const reviews = pool.filter((c) => c.state === 'review' && fromIso(c.due) <= q.now).sort(byDue).slice(0, reviewLimit);

  const newLimit = Math.max(0, q.settings.newPerDay - newSeen.size);
  const newNotes = new Set<string>();
  const news: Card[] = [];
  for (const c of pool.filter((c) => c.state === 'new' && studyDay(fromIso(c.createdAt), q.settings.dayStartHour) <= today).sort(byCreated)) {
    if (news.length >= newLimit) break;
    if (newNotes.has(c.noteId)) continue; // 同一条笔记的新卡也只出一张
    newNotes.add(c.noteId);
    news.push(c);
  }

  let next: Card | null = learningDue[0] ?? reviews[0] ?? news[0] ?? null;
  const ahead = learningAll.find((c) => fromIso(c.due) <= q.now + LEARN_AHEAD_MS);
  if (!next && ahead) next = ahead;
  const laterLearning = learningAll.find((c) => fromIso(c.due) > q.now);

  return {
    next,
    counts: {
      learning: learningAll.filter((c) => fromIso(c.due) <= endOfToday).length,
      review: reviews.length,
      new: news.length,
    },
    done: { newDone: newSeen.size, reviewDone: revSeen.size },
    nextLearningAt: next ? null : laterLearning ? fromIso(laterLearning.due) : null,
  };
}
