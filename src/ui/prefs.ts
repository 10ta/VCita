// 只属于这台设备的界面偏好（不同步）：当前牌组、题面、自动发音、词库显示哪些字段
import { useSyncExternalStore } from 'react';

export interface Prefs {
  deckId: string | null;
  /** 题面：0 法语 / 1 翻译1 / 2 翻译2（再叠加每张卡自己的旋转） */
  quizType: 0 | 1 | 2;
  autoPlay: boolean;
  showT1: boolean;
  showT2: boolean;
  pageSize: number;
}
const KEY = 'vf_prefs';
const DEFAULTS: Prefs = { deckId: null, quizType: 0, autoPlay: false, showT1: true, showT2: false, pageSize: 30 };

let cache: Prefs = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULTS; }
})();
const listeners = new Set<() => void>();

export function setPrefs(patch: Partial<Prefs>) {
  cache = { ...cache, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* 隐私模式 */ }
  listeners.forEach((l) => l());
}
export const usePrefs = () =>
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => cache);
