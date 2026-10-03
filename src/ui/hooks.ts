import { useEffect, useRef, useState } from 'react';

/** 每 intervalMs 刷新一次的当前时间 */
export function useNow(intervalMs: number): [number, () => void] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return [now, () => setNow(Date.now())];
}

/**
 * 页面级快捷键。监听在 window 捕获阶段、处理后阻止继续传播：
 * 先于"空格 = 播放/暂停"之类的浏览器扩展拿到按键。输入框、弹窗打开时不生效。
 */
export function useHotkeys(handler: (key: string, e: KeyboardEvent) => boolean | void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const handled = new Set<string>();
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector('dialog[open]')) return;
      if (ref.current(e.key, e) === false) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      handled.add(e.key);
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    };
    const up = (e: KeyboardEvent) => {
      if (handled.delete(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); };
  }, []);
}
