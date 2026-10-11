// 疑似重复：同一牌组里，单词（按 , ; / 拆开的每一项）、考查部分或整句相同，或者例句高度相似的笔记归为一组。
import type { Note } from '../schema';
import { clozeTarget } from '../schema/validate';

/** 小写、去标点、去开头的冠词和"ê / être"，便于比较（se / s' 保留：se poursuivre ≠ poursuivre） */
export function normKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\{\{|\}\}/g, '')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/^(?:(?:le|la|les|un|une|des|du|ê|être) +|l')+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (s: string) => new Set(normKey(s).split(' ').filter((w) => w.length > 1));

function jaccard(a: Set<string>, b: Set<string>) {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 返回 noteId → 组号（只包含有重复的笔记）。组号从 1 开始，按组里最早的笔记排序 */
export function findDuplicates(notes: Note[], sentenceSimilarity = 0.75): Map<string, number> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const n of notes) parent.set(n.id, n.id);

  // 1. 完全相同的键
  const byKey = new Map<string, string>();
  for (const n of notes) {
    const keys = new Set<string>();
    for (const part of n.lemma.split(/[,;/，；]/)) keys.add(normKey(part));
    if (n.sentence) {
      keys.add(normKey(clozeTarget(n.sentence)));
      keys.add('s:' + normKey(n.sentence));
    }
    for (const k of keys) {
      if (k.replace(/^s:/, '').length < 3) continue;
      const key = `${n.deckId}|${k}`;
      const other = byKey.get(key);
      if (other) union(n.id, other);
      else byKey.set(key, n.id);
    }
  }
  // 2. 例句相似
  const withSent = notes.filter((n) => n.sentence).map((n) => ({ n, w: words(n.sentence) })).filter((x) => x.w.size >= 4);
  for (let i = 0; i < withSent.length; i++)
    for (let j = i + 1; j < withSent.length; j++) {
      const a = withSent[i], b = withSent[j];
      if (a.n.deckId === b.n.deckId && jaccard(a.w, b.w) >= sentenceSimilarity) union(a.n.id, b.n.id);
    }

  const groups = new Map<string, Note[]>();
  for (const n of notes) groups.set(find(n.id), [...(groups.get(find(n.id)) ?? []), n]);
  const out = new Map<string, number>();
  [...groups.values()]
    .filter((g) => g.length > 1)
    .sort((a, b) => (minCreated(a) < minCreated(b) ? -1 : 1))
    .forEach((g, i) => g.forEach((n) => out.set(n.id, i + 1)));
  return out;
}
const minCreated = (g: Note[]) => g.reduce((m, n) => (n.createdAt < m ? n.createdAt : m), g[0].createdAt);
