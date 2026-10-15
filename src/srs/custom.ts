// 自定义学习（Anki 的筛选牌组）：从词库的筛选结果临时开一轮。
//  - 本来就到期的卡：照常调度、记日志（等于提前做了正常复习）
//  - 没到期的卡和新卡：只练习，不改调度、不记日志
//  - 忘了 → 隔 3 张再出；困难 → 放到本轮最后；良好 / 容易 → 本轮完成
// 状态存在 sessionStorage：刷新页面不丢，关掉标签页就结束。
import { useSyncExternalStore } from 'react';

export interface CustomSession {
  label: string;
  /** 待练的卡，按出现顺序 */
  queue: string[];
  total: number;
  done: number;
}

const KEY = 'vf_custom';
let cur: CustomSession | null = (() => {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
})();
const listeners = new Set<() => void>();

function set(next: CustomSession | null) {
  cur = next;
  try {
    if (next) sessionStorage.setItem(KEY, JSON.stringify(next));
    else sessionStorage.removeItem(KEY);
  } catch { /* 隐私模式 */ }
  listeners.forEach((l) => l());
}

export const useCustom = () =>
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => cur);
export const getCustom = () => cur;

export function startCustom(label: string, cardIds: string[]) {
  set({ label, queue: [...cardIds], total: cardIds.length, done: 0 });
}
export const endCustom = () => set(null);
/** 撤销用：恢复到作答前的状态 */
export const restoreCustom = (s: CustomSession) => set(s);

export const RELEARN_GAP = 3;
/** 同一条笔记的卡至少隔几张再出（产出卡刚揭示过答案，紧跟着的挖空卡就没意义了） */
export const SIBLING_GAP = 3;

/** 纯函数：选下一张。跳过最近 SIBLING_GAP 次作答里出现过的笔记；实在没有别的卡时才出兄弟卡 */
export function pickCustom<C extends { id: string; noteId: string; suspended: boolean }>(
  queue: string[], cardById: Map<string, C>, recentNotes: string[],
): string | null {
  const recent = new Set(recentNotes.slice(-SIBLING_GAP));
  let fallback: string | null = null;
  for (const id of queue) {
    const c = cardById.get(id);
    if (!c || c.suspended) continue;
    if (!recent.has(c.noteId)) return id;
    fallback ??= id;
  }
  return fallback;
}

/** 纯函数：作答后的队列 */
export function nextQueue(s: CustomSession, cardId: string, rating: 1 | 2 | 3 | 4): CustomSession {
  const rest = s.queue.filter((id) => id !== cardId);
  if (rating === 1) rest.splice(Math.min(RELEARN_GAP, rest.length), 0, cardId);
  else if (rating === 2) rest.push(cardId);
  return { ...s, queue: rest, done: rating >= 3 ? s.done + 1 : s.done };
}
export function answerCustom(cardId: string, rating: 1 | 2 | 3 | 4) {
  if (cur) set(nextQueue(cur, cardId, rating));
}
/** 卡被删除 / 暂停时从队列里拿掉 */
export function dropCustom(cardId: string) {
  if (cur && cur.queue.includes(cardId)) set({ ...cur, queue: cur.queue.filter((id) => id !== cardId), total: cur.total - 1 });
}
