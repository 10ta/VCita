// 关联引擎（纯函数、纯静态，不用 AI）：
// 1) 同概念（强）：note.topics 里的概念相同 → 互相关联。概念表见 lib/concepts.ts；不在表里的旧话题也照样按名字归组
// 2) 同类（弱）：强关联不到 3 条时，同一大类里意思最接近的几条补上
// 3) 同词族：Wiktionnaire 词族（有数据时）、词族线索里写到对方的词、或同一个中心词
// 4) 可能相关：没有共同概念、但中文 / 英文意思高度重合（或 Wiktionnaire 同义）的几条，等用户确认或否决。
//    确认 = 把这条的概念加给对方；否决 = 记进 relNo，以后不再推荐
// 1000 条笔记全算一遍是毫秒级：倒排索引 + 每条笔记的特征只算一次（按 notes 数组缓存）
import type { Note } from '../schema';
import { conceptGroup, isConcept } from '../lib/concepts';
import type { WiktIndex } from '../lib/wikt';

type N = Pick<Note, 'id' | 'lemma' | 'meaningZh' | 'meaningEn' | 'topics' | 'cluster' | 'contrastGroup' | 'cueFamily' | 'deleted' | 'frame' | 'relNo'>;

export interface RelatedSet<T extends N = N> {
  /** 同概念：每个概念一组 */
  concepts: Array<{ concept: string; legacy: boolean; mates: T[] }>;
  /** 同类（弱）：大类名 + 几条 */
  weak: { group: string; mates: T[] } | null;
  /** 同词另义：中心词相同的其他笔记（另一个义项 / 另一个搭配），放在关联最前面，复习一张顺带看另一张 */
  sameWord: T[];
  family: T[];
  suspects: T[];
}

const HAN = /[㐀-鿿]/g;
// 太常见、不区分意思的字
const STOP_ZH = new Set('的了是在有和与或把被让使对向从于为以而及其之一不也都很更最某些个这那着过地得会能要去来做人事物东西什么怎么'.split(''));
const STOP_EN = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'onto', 'one', 'someone', 'something', 'sth', 'sb', 'oneself', 'have', 'has', 'get', 'make', 'take', 'give', 'put', 'very', 'not', 'all', 'out', 'off', 'about', 'over', 'such', 'its', 'one\'s', 'be', 'being', 'been', 'are', 'was', 'were', 'who', 'what', 'when', 'way', 'kind', 'thing', 'things']);

// 中心词：第一个不是功能词 / 轻动词的词（mettre en relief → relief；sous l'emprise de → emprise），用来判断同词族
const LIGHT = new Set(('le la les un une des du de d l à au aux en dans sur sous par pour avec sans contre vers entre chez se s qqch qqn ' +
  'être avoir faire mettre prendre donner aller venir tenir passer porter rendre laisser voir dire pouvoir vouloir devoir savoir falloir ' +
  'il elle on ce ça c que qu qui ne pas plus très tout tous toute toutes son sa ses mon ma mes leur leurs y lui me te nous vous ' +
  'est sont été fait mis pris coup fois chose chez comme si bien mal').split(' '));
export function centerWord(lemma: string): string {
  const ws = lemma.toLowerCase().replace(/[’]/g, "'").replace(/\([^)]*\)/g, ' ').split(/[^a-zà-ÿœæ-]+/).filter(Boolean);
  return ws.find((w) => w.length >= 4 && !LIGHT.has(w)) ?? '';
}

interface Feat { zh: Set<string>; en: Set<string>; head: string }
const cache = new WeakMap<readonly N[], { feat: Map<string, Feat>; byConcept: Map<string, N[]>; byGroup: Map<string, N[]>; byHead: Map<string, N[]>; live: N[] }>();

