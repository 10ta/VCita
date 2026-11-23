// 今天的新卡计划（见 srs/queue.ts 规则 6）：只存在这台设备上，按牌组各一份，只留今天的。
// 多台设备各有各的计划；每日上限按同步来的作答日志算，加起来不会超过上限。
import { useSyncExternalStore } from 'react';
import type { NewPlan } from '../srs/queue';

const KEY = 'vf_newplan';
type Plans = Record<string, NewPlan>;

const read = (): Plans => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Plans; } catch { return {}; }
};
let cache: Plans = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function saveNewPlan(p: NewPlan) {
  if (cache[p.deckId] === p) return;
  // 只留今天的：别的牌组的旧计划顺手清掉
  const next: Plans = { [p.deckId]: p };
  for (const [k, v] of Object.entries(cache)) if (k !== p.deckId && v.day === p.day) next[k] = v;
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* 隐私模式：只在内存里 */ }
  emit();
}

// 同一台设备开了两个窗口：另一个窗口做的计划这边也用
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === KEY) { cache = read(); emit(); } });
}

export const useNewPlans = () =>
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => cache);
