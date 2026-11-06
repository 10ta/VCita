// 阅读页：把文章切成词，每个词还原成原形，按"认识 / 学习中 / 有卡未学 / 生词"标色，算已知覆盖率。
// 认识 = 手动标过 + 自己的卡已经稳定（间隔 ≥ 21 天）+ 词频前 N 个原形（设置里改）。
import { useMemo } from 'react';
import { useCards, useKnown, useNotes, useSettings } from '../db/hooks';
import { canonicalLemma, lemmaCandidates, lemmaOf, useFrDict, useFrVerbs, type FrDict, type FrVerbs } from './gender/dict';
import { norm } from './gender/rules';
import type { Card, Note, Text } from '../schema';

export type WordStatus = 'known' | 'learning' | 'new' | 'unknown';
export interface Tok { text: string; key?: string; status?: WordStatus }

/** 间隔达到这么多天算"已稳定"，阅读时当作认识 */
export const STABLE_DAYS = 21;
// 词频前 N 设成 0 时，这些虚词仍算认识
const FUNC = new Set('le la les l un une des de du d à au aux en et ou se s ne pas y que qu qui ce cet cette ces sa son ses leur leurs mon ma mes ton ta tes nous vous il ils elle elles on je j me m te t lui eux pour par sur dans avec sans être avoir faire mais donc car si'.split(' '));
/** 虚词（冠词、介词、代词、连词等） */
export const isFunctionWord = (w: string) => FUNC.has(w.toLowerCase());
const NOT_WORDS = /\([^)]*\)|\bqq(?:ch|n)\b|\+|…/gi;
const WORD = /(\p{L}+(?:['’-]\p{L}+)*)/u;
const ELISION = /^((?:[ldjmnstc]|qu|jusqu|lorsqu|puisqu|quoiqu)['’])(\p{L}.*)$/iu;

/** 切词：l'arbre → l' + arbre（词典里有 aujourd'hui、presqu'île 这种就整体保留） */
export function tokenize(text: string, dict: FrDict | null): Array<{ text: string; word: boolean }> {
  const out: Array<{ text: string; word: boolean }> = [];
  text.split(WORD).forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 0) return void out.push({ text: part, word: false });
    const m = ELISION.exec(part);
    if (m && !dict?.get(part)) { out.push({ text: m[1], word: false }, { text: m[2], word: true }); return; }
    out.push({ text: part, word: true });
  });
  return out;
}

const RANK: Record<WordStatus, number> = { unknown: 0, new: 1, learning: 2, known: 3 };
/** 一条笔记的卡里最好的状态：有一张已稳定 → 认识；有在学的 → 学习中；全是新卡 → 有卡未学 */
function noteStatus(cards: Card[]): WordStatus {
  let st: WordStatus = 'new';
  for (const c of cards) {
    if (c.deleted || c.suspended) continue;
    if (c.state === 'review' && c.interval >= STABLE_DAYS) return 'known';
    if (c.state !== 'new') st = 'learning';
  }
  return st;
}

export interface ReadingIndex {
  /** 一个词形的原形（找不到就是小写的词形）和状态；专有名词、数字返回 null */
  of(form: string): { key: string; status: WordStatus } | null;
  /** 原形 → 自己的卡里的状态（没有卡就没有） */
  notes: Map<string, WordStatus>;
}

export function buildIndex(dict: FrDict, verbs: FrVerbs | null, notes: Note[], cards: Card[], known: Set<string>, knownTop: number): ReadingIndex {
  const threshold = knownTop > 0 ? dict.freqAtRank(knownTop) : Infinity;
  const common = (w: string) => { const r = lemmaOf(dict, verbs, w); return !!r && r.freq > 0 && r.freq >= threshold; };
  const byNote = new Map<string, Card[]>();
  for (const c of cards) (byNote.get(c.noteId) ?? byNote.set(c.noteId, []).get(c.noteId)!).push(c);
  const noteMap = new Map<string, WordStatus>();
  const put = (key: string, st: WordStatus) => { if (!noteMap.has(key) || RANK[st] > RANK[noteMap.get(key)!]) noteMap.set(key, st); };
  for (const n of notes) {
    if (n.deleted) continue;
    const st = noteStatus(byNote.get(n.id) ?? []);
    const words = norm(n.lemma).replace(NOT_WORDS, ' ').split(/[^\p{L}'’-]+/u).flatMap((w) => tokenize(w, dict).filter((t) => t.word).map((t) => t.text))
      .filter((w) => w.length > 1 && !FUNC.has(w));
    // 短语笔记只认它里面不常用的词：d'après moi 不能让 après 变成"有卡未学"
    const own = words.length > 1 ? words.filter((w) => !common(w)) : words;
    for (const w of own) {
      const keys = lemmaCandidates(dict, verbs, w);
      for (const k of keys.length ? keys : [w]) put(k, st);
    }
  }
  return {
    notes: noteMap,
    of(form) {
      if (/^\p{Lu}/u.test(form) && !dict.get(form) && !verbs?.get(norm(form))) return null; // 专有名词
      const r = lemmaOf(dict, verbs, form);
      if (!r && norm(form).length < 2) return null;
      const key = r ? canonicalLemma(dict, verbs, form) : norm(form);
      // 一个词形可能属于几个原形（grouillante → grouillant，卡上写的 grouillant 还原成 grouiller）：任何一个对上就算
      const keys = [key, ...lemmaCandidates(dict, verbs, form)];
      if (keys.some((k) => known.has(k))) return { key, status: 'known' };
      let ns: WordStatus | undefined;
      for (const k of keys) { const x = noteMap.get(k); if (x && (!ns || RANK[x] > RANK[ns])) ns = x; }
      if (ns) return { key, status: ns };
      if (FUNC.has(key) || (r && r.freq > 0 && r.freq >= threshold)) return { key, status: 'known' };
      return { key, status: 'unknown' };
    },
  };
}

/** 页面用的索引：词典和变位表加载完之前是 null */
export function useReadingIndex(enabled = true): ReadingIndex | null {
  const dict = useFrDict(enabled);
  const verbs = useFrVerbs(enabled);
  const notes = useNotes();
  const cards = useCards();
  const known = useKnown();
  const s = useSettings();
  return useMemo(
    () => (dict && verbs && notes && cards && known && s ? buildIndex(dict, verbs, notes, cards, known, s.knownTop) : null),
    [dict, verbs, notes, cards, known, s],
  );
}

export interface Coverage { total: number; known: number; learning: number; new: number; unknown: number; uniqueUnknown: number; pct: number }
export function coverage(toks: Tok[]): Coverage {
  const c = { total: 0, known: 0, learning: 0, new: 0, unknown: 0 };
  const unk = new Set<string>();
  for (const t of toks) {
    if (!t.status) continue;
    c.total++;
    c[t.status]++;
    if (t.status === 'unknown') unk.add(t.key!);
  }
  return { ...c, uniqueUnknown: unk.size, pct: c.total ? Math.round((c.known / c.total) * 1000) / 10 : 100 };
}
/** 手册的判断：85–90% 精读，98% 以上泛读，低于 85% 换台阶版本 */
export const coverageAdvice = (pct: number) =>
  pct >= 98 ? '适合泛读：不查词，读下去' : pct >= 90 ? '介于精读和泛读之间' : pct >= 85 ? '适合精读：查影响理解的词，摘 5–10 句' : '偏难：建议换台阶版本，或先泛读一遍';

export function annotate(text: string, index: ReadingIndex | null, dict: FrDict | null): Tok[] {
  return tokenize(text, dict).map((t) => {
    if (!t.word || !index) return { text: t.text };
    const r = index.of(t.text);
    return r ? { text: t.text, key: r.key, status: r.status } : { text: t.text };
  });
}

// ---------------- 导入 ----------------

/** .srt / .vtt 字幕 → 每条的开始时间和文字（去掉 <i>、{\an8} 这类标记） */
export function parseSubtitles(src: string): Text['cues'] {
  const cues: Text['cues'] = [];
  for (const block of src.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const i = lines.findIndex((l) => /-->/.test(l));
    if (i < 0) continue;
    const m = /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,]\d{1,3}/.exec(lines[i]);
    const t = m ? `${(m[1] ?? '00:').padStart(3, '0')}${m[2].padStart(2, '0')}:${m[3]}` : '';
    const text = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    // 自动字幕常把上一条的末尾重复一遍：和上一条一样就跳过
    if (cues.length && cues[cues.length - 1].text === text) continue;
    cues.push({ t, text });
  }
  return cues;
}

/** Markdown → 纯文本：去掉 front matter、代码块、HTML 注释、标题和强调符号、链接地址 */
export function stripMarkdown(md: string): string {
  return md.replace(/\r/g, '')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}(#{1,6}|>+|[-*+]|\d+\.)[ \t]+/gm, '')
    .replace(/^[ \t]*\|?[-:| ]*-[-:| ]*\|?[ \t]*$/gm, '')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 文件名和内容 → 标题、正文、字幕 */
export function importFile(name: string, content: string): { title: string; body: string; cues: Text['cues'] } {
  const title = name.replace(/\.[^.]+$/, '');
  if (/\.(srt|vtt)$/i.test(name)) {
    const cues = parseSubtitles(content);
    return { title, cues, body: cues.map((c) => c.text).join('\n') };
  }
  if (/\.(md|markdown)$/i.test(name)) {
    const fm = /^---\n[\s\S]*?\btitle:\s*["']?(.+?)["']?\s*\n[\s\S]*?---/m.exec(content.replace(/\r/g, ''));
    return { title: fm?.[1] ?? title, cues: [], body: stripMarkdown(content) };
  }
  return { title, cues: [], body: content.replace(/\r/g, '').trim() };
}

export const wordCount = (s: string) => (s.match(/\p{L}+(?:['’-]\p{L}+)*/gu) ?? []).length;
