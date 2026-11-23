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
//     错题卡（origin = error，TCF 错题里抽出来的点）：不管怎么拆，在各自的份额里都排最前；按来源拆时算新鲜
//     句框（语块库）：每日新卡上限里留 frameNewPerDay 张给句框笔记的卡（默认 3），没用完的让给单词；
//       套用卡要等同一条句框的句框卡进入复习（学会了句框）才出
//  4. 同一条笔记的卡当天只出一张（今天已答过这条笔记的其他卡，推到明天）；同一个易混组的辨析卡当天也只出一张
//  5. 都没有时，20 分钟内到期的学习卡提前出（Anki 的 learn ahead）；只提前本学习日内到期的，
//     跨过换日时间的不提前（换天前 18 分钟不能把"1 天"步骤、换天后才到期的卡拿出来，它属于明天）；刚答完的那张不提前，
//     否则只剩它时会立刻重复出现（例如重学卡点"困难"= 10 分钟后，却马上又出来）
//  6. 每日新卡计划：每个学习日第一次出题时，把今天要出的新卡定下来（NewPlan，存在这台设备上），当天只从计划里出。
//     计划之后才变得能出的卡（认读卡毕业放出的产出卡、改好的待修笔记、同步来的变化）明天再进计划，不会在清零后陆续冒出来；
//     例外是计划之后新加 / 导入的笔记，可以补进今天没用完的额度。改了新卡相关的设置时计划重做。
//     今天要复习的笔记（学习卡今天到期、或在今天的复习额度里）不进新卡计划：答完那张兄弟卡它就会被规则 4 挡住，
//     算进去只会让新卡数在一天中途莫名变少
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
  notes?: ReadonlyMap<string, Pick<Note, 'layer' | 'tags'> & Partial<Pick<Note, 'origin' | 'source' | 'contrastGroup' | 'frame' | 'fixme'>>>;
  /** 笔记的词频（每百万词，见 lib/gender/dict.ts 的 lemmaFreq）；查不到的排在同一层的最后。不传时按添加时间 */
  freq?: ReadonlyMap<string, number | null>;
  /** 本轮跳过的卡 */
  skipped?: Set<string>;
  /** 用户点了"提前复习"：刚答完的那张也可以提前出 */
  learnAheadAll?: boolean;
  /** 今天的新卡计划（见规则 6）。null = 还没有，按现在的情况做一份；不传 = 不用计划（每次重算，测试和预测下一张用） */
  newPlan?: NewPlan | null;
}

/** 某个学习日、某个牌组的新卡计划 */
export interface NewPlan {
  day: string;
  deckId: string;
  /** 做计划时新卡相关设置的签名：设置变了就重做 */
  sig: string;
  /** 今天要出的新卡，按出卡顺序 */
  ids: string[];
  /** 做计划时已经有新卡的笔记：之后出现的其他笔记算"新加的"，可以补进今天的额度 */
  knownNotes: string[];
  madeAt: number;
}

/** 新卡比上限少时的原因（按笔记计数，和词库「新卡」筛选的条数对得上） */
export interface NewInfo {
  limit: number;
  done: number;
  left: number;
  /** 牌组里还有新卡的笔记数（含暂停的），等于词库「新卡」筛选的条数 */
  notesWithNew: number;
  /** 今天不出的笔记数，按原因 */
  waiting: Record<NewWait, number>;
}
export type NewWait = 'suspended' | 'fixme' | 'studied' | 'busy' | 'skipped' | 'gated' | 'later' | 'limit';

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
  /** 今天的新卡计划：和传进来的是同一个对象表示没变，不用保存 */
  newPlan: NewPlan;
  newInfo: NewInfo;
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

/** 错题卡排在最前（同为错题或同不是时返回 0，交给后面的排序） */
function errorFirst(q: QueueInput, sort: (a: Card, b: Card) => number): (a: Card, b: Card) => number {
  const notes = q.notes;
  if (!notes) return sort;
  const isErr = (c: Card) => { const n = notes.get(c.noteId); return n && noteOrigin(n) === 'error' ? 1 : 0; };
  return (a, b) => isErr(b) - isErr(a) || sort(a, b);
}

