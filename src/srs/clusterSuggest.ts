// 表达群建议（纯函数）：库里两条笔记在 Wiktionnaire 里互为同义词、又不在同一个群里 → 「可以并成一群」。
// 只是建议：词库的「表达群」筛选里列出来，点一下才加入。
import type { Note } from '../schema';
import { headWord } from '../lib/headword';
import type { WiktIndex } from '../lib/wikt';

export interface ClusterSuggestion {
  /** 两条笔记的 id */
  a: string; b: string;
  /** 要并进的群名：有一边已经在群里就用它的；都不在就新起一个（说「意思」） */
  cluster: string;
  /** 群是不是新起的 */
  fresh: boolean;
  /** 点了以后要改 cluster 的笔记 */
  join: string[];
}

type N = Pick<Note, 'id' | 'lemma' | 'meaningZh' | 'cluster' | 'deleted'>;
const firstZh = (s: string) => s.replace(/[（(][^）)]*[）)]/g, '').split(/[；;，,、/。|]+/).map((x) => x.trim()).find(Boolean) ?? '';

export function suggestClusters(notes: readonly N[], wikt?: WiktIndex | null): ClusterSuggestion[] {
  if (!wikt?.size) return [];
  const live = notes.filter((n) => !n.deleted && n.lemma.trim());
  const byHead = new Map<string, N[]>();
  for (const n of live) { const h = headWord(n.lemma); if (h) (byHead.get(h) ?? byHead.set(h, []).get(h)!).push(n); }
  const out: ClusterSuggestion[] = [];
  const seen = new Set<string>();
  for (const [h, xs] of byHead) for (const w of wikt.get(h)?.synonyms ?? []) {
    if (w === h) continue;
    for (const x of xs) for (const y of byHead.get(w) ?? []) {
      const k = x.id < y.id ? `${x.id}|${y.id}` : `${y.id}|${x.id}`;
      if (x.id === y.id || seen.has(k)) continue;
      seen.add(k);
      const cx = x.cluster?.trim() || '', cy = y.cluster?.trim() || '';
      // 已经在同一个群里；或者各有各的群（是你自己分过的，不建议合并）
      if (cx && cy) continue;
      if (cx || cy) out.push({ a: x.id, b: y.id, cluster: cx || cy, fresh: false, join: [cx ? y.id : x.id] });
      else {
        const zh = firstZh(x.meaningZh) || firstZh(y.meaningZh) || x.lemma.trim();
        out.push({ a: x.id, b: y.id, cluster: `说「${zh}」`, fresh: true, join: [x.id, y.id] });
      }
    }
  }
  return out;
}
