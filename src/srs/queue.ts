// 出题队列（纯函数）。每答一张重新计算，不冻结。
// 规则：
//  1. 到期的学习 / 重学卡优先（时间敏感）
//  2. 到期的复习卡与新卡（受每日上限约束）：
//     mix   = 新卡按比例均匀穿插在复习中（Anki 的 Mix with reviews）
//     after = 复习完才出新卡
//     复习卡顺序：overdue = 相对逾期（逾期时长 ÷ 间隔）大的先出；due = 按到期时间
//  3. 新卡顺序（newSort = layer）：重点主题 → 核心 → 中频，同一层里常用词先出（Lexique 词频）→ 添加时间；
//     freq = 重点主题 → 常用词先出（不分核心 / 中频）；created = 只按添加时间。
//     依据：词汇覆盖率研究（Nation）——最常用的几千个词覆盖了绝大部分文本，先学常用词每张卡回报最高
//     额度拆分（newSplit）：每日新卡上限的 freshShare% 留给"新鲜"的卡，越新越先出；其余额度按上面的顺序消化积压。
//       source = 挖矿卡算新鲜（从自己输入里摘的，语境越新越好记）；recent = 最近 freshDays 天添加的算新鲜；off = 不拆。
//       一份用不完的额度让给另一份；出卡顺序：新鲜份额 → 其余份额 → 互相让出的部分
//     句框（语块库）：每日新卡上限里留 frameNewPerDay 张给句框笔记的卡（默认 3），没用完的让给单词；
//       套用卡要等同一条句框的句框卡进入复习（学会了句框）才出
//  4. 同一条笔记的卡当天只出一张（今天已答过这条笔记的其他卡，推到明天）；同一个易混组的辨析卡当天也只出一张
//  5. 都没有时，20 分钟内到期的学习卡提前出（Anki 的 learn ahead）；只提前本学习日内到期的，
//     跨过换日时间的不提前（换天前 18 分钟不能把"1 天"步骤、换天后才到期的卡拿出来，它属于明天）；刚答完的那张不提前，
//     否则只剩它时会立刻重复出现（例如重学卡点"困难"= 10 分钟后，却马上又出来）
import { isDue } from './scheduler';
import { noteOrigin, type Card, type Note, type ReviewLog, type Settings } from '../schema';
import { addDaysToDay, dayStartMs, fromIso, studyDay } from '../lib/time';

export const LEARN_AHEAD_MS = 20 * 60_000;

