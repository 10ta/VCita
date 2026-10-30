// 出题队列（纯函数）。每答一张重新计算，不冻结。
// 规则：
//  1. 到期的学习 / 重学卡优先（时间敏感）
//  2. 到期的复习卡与新卡（受每日上限约束）：
//     mix   = 新卡按比例均匀穿插在复习中（Anki 的 Mix with reviews）
//     after = 复习完才出新卡
//     复习卡顺序：overdue = 相对逾期（逾期时长 ÷ 间隔）大的先出；due = 按到期时间
//  3. 新卡顺序（newSort = layer）：重点主题 → 核心 → 中频 → 添加时间；created = 只按添加时间
//     额度拆分（newSplit）：每日新卡上限的 freshShare% 留给"新鲜"的卡，越新越先出；其余额度按上面的顺序消化积压。
//       source = 挖矿卡算新鲜（从自己输入里摘的，语境越新越好记）；recent = 最近 freshDays 天添加的算新鲜；off = 不拆。
//       一份用不完的额度让给另一份；出卡顺序：新鲜份额 → 其余份额 → 互相让出的部分
//  4. 同一条笔记的卡当天只出一张（今天已答过这条笔记的其他卡，推到明天）
//  5. 都没有时，20 分钟内到期的学习卡提前出（Anki 的 learn ahead）；但刚答完的那张不提前，
//     否则只剩它时会立刻重复出现（例如重学卡点"困难"= 10 分钟后，却马上又出来）
import { noteOrigin, type Card, type Note, type ReviewLog, type Settings } from '../schema';
import { addDaysToDay, dayStartMs, fromIso, studyDay } from '../lib/time';

export const LEARN_AHEAD_MS = 20 * 60_000;

export interface QueueInput {
  cards: Card[];
  /** 今天（当前学习日）的日志 */
  todayLogs: ReviewLog[];
  deckId: string;
  now: number;
  settings: Pick<Settings, 'newPerDay' | 'reviewsPerDay' | 'dayStartHour'> & Partial<Pick<Settings, 'newReviewOrder' | 'reviewSort' | 'newSort' | 'focusTags' | 'newSplit' | 'freshShare' | 'freshDays'>>;
  /** 新卡排序要用笔记的层级和主题；不传时只按添加时间 */
  notes?: ReadonlyMap<string, Pick<Note, 'layer' | 'tags'> & Partial<Pick<Note, 'origin' | 'source'>>>;
  /** 本轮跳过的卡 */
  skipped?: Set<string>;
  /** 用户点了"提前复习"：刚答完的那张也可以提前出 */
  learnAheadAll?: boolean;
}

export interface QueueState {
  next: Card | null;
  /** 当前还剩：学习中（本学习日内到期）、复习、新卡 */
  counts: { learning: number; review: number; new: number };
  done: { newDone: number; reviewDone: number };
  /** 已到期、但因每日复习上限今天出不了的复习卡 */
  reviewBacklog: number;
  /** 队列为空时，下一张学习卡的到期时间 */
  nextLearningAt: number | null;
  /** 队列为空、但有刚答完的学习卡在 20 分钟内到期，可以手动提前复习 */
  canLearnAhead: boolean;
  /** 现在可以出的所有卡（到期学习卡、20 分钟内的提前学习卡、到期复习卡、今天的新卡）。
   *  正在显示的卡不在这里面（导入 / 同步改了它的状态、兄弟卡已答等）就该换一张 */
  servable: Set<string>;
}

const byDue = (a: Card, b: Card) => fromIso(a.due) - fromIso(b.due) || (a.id < b.id ? -1 : 1);
const DAY = 86_400_000;
/** 相对逾期：逾期时长 ÷ 间隔，越大越可能已忘 */
export const relativeOverdue = (c: Card, now: number) => (now - fromIso(c.due)) / (Math.max(1, c.interval) * DAY);
const byCreated = (a: Card, b: Card) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1);

/** 新卡排序：重点主题 → 核心 → 中频 → 添加时间 */
function newCardSort(q: QueueInput): (a: Card, b: Card) => number {
  if ((q.settings.newSort ?? 'layer') !== 'layer' || !q.notes) return byCreated;
  const focus = new Set<string>(q.settings.focusTags ?? []);
  const notes = q.notes;
  const rank = (c: Card) => {
    const n = notes.get(c.noteId);
    if (!n) return 3;
    return (n.tags.some((t) => focus.has(t)) ? 0 : 2) + (n.layer === 'core' ? 0 : 1);
  };
  return (a, b) => rank(a) - rank(b) || byCreated(a, b);
}

const newestFirst = (a: Card, b: Card) => -byCreated(a, b);

/** 新卡里哪些算"新鲜"的；不拆分（或按来源拆却没有笔记信息）时返回 null */
function freshTest(q: QueueInput, today: string): ((c: Card) => boolean) | null {
  const mode = q.settings.newSplit ?? 'off';
  if (mode === 'source' && q.notes) {
    const notes = q.notes;
    return (c) => { const n = notes.get(c.noteId); return !!n && noteOrigin(n) === 'mined'; };
  }
  if (mode === 'recent') {
    const from = addDaysToDay(today, 1 - (q.settings.freshDays ?? 7));
    return (c) => studyDay(fromIso(c.createdAt), q.settings.dayStartHour) >= from;
  }
  return null;
}

