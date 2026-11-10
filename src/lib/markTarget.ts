// 按词条在例句里自动标出考查部分：写一次「表达」，每句例句自动加上 {{…}}。
// 变位、阴阳性、单复数靠词形还原（法语词典 + 变位表）和词首相同来认；表达被别的词隔开时分几段标
// （Il ne {{se rend}} pas {{compte de}} la chance），代动词的代词和中间的助动词一起标进去（je {{me suis attaché à}}）。

export interface Tok { t: string; word: boolean; on: boolean }
const SEP = /(\s+|[.,;:!?…«»"“”()–—]+|(?<=['’]))/;
const isSep = (t: string) => /^(\s+|[.,;:!?…«»"“”()–—]+)$/.test(t);

/** "a {{b c}} d" → 词元列表，记录每个词是否在 {{…}} 里（{{答案::提示}} 的提示部分不拆） */
export function toTokens(v: string): Tok[] {
  const out: Tok[] = [];
  let on = false;
  for (const part of v.split(/(\{\{|\}\})/)) {
    if (part === '{{') { on = true; continue; }
    if (part === '}}') { on = false; continue; }
    for (const t of part.split(SEP).filter(Boolean)) out.push({ t, word: !isSep(t), on: on && !isSep(t) });
  }
  return out;
}

/** 词元 → 文本：相邻（中间只隔空格或省音号）的标记词合并成一个 {{…}} */
export function fromTokens(toks: Tok[]): string {
  let s = '';
  let i = 0;
  while (i < toks.length) {
    if (toks[i].word && toks[i].on) {
      let j = i, end = i;
      while (j + 1 < toks.length) {
        const n = toks[j + 1];
        if (n.word && n.on) { j++; end = j; }
        else if (/^\s+$/.test(n.t) && toks[j + 2]?.word && toks[j + 2]?.on) j++;
        else break;
      }
      s += `{{${toks.slice(i, end + 1).map((x) => x.t).join('')}}}`;
      i = end + 1;
    } else { s += toks[i].t; i++; }
  }
  return s;
}

/** 去掉 {{…}}（保留答案，丢掉 ::提示） */
export const unmark = (s: string) => s.replace(/\{\{(.*?)\}\}/g, (_, x: string) => x.split('::')[0]);
/** 句子里标出的部分（多段用空格连起来） */
export const markedText = (s: string) => [...s.matchAll(/\{\{(.*?)\}\}/g)].map((m) => m[1].split('::')[0]).join(' ');
export const hasInlineHintMark = (s: string) => /\{\{[^}]*::/.test(s);

/** 词形 → 可能的原形（法语牌组用词典 + 变位表；没有时只靠词首比较） */
export type Lemmatize = (form: string) => string[];

/** 实词比较时去掉重音（attaché ~ attacher）；虚词保留重音（à ≠ a） */
const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/’/g, "'");
const lower = (w: string) => w.toLowerCase().normalize('NFC').replace(/’/g, "'");
const REFL = new Set(['me', 'te', 'se', 'nous', 'vous', "m'", "t'", "s'"]);
const ARTICLES = new Set(['le', 'la', 'les', "l'", 'un', 'une', 'des']);
const FUNC = new Set("le la les l' un une des de du d' à au aux en et ou se s' ne n' pas y que qu' qui ce cet cette ces sa son ses leur leurs mon ma mes ton ta tes notre nos votre vos nous vous il ils elle elles on je j' me m' te t' lui eux pour par sur dans avec sans mais donc car si plus moins très bien tout tous toute toutes".split(' '));
const POSS1 = ['mon', 'ton', 'son', 'ma', 'ta', 'sa', 'notre', 'votre', 'leur'];
const POSS2 = ['mes', 'tes', 'ses', 'nos', 'vos', 'leurs'];
/** 虚词的其他写法：de ↔ du / des / d'，à ↔ au / aux，le ↔ l'，sa ↔ ta / ma…（词条里写 sa，例句里可以是 ta） */
const FUNC_ALIASES: Record<string, string[]> = {
  de: ['de', 'du', 'des', "d'"], à: ['à', 'au', 'aux'], le: ['le', "l'", 'la', 'les'], la: ['la', "l'", 'le', 'les'], les: ['les', 'le', 'la', "l'"],
  que: ['que', "qu'"], ne: ['ne', "n'"], je: ['je', "j'"], ce: ['ce', 'cet', 'cette', 'ces', "c'"], un: ['un', 'une', 'des'], une: ['une', 'un', 'des'],
  ...Object.fromEntries(POSS1.map((x) => [x, POSS1])), ...Object.fromEntries(POSS2.map((x) => [x, POSS2])),
};
const AUX = new Set(('ai as a avons avez ont avais avait avions aviez avaient aurai auras aura aurons aurez auront aurais aurait aurions auriez auraient aie aies ait ayons ayez aient eu avoir ayant '
  + 'suis es est sommes etes sont etais etait etions etiez etaient serai seras sera serons serez seront serais serait serions seriez seraient sois soit soyons soyez soient ete etre etant').split(' '));

interface LW { w: string; kind: 'refl' | 'func' | 'content' }

/** 词条 → 要找的词：去掉 qqch / qqn、括号里的语法说明、开头的冠词；se / s' 记为代词 */
function lemmaWords(alt: string): LW[] {
  // 「+ inf.」「+ subj.」「+ adj.」这类语法说明整个去掉
  const cleaned = alt.replace(/\+\s*[\p{L}.]+/gu, ' ').replace(/\b(qqch|qqn|qch|qn|qc)\b\.?/gi, ' ').replace(/[+…]|\.\.\./g, ' ');
  const words = toTokens(cleaned).filter((t) => t.word).map((t) => lower(t.t));
  // 开头的冠词不考（une amende → 只标 amende），但只有冠词时保留
  while (words.length > 1 && ARTICLES.has(words[0])) words.shift();
  return words.map((w, i) => ({ w, kind: i === 0 && (w === 'se' || w === "s'") ? 'refl' : FUNC.has(w) ? 'func' : 'content' }));
}

function commonPrefix(a: string, b: string) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; }

function matches(lw: LW, form: string, lemmatize?: Lemmatize): boolean {
  if (lw.kind === 'refl') return REFL.has(lower(form));
  if (lw.kind === 'func') return lower(form) === lw.w || (FUNC_ALIASES[lw.w] ?? []).includes(lower(form));
  const f = norm(form), w = norm(lw.w);
  if (f === w) return true;
  if (lemmatize?.(form).some((l) => norm(l) === w)) return true;
  // 命令式、倒装带连字符：tiens-toi、consiste-t-il → 比第一段
  if (f.includes('-')) return matches(lw, form.split('-')[0], lemmatize);
  // 词首相同：attacher ~ attaché、flatter ~ flattant、ressentir ~ ressens
  return f.length >= 4 && w.length >= 4 && commonPrefix(f, w) >= Math.max(4, Math.min(f.length, w.length) - 3);
}

const MAX_GAP = 4;

/** 在一个句子里找一个词条（一种写法）：返回标出的词序号和找到的实词数 */
function align(words: string[], lw: LW[], lemmatize?: Lemmatize): { idx: number[]; content: number } | null {
  const memo = new Map<string, { score: number; idx: number[]; content: number }>();
  const go = (i: number, last: number): { score: number; idx: number[]; content: number } => {
    if (i === lw.length) return { score: 0, idx: [], content: 0 };
    const key = `${i}:${last}`;
    const hit = memo.get(key);
    if (hit) return hit;
    let best = go(i + 1, last);
    const end = last < 0 ? words.length : Math.min(words.length, last + 2 + MAX_GAP);
    for (let j = last + 1; j < end; j++) {
      if (!matches(lw[i], words[j], lemmatize)) continue;
      const rest = go(i + 1, j);
      const gain = lw[i].kind === 'content' ? 3 : 1;
      const gap = last < 0 ? 0 : (j - last - 1) * 0.4;
      const score = gain - gap + rest.score;
      if (score > best.score) best = { score, idx: [j, ...rest.idx], content: rest.content + (lw[i].kind === 'content' ? 1 : 0) };
    }
    memo.set(key, best);
    return best;
  };
  const r = go(0, -1);
  const total = lw.filter((x) => x.kind === 'content').length;
  if (!r.idx.length) return null;
  if (total ? r.content < Math.ceil(total / 2) : r.idx.length < lw.length) return null;
  return { idx: r.idx, content: r.content };
}

/** 按词条自动标出句子里的考查部分；找不到返回 null。句子里原有的 {{…}} 会被替换 */
export function autoMark(sentence: string, lemma: string, lemmatize?: Lemmatize): string | null {
  const plain = unmark(sentence);
  const toks = toTokens(plain);
  const wordPos = toks.map((t, i) => (t.word ? i : -1)).filter((i) => i >= 0);
  const words = wordPos.map((i) => toks[i].t);
  let best: { idx: number[]; content: number; size: number } | null = null;
  // 词条里的几种写法：括号先去掉（里面的逗号不算），再按 ; , / ｜ = vs 拆开，= 后面是解释
  const alts = lemma.replace(/\([^)]*\)|（[^）]*）/g, ' ').split(/[;,；，/｜|]|\svs\.?\s/).map((x) => x.split('=')[0].trim()).filter(Boolean);
  for (const alt of alts) {
    const lw = lemmaWords(alt);
    if (!lw.length) continue;
    const r = align(words, lw, lemmatize);
    if (r && (!best || r.content > best.content || (r.content === best.content && r.idx.length > best.size))) best = { ...r, size: r.idx.length };
  }
  if (!best) return null;
  const on = new Set(best.idx);
  // 两段标记之间夹着的助动词 / 代词也标上（je {{me suis attaché à}}）。单独一个动词前的助动词不标（il a {{repéré}}），和已有的卡一致
  const sorted = [...on].sort((a, b) => a - b);
  for (let x = 0; x + 1 < sorted.length; x++) {
    for (let k = sorted[x] + 1; k < sorted[x + 1]; k++) if (AUX.has(norm(words[k])) || REFL.has(norm(words[k]))) on.add(k);
  }
  return fromTokens(toks.map((t, i) => ({ ...t, on: t.word && on.has(wordPos.indexOf(i)) })));
}