export interface QueueInput {
  cards: Card[];
  /** 今天（当前学习日）的日志 */
  todayLogs: ReviewLog[];
  deckId: string;
  now: number;
  settings: Pick<Settings, 'newPerDay' | 'reviewsPerDay' | 'dayStartHour'> & Partial<Pick<Settings, 'newReviewOrder' | 'reviewSort' | 'newSort' | 'focusTags' | 'newSplit' | 'freshShare' | 'freshDays' | 'frameNewPerDay' | 'productionAfterRecognition'>>;
  /** 新卡排序要用笔记的层级和主题；不传时只按添加时间 */
  notes?: ReadonlyMap<string, Pick<Note, 'layer' | 'tags'> & Partial<Pick<Note, 'origin' | 'source' | 'contrastGroup' | 'frame'>>>;
  /** 笔记的词频（每百万词，见 lib/gender/dict.ts 的 lemmaFreq）；查不到的排在同一层的最后。不传时按添加时间 */
  freq?: ReadonlyMap<string, number | null>;
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
  const mode = q.settings.newSort ?? 'layer';
  if (mode === 'created' || !q.notes) return byCreated;
  const focus = new Set<string>(q.settings.focusTags ?? []);
  const notes = q.notes;
  const rank = (c: Card) => {
    const n = notes.get(c.noteId);
    if (!n) return 3;
    return (n.tags.some((t) => focus.has(t)) ? 0 : 2) + (mode === 'freq' || n.layer === 'core' ? 0 : 1);
  };
  const f = (c: Card) => q.freq?.get(c.noteId) ?? -1;
  return (a, b) => rank(a) - rank(b) || f(b) - f(a) || byCreated(a, b);
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

/** 今天还要出的新卡（已排好序）：句框先分走自己的份额，其余按单词的规则出 */
function pickNew(q: QueueInput, pool: Card[], today: string, newSeen: Set<string>): Card[] {
  const byId = new Map(q.cards.map((c) => [c.id, c]));
  // 套用卡：同一条笔记的句框卡还没进入复习时不出
  const frameState = new Map<string, Card['state']>();
  for (const c of q.cards) if (c.type === 'frame' && !c.deleted) frameState.set(c.noteId, c.state);
  // 产出卡、辨析卡：同一条笔记有认读卡、而认读卡还没进入复习时不出（先认得，再练写得出 / 再和别的词比）
  const recState = new Map<string, Card['state']>();
  for (const c of q.cards) if (c.type === 'recognition' && !c.deleted && !c.suspended) recState.set(c.noteId, c.state);
  const gateProd = q.settings.productionAfterRecognition !== false;
  const due = pool.filter((c) => c.state === 'new' && studyDay(fromIso(c.createdAt), q.settings.dayStartHour) <= today
    && (c.type !== 'apply' || frameState.get(c.noteId) === 'review')
    && ((c.type !== 'production' && c.type !== 'contrast') || !gateProd || !recState.has(c.noteId) || recState.get(c.noteId) === 'review'));
  const notes = q.notes;
  const isFrame = (c: Card) => !!notes?.get(c.noteId)?.frame;
  const frameCands = notes ? due.filter(isFrame) : [];
  const wordCands = notes ? due.filter((c) => !isFrame(c)) : due;

  let seenFrames = 0;
  for (const id of newSeen) { const c = byId.get(id); if (c && isFrame(c)) seenFrames++; }
  const newLimit = Math.max(0, q.settings.newPerDay - newSeen.size);
  const frameQuota = Math.min(q.settings.frameNewPerDay ?? 3, q.settings.newPerDay);
  const frames = onePerNote(frameCands.sort(byCreated)).slice(0, Math.max(0, Math.min(frameQuota - seenFrames, newLimit)));
  // 单词：上限扣掉句框今天用掉的和要出的；句框没用完的份额自然留给单词
  const wordSeen = new Set([...newSeen].filter((id) => { const c = byId.get(id); return !c || !isFrame(c); }));
  const words = pickWords(q, wordCands, today, wordSeen, q.settings.newPerDay - seenFrames - frames.length);
  // 句框均匀穿插在单词新卡中间
  const out = [...words];
  frames.forEach((f, i) => out.splice(Math.round(((i + 1) * words.length) / (frames.length + 1)) + i, 0, f));
  return out;
}

/** 单词新卡：按 newSort 排序，按 newSplit 拆额度（见文件开头） */
function pickWords(q: QueueInput, candidates: Card[], today: string, newSeen: Set<string>, newPerDay: number): Card[] {
  const newLimit = Math.max(0, newPerDay - newSeen.size);
  const sort = newCardSort(q);
  const isFresh = freshTest(q, today);
  if (!isFresh) return onePerNote(candidates.sort(sort)).slice(0, newLimit);

  const byId = new Map(q.cards.map((c) => [c.id, c]));
  let seenFresh = 0;
  for (const id of newSeen) { const c = byId.get(id); if (c && isFresh(c)) seenFresh++; }
  const freshQuota = Math.round((newPerDay * (q.settings.freshShare ?? 60)) / 100);
  const otherQuota = newPerDay - freshQuota;
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
  // 隐性复习（产出卡答对时顺带记的认读）不算今天复习过：不占复习额度，也不触发同笔记兄弟卡今天不出
  const logs = q.todayLogs.filter((l) => !l.deleted && l.day === today && !l.implicit);
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
  // 今天已答过这条笔记的另一张卡 → 兄弟卡今天不出；同一个易混组的辨析卡也一样
  const typeOf = new Map(q.cards.map((c) => [c.id, c.type]));
  const groupOf = (noteId: string) => q.notes?.get(noteId)?.contrastGroup ?? null;
  const groupsToday = new Set(logs.filter((l) => typeOf.get(l.cardId) === 'contrast').map((l) => groupOf(l.noteId)).filter(Boolean));
  const sibling = (c: Card) => !cardsToday.has(c.id) && (notesToday.has(c.noteId) || (c.type === 'contrast' && groupsToday.has(groupOf(c.noteId))));
  const skipped = q.skipped ?? new Set<string>();
  const pool = q.cards.filter((c) => c.deckId === q.deckId && !c.deleted && !c.suspended && !skipped.has(c.id) && !sibling(c));

  // 本学习日结束（下一个切换时间，按设置的时区）：明天才到期的学习卡不算进"今天还要学"
  const endOfToday = dayStartMs(addDaysToDay(today, 1), q.settings.dayStartHour);
  const learningAll = pool.filter((c) => c.state === 'learning' || c.state === 'relearning').sort(byDue);
  const learningDue = learningAll.filter((c) => fromIso(c.due) <= q.now);
  // 本学习日内到期的学习卡：计数、提前学习都只看这些，保证屏幕上能出的卡一定算在计数里
  const learningToday = learningAll.filter((c) => fromIso(c.due) < endOfToday);

  const reviewLimit = q.settings.reviewsPerDay > 0 ? Math.max(0, q.settings.reviewsPerDay - revSeen.size) : Infinity;
  const sortOverdue = (q.settings.reviewSort ?? 'overdue') === 'overdue';
  const dueReviews = pool
    .filter((c) => c.state === 'review' && isDue(c, q.now, q.settings.dayStartHour))
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
  const aheadAll = learningToday.filter((c) => fromIso(c.due) <= q.now + LEARN_AHEAD_MS);
  const ahead = q.learnAheadAll ? aheadAll[0] : aheadAll.find((c) => c.id !== lastId);
  if (!next && ahead) next = ahead;
  const laterLearning = learningToday.find((c) => fromIso(c.due) > q.now);

  return {
    next,
    counts: {
      learning: learningToday.length,
      review: reviews.length,
      new: news.length,
    },
    done: { newDone: newSeen.size, reviewDone: revSeen.size },
    reviewBacklog: dueReviews.length - reviews.length,
    nextLearningAt: next ? null : laterLearning ? fromIso(laterLearning.due) : null,
    canLearnAhead: !next && aheadAll.length > 0,
    // 只含计数里的卡（复习卡不含被每日上限挡住的）：servable ⊆ 计数，计数 0 0 0 时一定没有卡可出
    servable: new Set([...learningDue, ...aheadAll, ...reviews, ...news].map((c) => c.id)),
  };
}