/** 同一条笔记的新卡只取第一张 */
function onePerNote(cards: Card[]): Card[] {
  const seen = new Set<string>();
  return cards.filter((c) => (seen.has(c.noteId) ? false : (seen.add(c.noteId), true)));
}

/** 今天还要出的新卡（已排好序） */
function pickNew(q: QueueInput, pool: Card[], today: string, newSeen: Set<string>): Card[] {
  const newLimit = Math.max(0, q.settings.newPerDay - newSeen.size);
  const candidates = pool.filter((c) => c.state === 'new' && studyDay(fromIso(c.createdAt), q.settings.dayStartHour) <= today);
  const sort = newCardSort(q);
  const isFresh = freshTest(q, today);
  if (!isFresh) return onePerNote(candidates.sort(sort)).slice(0, newLimit);

  const byId = new Map(q.cards.map((c) => [c.id, c]));
  let seenFresh = 0;
  for (const id of newSeen) { const c = byId.get(id); if (c && isFresh(c)) seenFresh++; }
  const freshQuota = Math.round((q.settings.newPerDay * (q.settings.freshShare ?? 60)) / 100);
  const otherQuota = q.settings.newPerDay - freshQuota;
  const fresh = onePerNote(candidates.filter(isFresh).sort(newestFirst));
  const other = onePerNote(candidates.filter((c) => !isFresh(c)).sort(sort));
  const f = Math.min(fresh.length, Math.max(0, freshQuota - seenFresh), newLimit);
  const o = Math.min(other.length, Math.max(0, otherQuota - (newSeen.size - seenFresh)), newLimit - f);
  let rest = newLimit - f - o;
  const f2 = Math.min(fresh.length - f, rest);
  rest -= f2;
  const o2 = Math.min(other.length - o, rest);
  return [...fresh.slice(0, f), ...other.slice(0, o), ...fresh.slice(f, f + f2), ...other.slice(o, o + o2)];
}

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

  // 本学习日结束（下一个切换时间，默认凌晨 4 点）：明天才到期的学习卡不算进"今天还要学"
  const endOfToday = dayStartMs(addDaysToDay(today, 1), q.settings.dayStartHour);
  const learningAll = pool.filter((c) => c.state === 'learning' || c.state === 'relearning').sort(byDue);
  const learningDue = learningAll.filter((c) => fromIso(c.due) <= q.now);

  const reviewLimit = q.settings.reviewsPerDay > 0 ? Math.max(0, q.settings.reviewsPerDay - revSeen.size) : Infinity;
  const sortOverdue = (q.settings.reviewSort ?? 'overdue') === 'overdue';
  const dueReviews = pool
    .filter((c) => c.state === 'review' && fromIso(c.due) <= q.now)
    .sort(sortOverdue ? (a, b) => relativeOverdue(b, q.now) - relativeOverdue(a, q.now) || byDue(a, b) : byDue);
  const reviews = dueReviews.slice(0, reviewLimit);

  const news = pickNew(q, pool, today, newSeen);

  // 穿插：新卡的完成进度落后于复习的完成进度时出新卡，新卡就均匀分布在复习中
  let mixNew = false;
  if ((q.settings.newReviewOrder ?? 'mix') === 'mix' && reviews.length && news.length) {
    const totalNew = newSeen.size + news.length;
    const totalRev = revSeen.size + reviews.length;
    mixNew = newSeen.size / totalNew < revSeen.size / totalRev;
  }
  let next: Card | null = learningDue[0] ?? (mixNew ? news[0] : reviews[0]) ?? news[0] ?? null;
  // 今天最后答的那张卡
  let lastId: string | null = null, lastTs = '';
  for (const l of logs) if (l.ts > lastTs) { lastTs = l.ts; lastId = l.cardId; }
  const aheadAll = learningAll.filter((c) => fromIso(c.due) <= q.now + LEARN_AHEAD_MS);
  const ahead = q.learnAheadAll ? aheadAll[0] : aheadAll.find((c) => c.id !== lastId);
  if (!next && ahead) next = ahead;
  const laterLearning = learningAll.find((c) => fromIso(c.due) > q.now);

  return {
    next,
    counts: {
      learning: learningAll.filter((c) => fromIso(c.due) < endOfToday).length,
      review: reviews.length,
      new: news.length,
    },
    done: { newDone: newSeen.size, reviewDone: revSeen.size },
    reviewBacklog: dueReviews.length - reviews.length,
    nextLearningAt: next ? null : laterLearning ? fromIso(laterLearning.due) : null,
    canLearnAhead: !next && aheadAll.length > 0,
    servable: new Set([...aheadAll, ...dueReviews, ...news].map((c) => c.id)),
  };
}
