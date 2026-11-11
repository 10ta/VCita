// 法语词典（Lexique 3.83 + Lefff 3.4，见 scripts/build-fr-dict.mjs）：词频、词性、名词 / 形容词的阴阳性。
// 文件约 2.6 MB（压缩后约 0.5 MB），第一次用到时才下载，带哈希的文件名，浏览器长期缓存。
import { useEffect, useState } from 'react';
import dictUrl from './fr-dict.txt?url';
import verbsUrl from './fr-verbs.txt?url';
import { FALLBACK_STATS, RULE_STATS } from './stats.gen';
import { HOMOGRAPHS, SPECIAL, matchRule, norm, type GenderRule } from './rules';

export type Pos = 'N' | 'A' | 'V' | 'O';
/** m / f；b = 阴阳同形（le / la ministre）；h = 同形异义（le / la tour）；? = 词典里没有性别 */
export type DictGender = 'm' | 'f' | 'b' | 'h' | '?' | '';
export interface Entry {
  form: string; pos: Pos; g: DictGender; n: 's' | 'p' | ''; lemma: string; freq: number;
  /** 这个形式也是动词变位（approche、marche、demande）：只在 nounOf 里查得到，原形、词频照旧按动词算 */
  verbForm?: boolean;
}
export interface FrDict {
  get(word: string): Entry | undefined;
  /** 阴阳性显示用：get 查不到时，再查"也是动词变位"的名词 / 形容词（Mon approche、la marche） */
  nounOf(word: string): Entry | undefined;
  formsOf(lemma: string): Entry[];
  /** 词频排第 n 的原形的词频（每百万词）；n 超出时返回 0。阅读页用它判断"常用词前 N 个" */
  freqAtRank(n: number): number;
}

export function parseDict(text: string): FrDict {
  const map = new Map<string, Entry>();
  const byLemma = new Map<string, Entry[]>();
  const lemmaFreq = new Map<string, number>();
  const verbForms = new Map<string, Entry>();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [form, pos, g, n, lemma, freq, flag] = line.split('\t');
    const e: Entry = { form, pos: pos as Pos, g: g as DictGender, n: n as Entry['n'], lemma: lemma || form, freq: Number(freq) || 0 };
    // 也是动词变位的名词 / 形容词：单独存，不影响原形、词频、划词（那些照旧按动词）
    if (flag === 'v') { e.verbForm = true; verbForms.set(form, e); (byLemma.get(e.lemma) ?? byLemma.set(e.lemma, []).get(e.lemma)!).push(e); continue; }
    map.set(form, e);
    if (e.freq > (lemmaFreq.get(e.lemma) ?? 0)) lemmaFreq.set(e.lemma, e.freq);
    if (e.pos === 'N' || e.pos === 'A') (byLemma.get(e.lemma) ?? byLemma.set(e.lemma, []).get(e.lemma)!).push(e);
  }
  let ranked: number[] | null = null;
  return {
    get: (w) => map.get(norm(w)),
    nounOf: (w) => map.get(norm(w)) ?? verbForms.get(norm(w)),
    formsOf: (l) => byLemma.get(norm(l)) ?? [],
    freqAtRank: (n) => {
      ranked ??= [...lemmaFreq.values()].sort((a, b) => b - a);
      return n <= 0 ? Infinity : ranked[Math.min(n, ranked.length) - 1] ?? 0;
    },
  };
}

// ---------------- 动词变位（阅读页、划词用） ----------------

/** 变位形式 → 不定式。文件约 2.1 MB（压缩后约 0.45 MB），第一次用到时才下载 */
export type FrVerbs = Map<string, string>;
export function parseVerbs(text: string): FrVerbs {
  const m: FrVerbs = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [lemma, forms] = line.split('\t');
    for (const f of forms?.split(' ') ?? []) if (f) m.set(f, lemma);
  }
  return m;
}
let verbsLoading: Promise<FrVerbs> | null = null;
let verbsLoaded: FrVerbs | null = null;
export function loadVerbs(): Promise<FrVerbs> {
  verbsLoading ??= fetch(verbsUrl).then((r) => {
    if (!r.ok) throw new Error(`动词表下载失败：${r.status}`);
    return r.text();
  }).then((t) => (verbsLoaded = parseVerbs(t))).catch((e) => { verbsLoading = null; throw e; });
  return verbsLoading;
}
export function useFrVerbs(enabled = true): FrVerbs | null {
  const [v, setV] = useState<FrVerbs | null>(verbsLoaded);
  useEffect(() => {
    if (!enabled || v) return;
    let alive = true;
    loadVerbs().then((x) => alive && setV(x)).catch((e) => console.warn(e));
    return () => { alive = false; };
  }, [enabled, v]);
  return v;
}

