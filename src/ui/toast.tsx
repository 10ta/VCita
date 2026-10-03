import { useSyncExternalStore } from 'react';

let current: { text: string; key: number; error?: boolean } | null = null;
let timer: number | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, error = false) {
  current = { text, key: Date.now() + Math.random(), error };
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { current = null; emit(); }, error ? 4000 : 2400);
  emit();
}

export function Toaster() {
  const t = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);
  return t ? <div key={t.key} className={`toast${t.error ? ' is-error' : ''}`} role="status">{t.text}</div> : null;
}
