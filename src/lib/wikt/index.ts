// Wiktionnaire 离线数据（见 scripts/build-fr-wikt.mjs）：近音词、同音词、同义词、词族，和词源原文。
// 两个文件都是第一次用到时才下载（带哈希的文件名，浏览器长期缓存）：
//   fr-links.txt：词库的「可能易混」「表达群」筛选、笔记表单的词族候选
//   fr-etym.txt：只有笔记表单展开「背面补充」时
// 只读：给已有的字段（易混组、表达群、词族线索、词源）提供候选，不写任何新字段。
import { useEffect, useState } from 'react';
import linksUrl from './fr-links.txt?url';
import etymUrl from './fr-etym.txt?url';
import { headWord } from '../headword';

export interface WiktLinks { paronyms: string[]; homophones: string[]; synonyms: string[]; family: string[] }
export type WiktIndex = Map<string, WiktLinks>;
export type WiktEtym = Map<string, string>;

const list = (s: string | undefined) => (s ? s.split(',').filter(Boolean) : []);

export function parseLinks(text: string): WiktIndex {
  const m: WiktIndex = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [w, p, h, s, f] = line.split('\t');
    if (w) m.set(w, { paronyms: list(p), homophones: list(h), synonyms: list(s), family: list(f) });
  }
  return m;
}
export function parseEtym(text: string): WiktEtym {
  const m: WiktEtym = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('\t');
    if (i > 0) m.set(line.slice(0, i), line.slice(i + 1));
  }
  return m;
}

/** 一个词条的近音 / 同音 / 同义 / 词族；多词表达取第一个实词。索引没加载或查不到返回 null */
export const linksOf = (idx: WiktIndex | null | undefined, lemma: string): WiktLinks | null => idx?.get(headWord(lemma)) ?? null;
/** 一个词条的词源原文（法语）；多词表达取第一个实词 */
export const etymOf = (etym: WiktEtym | null | undefined, lemma: string): string | null => etym?.get(headWord(lemma)) ?? null;

function lazy<T>(url: string, parse: (t: string) => T, what: string) {
  let loading: Promise<T> | null = null;
  let loaded: T | null = null;
  const load = () => (loading ??= fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${what}下载失败：${r.status}`);
    return r.text();
  }).then((t) => (loaded = parse(t))).catch((e) => { loading = null; throw e; }));
  /** 加载完之前是 null；enabled = false 时不下载 */
  const use = (enabled = true): T | null => {
    const [v, setV] = useState<T | null>(loaded);
    useEffect(() => {
      if (!enabled || v) return;
      let alive = true;
      load().then((x) => alive && setV(x)).catch((e) => console.warn(e));
      return () => { alive = false; };
    }, [enabled, v]);
    return v;
  };
  return { load, use };
}

const links = lazy(linksUrl, parseLinks, 'Wiktionnaire 索引');
const etym = lazy(etymUrl, parseEtym, 'Wiktionnaire 词源');
export const loadWiktLinks = links.load;
export const useWiktLinks = links.use;
export const loadWiktEtym = etym.load;
export const useWiktEtym = etym.use;