/** 一个词形可能的全部原形（名词 / 形容词的原形、变位动词的不定式）：grouillante → grouillant + grouiller */
export function lemmaCandidates(dict: FrDict, verbs: FrVerbs | null, form: string): string[] {
  const w = norm(form);
  const out = [dict.get(w)?.lemma, verbs?.get(w)].filter((x): x is string => !!x);
  // 形容词的原形本身是现在分词时再走一步：grouillante → grouillant → grouiller
  for (const l of [...out]) { const v = verbs?.get(l); if (v) out.push(v); }
  return [...new Set(out)];
}

/** 记遇见、标认识用的键：候选原形里最常用的那个（grouillante、grouillait 都记到 grouiller 名下） */
export function canonicalLemma(dict: FrDict, verbs: FrVerbs | null, form: string): string {
  const cs = lemmaCandidates(dict, verbs, form);
  let best = cs[0] ?? norm(form), bf = -1;
  for (const c of cs) { const f = dict.get(c)?.freq ?? 0; if (f > bf) { best = c; bf = f; } }
  return best;
}

/** 一个词形的原形和词频：名词 / 形容词查词典，变位动词查变位表；两边都有时（est：东方 / être）取常用的 */
export function lemmaOf(dict: FrDict, verbs: FrVerbs | null, form: string): { lemma: string; freq: number } | null {
  const w = norm(form);
  const e = dict.get(w);
  const vl = verbs?.get(w);
  const ve = vl ? dict.get(vl) : undefined;
  const a = e ? { lemma: e.lemma, freq: e.freq } : null;
  const b = vl ? { lemma: vl, freq: ve?.freq ?? 0 } : null;
  if (a && b) return b.freq > a.freq ? b : a;
  return a ?? b;
}

let loading: Promise<FrDict> | null = null;
let loaded: FrDict | null = null;
export function loadDict(): Promise<FrDict> {
  loading ??= fetch(dictUrl).then((r) => {
    if (!r.ok) throw new Error(`词典下载失败：${r.status}`);
    return r.text();
  }).then((t) => (loaded = parseDict(t))).catch((e) => { loading = null; throw e; });
  return loading;
}
/** 词典（加载完之前是 null）；enabled = false 时不下载 */
export function useFrDict(enabled = true): FrDict | null {
  const [d, setD] = useState<FrDict | null>(loaded);
  useEffect(() => {
    if (!enabled || d) return;
    let alive = true;
    loadDict().then((x) => alive && setD(x)).catch((e) => console.warn(e));
    return () => { alive = false; };
  }, [enabled, d]);
  return d;
}

// ---------------- 词频 ----------------

// 词条里不算"词"的部分：qqch / qqn、括号里的语法说明、+ 号
const NOT_WORDS = /\([^)]*\)|\bqq(?:ch|n)\b|\bqn\b|\bqc\b|\+|…|\.\.\./gi;
const FUNC = new Set('le la les l un une des de du d à au aux en et ou se s ne pas y que qu qui ce sa son ses leur leurs mon ma mes ton ta tes nous vous il elle on je j me m te t lui pour par sur dans avec sans être avoir faire'.split(' '));

/** 一个词条的词频（每百万词）：短语取最不常见的那个实词——短语的常用度取决于它最生僻的部分。查不到返回 null */
export function lemmaFreq(dict: FrDict, lemma: string): number | null {
  const words = norm(lemma).replace(NOT_WORDS, ' ').split(/[^\p{L}'-]+/u).flatMap((w) => w.split(/'/)).filter((w) => w.length > 1);
  const content = words.filter((w) => !FUNC.has(w));
  const pool = content.length ? content : words;
  let min: number | null = null;
  for (const w of pool) {
    const e = dict.get(w);
    if (!e) continue;
    // 变形的词（écopé）查到的是原形的词频
    const f = e.freq;
    min = min === null ? f : Math.min(min, f);
  }
  return min;
}