/** 中文意思：去掉括号里的法语，取所有汉字的二元组（单字意思也算一个） */
function zhGrams(s: string): Set<string> {
  const clean = (s || '').replace(/[（(][^）)]*[A-Za-zÀ-ÿ][^）)]*[）)]/g, '');
  const out = new Set<string>();
  for (const part of clean.split(/[；;，,、/。|\s（）()…·]+/)) {
    const cs = (part.match(HAN) ?? []).filter((c) => !STOP_ZH.has(c));
    if (cs.length === 1) out.add(cs[0]);
    for (let i = 0; i + 1 < cs.length; i++) out.add(cs[i] + cs[i + 1]);
  }
  return out;
}
const stem = (w: string) => w.replace(/(ing|ed|es|s|ly)$/, '');
function enWords(s: string): Set<string> {
  return new Set((s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z']+/).filter((w) => w.length > 2 && !STOP_EN.has(w)).map(stem));
}
const dice = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return (2 * n) / (a.size + b.size);
};

function index(notes: readonly N[]) {
  let c = cache.get(notes);
  if (c) return c;
  const live = notes.filter((n) => !n.deleted && !n.frame && n.lemma.trim());
  const feat = new Map<string, Feat>();
  const byConcept = new Map<string, N[]>();
  const byGroup = new Map<string, N[]>();
  const byHead = new Map<string, N[]>();
  const push = (m: Map<string, N[]>, k: string, n: N) => { const xs = m.get(k); if (xs) { if (!xs.includes(n)) xs.push(n); } else m.set(k, [n]); };
  for (const n of live) {
    const head = centerWord(n.lemma);
    feat.set(n.id, { zh: zhGrams(n.meaningZh), en: enWords(n.meaningEn), head });
    for (const t of n.topics ?? []) {
      const k = t.trim();
      if (!k) continue;
      push(byConcept, k, n);
      const g = conceptGroup(k);
      if (g) push(byGroup, g, n);
    }
    if (head) push(byHead, head, n);
  }
  c = { feat, byConcept, byGroup, byHead, live };
  cache.set(notes, c);
  return c;
}

/** 两条笔记意思有多接近（0–1）：中文二元组 Dice 为主，英文词重合为辅，Wiktionnaire 同义直接拉满 */
export function similarity(a: N, b: N, notes: readonly N[], wikt?: WiktIndex | null): number {
  const { feat } = index(notes);
  const fa = feat.get(a.id), fb = feat.get(b.id);
  if (!fa || !fb) return 0;
  if (wikt && fa.head && fb.head && fa.head !== fb.head && (wikt.get(fa.head)?.synonyms.includes(fb.head) || wikt.get(fb.head)?.synonyms.includes(fa.head))) return 1;
  return Math.max(dice(fa.zh, fb.zh), 0.85 * dice(fa.en, fb.en));
}

const blocked = (a: N, b: N) => !!(a.relNo?.includes(b.id) || b.relNo?.includes(a.id));
const sameCluster = (a: N, b: N) => !!(a.cluster?.trim() && a.cluster.trim() === b.cluster?.trim());

export const SUSPECT_MIN = 0.5;
const WEAK_MAX = 4;
const MATE_MAX = 8;

export function relatedOf<T extends N>(note: T, notes: readonly T[], wikt?: WiktIndex | null): RelatedSet<T> {
  const ix = index(notes);
  const me = note;
  const shown = new Set<string>([me.id]);
  const ok = (n: N) => n.id !== me.id && !blocked(me, n) && !sameCluster(me, n);

  const myHead = ix.feat.get(me.id)?.head ?? '';
  const sameWord = myHead ? (ix.byHead.get(myHead) ?? []).filter((n) => n.id !== me.id && !blocked(me, n)).slice(0, 6) : [];
  sameWord.forEach((m) => shown.add(m.id));

  const concepts = (me.topics ?? []).map((t) => t.trim()).filter(Boolean).map((concept) => {
    const mates = (ix.byConcept.get(concept) ?? []).filter(ok)
      .sort((a, b) => similarity(me, b, notes, wikt) - similarity(me, a, notes, wikt)).slice(0, MATE_MAX);
    mates.forEach((m) => shown.add(m.id));
    return { concept, legacy: !isConcept(concept), mates };
  }).filter((x) => x.mates.length);
  const strong = shown.size - 1 - sameWord.length;

  let weak: RelatedSet['weak'] = null;
  if (strong < 3) {
    const groups = [...new Set((me.topics ?? []).map((t) => conceptGroup(t)).filter((g): g is string => !!g))];
    const pool = groups.flatMap((g) => (ix.byGroup.get(g) ?? []).map((n) => ({ g, n }))).filter(({ n }) => ok(n) && !shown.has(n.id));
    const ranked = pool.map((x) => ({ ...x, s: similarity(me, x.n, notes, wikt) })).sort((a, b) => b.s - a.s).slice(0, WEAK_MAX - Math.min(strong, WEAK_MAX - 1));
    if (ranked.length) {
      weak = { group: ranked[0].g, mates: ranked.map((x) => x.n) };
      ranked.forEach((x) => shown.add(x.n.id));
    }
  }

  // 词族：同一个中心词的其他笔记、Wiktionnaire 词族、词族线索里写到的词
  const head = ix.feat.get(me.id)?.head ?? '';
  const famHeads = new Set<string>(wikt?.get(head)?.family ?? []);
  const cueWords = new Set((me.cueFamily ?? '').toLowerCase().match(/[a-zà-ÿœæ'-]{4,}/g) ?? []);
  const family = ix.live.filter((n) => {
    if (n.id === me.id || shown.has(n.id) || blocked(me, n)) return false;
    const h = ix.feat.get(n.id)?.head ?? '';
    if (!h || h.length < 4) return false;
    if (famHeads.has(h) || cueWords.has(h)) return true;
    const theirCue = (n.cueFamily ?? '').toLowerCase();
    return head.length >= 4 && new RegExp(`(^|[^a-zà-ÿ])${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-zà-ÿ]|$)`).test(theirCue);
  }).slice(0, 6);
  family.forEach((m) => shown.add(m.id));

  const myGroupMates = new Set((me.contrastGroup ? ix.live.filter((n) => n.contrastGroup === me.contrastGroup) : []).map((n) => n.id));
  const suspects = ix.live
    .filter((n) => !shown.has(n.id) && ok(n) && !myGroupMates.has(n.id) && !(n.topics ?? []).some((t) => (me.topics ?? []).includes(t)))
    .map((n) => ({ n, s: similarity(me, n, notes, wikt) }))
    .filter((x) => x.s >= SUSPECT_MIN)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.n);

  return { sameWord, concepts, weak, family, suspects } as unknown as RelatedSet<T>;
}
