// 只属于这台设备的界面偏好（不同步）：当前牌组、题面、自动发音、词库显示哪些字段
import { useSyncExternalStore } from 'react';

export interface Prefs {
  deckId: string | null;
  /** 题面：0 法语 / 1 翻译1 / 2 翻译2（再叠加每张卡自己的旋转） */
  quizType: 0 | 1 | 2;
  /** 添加页：添加后读一遍法语 */
  autoPlay: boolean;
  /** 复习页自动读法语：题面是法语就出题时读，题面是中文 / 挖空就翻面后读答案。中文、英文永远不自动读 */
  autoRead: boolean;
  /** 听力卡：认读卡正面只放声音、不显示文字（核心词 / 全部 / 关）。听力卡出题时总是会读，和自动读无关 */
  listenCards: 'off' | 'core' | 'all';
  showT1: boolean;
  showT2: boolean;
  pageSize: number;
  /** 添加页：新笔记的来源类型（挖矿 / 词表），记住上次的选择 */
  addOrigin: 'mined' | 'list';
  /** 阅读页：按认识 / 学习中 / 生词给词标色 */
  readColors: boolean;
}
const KEY = 'vf_prefs';
const DEFAULTS: Prefs = { deckId: null, quizType: 0, autoPlay: false, autoRead: true, listenCards: 'core', showT1: true, showT2: false, pageSize: 30, addOrigin: 'mined', readColors: true };

let cache: Prefs = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    // 旧版是两个开关（自动发音 + 听：核心词/全部/关），合并成 audio
    if (!raw.audio && raw.listenMode) raw.audio = raw.listenMode === 'off' ? (raw.autoPlay ? 'read' : 'off') : raw.listenMode;
    delete raw.listenMode;
    // 再旧一版是一个四档开关 audio（关 / 自动读 / 听·核心词 / 听·全部），拆成两个
    if (raw.audio && raw.autoRead === undefined) {
      raw.autoRead = raw.audio !== 'off';
      raw.listenCards = raw.audio === 'core' || raw.audio === 'all' ? raw.audio : 'off';
    }
    delete raw.audio;
    return { ...DEFAULTS, ...raw };
  } catch { return DEFAULTS; }
})();
const listeners = new Set<() => void>();

export function setPrefs(patch: Partial<Prefs>) {
  cache = { ...cache, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* 隐私模式 */ }
  listeners.forEach((l) => l());
}
export const usePrefs = () =>
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => cache);