// ---------------- 阴阳性 ----------------

const MASC_DET = new Set(['le', 'un', 'du', 'au', 'ce', 'cet', 'mon', 'ton', 'son', 'quel', 'aucun', 'nul', 'tout', 'certain']);
const FEM_DET = new Set(['la', 'une', 'cette', 'ma', 'ta', 'sa', 'quelle', 'aucune', 'nulle', 'toute', 'certaine']);
/** 前一个词是限定词时，它说明了这个名词在这里的性 */
export const genderFromDet = (prev: string | null | undefined): 'm' | 'f' | null => {
  const p = prev ? norm(prev) : '';
  return MASC_DET.has(p) ? 'm' : FEM_DET.has(p) ? 'f' : null;
};

export interface RuleView extends GenderRule { pct: number; n: number; exceptions: string[]; /** 这个词是不是这条规则的例外 */ isException: boolean }
export interface GenderInfo {
  word: string;
  pos: 'N' | 'A';
  /** 这个词的性；b = 阴阳同形；h = 同形异义；? = 不知道 */
  gender: DictGender;
  /** 从前面的冠词看出来的性（同形词、阴阳同形词有用） */
  ctxGender: 'm' | 'f' | null;
  number: 's' | 'p' | '';
  lemma: string;
  /** 另一个性的形式：acteur ↔ actrice、beau ↔ belle */
  other: string[];
  /** 名词按词尾的规则（有另一个性形式的指人名词不给，它的性跟着所指的人） */
  rule: RuleView | null;
  /** 没有匹配的词尾规则时的大致倾向 */
  fallback: { endsWithE: boolean; femPct: number } | null;
  homograph: { m: string; f: string } | null;
  special: string | null;
}

export function genderInfo(dict: FrDict, word: string, prev?: string | null): GenderInfo | null {
  const e = dict.nounOf(word);
  if (!e || (e.pos !== 'N' && e.pos !== 'A')) return null;
  const lemma = e.lemma;
  const want = e.g === 'm' ? 'f' : e.g === 'f' ? 'm' : null;
  const other = want
    ? [...new Set(dict.formsOf(lemma).filter((x) => x.pos === e.pos && x.g === want && (x.n === e.n || !x.n || !e.n)).map((x) => x.form))]
    : [];
  // 原形是阳性形式，查阴性词的"另一个性"时原形本身也算（actrice → acteur）
  if (want === 'm' && lemma !== e.form && !other.includes(lemma) && dict.nounOf(lemma)?.pos === e.pos) other.unshift(lemma);
  const homo = HOMOGRAPHS.find((h) => h.word === norm(e.form) || h.word === norm(lemma)) ?? null;
  let rule: RuleView | null = null;
  let fallback: GenderInfo['fallback'] = null;
  if (e.pos === 'N' && !other.length && (e.g === 'm' || e.g === 'f' || e.g === '?')) {
    // 词尾规则按单数原形看（chevaux → cheval）
    const base = e.n === 'p' ? lemma : e.form;
    const r = matchRule(base);
    if (r) {
      const st = RULE_STATS[r.suffix] ?? { n: 0, pct: 0, exceptions: [] };
      rule = { ...r, ...st, isException: (e.g === 'm' || e.g === 'f') && e.g !== r.gender };
    } else {
      const endsWithE = norm(base).endsWith('e');
      fallback = { endsWithE, femPct: endsWithE ? FALLBACK_STATS.e.fem : FALLBACK_STATS.other.fem };
    }
  }
  return {
    word, pos: e.pos, gender: e.g, ctxGender: e.pos === 'N' ? genderFromDet(prev) : null, number: e.n, lemma, other,
    rule, fallback, homograph: homo ? { m: homo.m, f: homo.f } : null, special: SPECIAL[norm(e.form)] ?? SPECIAL[norm(lemma)] ?? null,
  };
}