/** 新卡里哪些算"新鲜"的；不拆分（或按来源拆却没有笔记信息）时返回 null */
function freshTest(q: QueueInput, today: string): ((c: Card) => boolean) | null {
  const mode = q.settings.newSplit ?? 'off';
  if (mode === 'source' && q.notes) {
    const notes = q.notes;
    return (c) => { const n = notes.get(c.noteId); return !!n && noteOrigin(n) !== 'list'; };
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
/** 新卡要等同笔记的另一张卡学会才出：
 *  套用卡等句框卡进入复习；产出卡、辨析卡等认读卡进入复习（先认得，再练写得出 / 再和别的词比） */
function makeGate(q: QueueInput): (c: Card) => boolean {
  const frameState = new Map<string, Card['state']>();
  for (const c of q.cards) if (c.type === 'frame' && !c.deleted) frameState.set(c.noteId, c.state);
  const recState = new Map<string, Card['state']>();
  for (const c of q.cards) if (c.type === 'recognition' && !c.deleted && !c.suspended) recState.set(c.noteId, c.state);
  const gateProd = q.settings.productionAfterRecognition !== false;
  return (c) => (c.type === 'apply' && frameState.get(c.noteId) !== 'review')
    || ((c.type === 'production' || c.type === 'contrast') && gateProd && recState.has(c.noteId) && recState.get(c.noteId) !== 'review');
}

const createdLater = (q: QueueInput, c: Card, today: string) => studyDay(fromIso(c.createdAt), q.settings.dayStartHour) > today;

/** 影响新卡选择的设置；变了就重做今天的计划 */
const planSig = (st: QueueInput['settings']) => JSON.stringify([st.newPerDay, st.newSort ?? null, st.focusTags ?? null, st.newSplit ?? null, st.freshShare ?? null,
  st.freshDays ?? null, st.frameNewPerDay ?? null, st.productionAfterRecognition ?? null, st.dayStartHour]);

function pickNew(q: QueueInput, pool: Card[], today: string, newSeen: Set<string>): Card[] {
  const byId = new Map(q.cards.map((c) => [c.id, c]));
  const gated = makeGate(q);
  const due = pool.filter((c) => c.state === 'new' && !createdLater(q, c, today) && !gated(c));
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
  const sort = errorFirst(q, newCardSort(q));
  const isFresh = freshTest(q, today);
  if (!isFresh) return onePerNote(candidates.sort(sort)).slice(0, newLimit);

  const byId = new Map(q.cards.map((c) => [c.id, c]));
  let seenFresh = 0;
  for (const id of newSeen) { const c = byId.get(id); if (c && isFresh(c)) seenFresh++; }
  const freshQuota = Math.round((newPerDay * (q.settings.freshShare ?? 60)) / 100);
  const otherQuota = newPerDay - freshQuota;
  const fresh = onePerNote(candidates.filter(isFresh).sort(errorFirst(q, newestFirst)));
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
  // 标了 ⚑ 待修的笔记：改好（清掉待修）之前不出，到期的也先压着
  const flagged = (c: Card) => !!q.notes?.get(c.noteId)?.fixme?.trim();
  const pool = q.cards.filter((c) => c.deckId === q.deckId && !c.deleted && !c.suspended && !skipped.has(c.id) && !sibling(c) && !flagged(c));

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

  // 今天要复习的笔记：它的新卡今天出不了，一开始就不排进新卡（见规则 6）
  const busyNotes = new Set([...learningToday, ...reviews].map((c) => c.noteId));
  // 做计划不看"本轮跳过"（跳过只影响这一轮出卡顺序，不该让卡掉出今天的计划）；出卡时再滤掉跳过的
  const newPool = q.cards.filter((c) => c.deckId === q.deckId && c.state === 'new' && !c.deleted && !c.suspended && !sibling(c) && !flagged(c) && !busyNotes.has(c.noteId));
  const budget = Math.max(0, q.settings.newPerDay - newSeen.size);
  const sig = planSig(q.settings);
  const plan = q.newPlan;
  let news: Card[];
  let newPlan: NewPlan;
  if (plan && plan.day === today && plan.deckId === q.deckId && plan.sig === sig) {
    // 只从计划里出：已答、删掉、暂停、标了待修、今天兄弟卡已答的自然掉出去，不另外补
    const avail = new Map(newPool.map((c) => [c.id, c]));
    const kept = plan.ids.map((id) => avail.get(id)).filter((c): c is Card => !!c);
    // 计划之后新加 / 导入的笔记：补进今天没用完的额度
    const known = new Set(plan.knownNotes);
    const added = budget > kept.length ? pickNew(q, newPool.filter((c) => !known.has(c.noteId)), today, newSeen).slice(0, budget - kept.length) : [];
    news = [...kept, ...added].slice(0, budget).filter((c) => !skipped.has(c.id));
    newPlan = added.length
      ? { ...plan, ids: [...plan.ids, ...added.map((c) => c.id)], knownNotes: [...plan.knownNotes, ...new Set(added.map((c) => c.noteId))] }
      : plan;
  } else {
    const picked = pickNew(q, newPool, today, newSeen);
    news = picked.filter((c) => !skipped.has(c.id));
    const knownNotes = [...new Set(q.cards.filter((c) => c.deckId === q.deckId && !c.deleted && c.state === 'new').map((c) => c.noteId))];
    newPlan = { day: today, deckId: q.deckId, sig, ids: picked.map((c) => c.id), knownNotes, madeAt: q.now };
  }
  const newInfo = explainNew(q, today, news, newSeen.size, { notesToday, busyNotes, skipped, flagged });

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
    newPlan,
    newInfo,
  };
}

/** 牌组里有新卡、今天却不出的笔记，各是什么原因（一条笔记只算一个原因，按下面的先后） */
function explainNew(q: QueueInput, today: string, news: Card[], done: number,
  ctx: { notesToday: Set<string>; busyNotes: Set<string>; skipped: Set<string>; flagged: (c: Card) => boolean }): NewInfo {
  const gated = makeGate(q);
  const byNote = new Map<string, Card[]>();
  for (const c of q.cards) {
    if (c.deckId !== q.deckId || c.deleted || c.state !== 'new') continue;
    const l = byNote.get(c.noteId);
    if (l) l.push(c); else byNote.set(c.noteId, [c]);
  }
  const shown = new Set(news.map((c) => c.noteId));
  const waiting: Record<NewWait, number> = { suspended: 0, fixme: 0, studied: 0, busy: 0, skipped: 0, gated: 0, later: 0, limit: 0 };
  for (const [noteId, cs] of byNote) {
    if (shown.has(noteId)) continue;
    const live = cs.filter((c) => !c.suspended);
    const why: NewWait = !live.length ? 'suspended'
      : ctx.flagged(live[0]) ? 'fixme'
      : ctx.notesToday.has(noteId) ? 'studied'
      : ctx.busyNotes.has(noteId) ? 'busy'
      : live.every((c) => ctx.skipped.has(c.id)) ? 'skipped'
      : live.every((c) => gated(c)) ? 'gated'
      : live.every((c) => createdLater(q, c, today) || gated(c)) ? 'later'
      : 'limit';
    waiting[why]++;
  }
  return { limit: q.settings.newPerDay, done, left: news.length, notesWithNew: byNote.size, waiting };
}

/** 给人看的说明：今天新卡为什么是这个数 */
export function newInfoText(i: NewInfo): string[] {
  const out = [`今天新卡：已学 ${i.done}，还剩 ${i.left}，上限 ${i.limit}`];
  const w = i.waiting;
  const rest = Object.values(w).reduce((a, b) => a + b, 0);
  if (!rest) return out;
  out.push(`牌组里有新卡的笔记 ${i.notesWithNew} 条（词库「新卡」的条数），同一条笔记一天只出一张；今天不出的 ${rest} 条：`);
  const label: Record<NewWait, string> = {
    busy: '今天要复习它的另一张卡（明天再出新的那张）',
    studied: '今天已经学过它的另一张卡',
    gated: '产出 / 辨析 / 套用卡，等认读卡或句框卡先学会',
    limit: '今天的额度用完了，排在后面',
    fixme: '标了 ⚑ 待修',
    suspended: '已暂停',
    skipped: '本轮跳过了',
    later: '今天之后才添加的',
  };
  for (const k of Object.keys(label) as NewWait[]) if (w[k]) out.push(`· ${label[k]}：${w[k]}`);
  return out;
}
