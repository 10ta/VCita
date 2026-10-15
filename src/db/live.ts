// 共享的实时查询：同一个查询不管多少组件在用，只订阅一次、只读一次数据库。
// 最后一个使用者离开后再保留一会儿，切换页面时直接拿到上次的结果，不用重新读。
import { useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';

const KEEP_ALIVE_MS = 60_000;

export interface LiveStore<T> {
  subscribe(l: () => void): () => void;
  get(): T | undefined;
}

export function liveStore<T>(querier: () => Promise<T>): LiveStore<T> {
  let value: T | undefined;
  const listeners = new Set<() => void>();
  let sub: { unsubscribe(): void } | null = null;
  let idle: number | undefined;
  return {
    subscribe(l) {
      listeners.add(l);
      window.clearTimeout(idle);
      sub ??= liveQuery(querier).subscribe({
        next: (v) => { value = v; listeners.forEach((x) => x()); },
        error: (e) => console.error(e),
      });
      return () => {
        listeners.delete(l);
        if (listeners.size) return;
        idle = window.setTimeout(() => {
          if (listeners.size || !sub) return;
          sub.unsubscribe();
          sub = null;
          value = undefined; // 不再订阅后值会过期，下次重新读
        }, KEEP_ALIVE_MS);
      };
    },
    get: () => value,
  };
}

export const useLiveStore = <T,>(s: LiveStore<T>) => useSyncExternalStore(s.subscribe, s.get);
