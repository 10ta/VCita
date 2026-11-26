// 预加载用：接下来可能出的卡
import { buildQueue, type NewPlan } from './queue';
import { fromIso } from '../lib/time';
import type { Card, Note, ReviewLog, Settings } from '../schema';

/** 接下来可能出的卡（给预加载用，顺序 = 可能性）：
 *  - 自定义学习：队列里接下来的三张
 *  - 平时：假设这张（连同它的兄弟卡）已答，重排队列的下一张、再下一张；
 *    再加上 15 分钟内到期的学习 / 重学卡——答错的卡几分钟后会突然插到前面，按"现在"排的队列预测不到它们 */
export function upcomingCards(a: {
  card: Card; cards: Card[]; logs: ReviewLog[]; deckId: string; settings: Settings; skipped: Set<string>; learnAheadAll: boolean;
  notes: Map<string, Note>; freq?: ReadonlyMap<string, number | null> | null; newPlan?: NewPlan; customQueue: string[] | null; now?: number;
}): Card[] {
  const byId = new Map(a.cards.map((c) => [c.id, c]));
  if (a.customQueue) return a.customQueue.filter((id) => id !== a.card.id).map((id) => byId.get(id)).filter((c): c is Card => !!c && !c.suspended).slice(0, 3);
  const now = a.now ?? Date.now();
  const out: Card[] = [];
  const seen = new Set<string>([a.card.id]);
  const skip = new Set([...a.skipped, ...a.cards.filter((c) => c.noteId === a.card.noteId).map((c) => c.id)]);
  for (let k = 0; k < 2; k++) {
    const nc = buildQueue({ cards: a.cards, todayLogs: a.logs, deckId: a.deckId, now, settings: a.settings, skipped: skip, learnAheadAll: a.learnAheadAll, notes: a.notes, freq: a.freq ?? undefined, newPlan: a.newPlan }).next;
    if (!nc) break;
    if (!seen.has(nc.id)) { out.push(nc); seen.add(nc.id); }
    for (const c of a.cards) if (c.noteId === nc.noteId) skip.add(c.id);
  }
  const soon = a.cards
    .filter((c) => c.deckId === a.deckId && !c.deleted && !c.suspended && (c.state === 'learning' || c.state === 'relearning')
      && !seen.has(c.id) && c.noteId !== a.card.noteId && fromIso(c.due) <= now + 15 * 60_000)
    .sort((x, y) => fromIso(x.due) - fromIso(y.due))
    .slice(0, 8);
  return [...out, ...soon];
}
