// 替代说法：相对这张卡的谜底，还有哪些说法（下位 / 平替 / 近义 / 上位）。纯静态合并，不生成：
//   自写    note.alts（做卡时写的）
//   题面    产出题面高亮里的换说法（类型取 promptKind）
//   补充    extra 里「近义 / 同义 / 也说 / 朴素版」写的说法
//   表达群  同群的其他笔记（能互换 = 平替）
//   RL-fr   Réseau Lexical du Français 按义项分开的同义关系：Syn⊂（更宽）= 下位，Syn = 平替，Syn∩ = 近义，Syn⊃（更窄、更强）= 上位。
//           一个词有几个义项时，用卡片的例句和各义项例句里的关键词比对；判不出来就不用（宁缺毋滥）
// 每类最多三条。每个说法再标 CEFR 级别（FLELex，按词里最难的那个词）和「在库」（词库里有这条笔记，点了能看）。
// 点了 ✗ 的记进 note.altNo，以后不再显示。
import type { Note } from '../schema';
import type { Levels, RlIndex, RlKind } from '../lib/alts';

export type AltKind = RlKind;
export type AltSource = '自写' | '题面' | '补充' | '表达群' | 'RL-fr';
export interface AltItem {
  fr: string; kind: AltKind; source: AltSource;
  /** CEFR 级别（A1…C2）；有词查不到时为 null */
  level: string | null;
  /** 词库里有这条说法：那条笔记的 id 和中文意思 */
  noteId?: string; zh?: string;
  /** 下位说法超过 B1：不算合格的退路 */
  tooHard?: boolean;
}
export interface LocalAlt { fr: string; kind: AltKind; source: AltSource; zh?: string }
type N = Pick<Note, 'id' | 'lemma' | 'meaningZh' | 'sentence' | 'altSentences' | 'extra' | 'usage' | 'contexts' | 'cluster' | 'promptFr' | 'promptKind' | 'alts' | 'altNo' | 'deleted' | 'frame'>;

export const KIND_ORDER: AltKind[] = ['下位', '平替', '近义', '上位'];
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const STOP = new Set('le la les l un une des de du d à au aux en et ou se s y ne pas que qui sur pour par avec dans contre entre vers chez sans sous qqn qqch qch sb sth'.split(' '));

/** 比较用的形式：小写、去括号说明、去 qqn / qqch、去开头冠词 */
export function altKey(s: string): string {
  return s.toLowerCase().replace(/’/g, "'").replace(/\([^)]*\)|（[^）]*）/g, ' ').replace(/\b(qqn|qqch|qch)\b/g, ' ')
    .replace(/^\s*(un|une|le|la|les|des|du|l')\s*/, '').replace(/\s+/g, ' ').trim().replace(/[\s,;/]+$/, '');
}
const firstMeaning = (n: Pick<Note, 'meaningZh'>) => (n.meaningZh ?? '').split(/[；;]/)[0].replace(/[（(][^）)]*[A-Za-zÀ-ÿ][^）)]*[）)]/g, '').trim();
const tokens = (s: string) => (s.toLowerCase().match(/[a-zà-ÿœæ]+/g) ?? []).filter((w) => w.length > 3);

/** 一个说法的 CEFR 级别：每个实词都查得到时取最难的，有查不到的返回 null */
export function levelOf(fr: string, levels: Levels | null | undefined, lemmatize?: (w: string) => string[]): string | null {
  if (!levels) return null;
  const ws = (altKey(fr).match(/[a-zà-ÿœæ-]+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w));
  if (!ws.length) return null;
  let worst = 0;
  for (const w of ws) {
    const cands = [w, ...(lemmatize?.(w) ?? [])];
    const l = cands.map((c) => levels.get(c)).find(Boolean);
    if (!l) return null;
    worst = Math.max(worst, LEVELS.indexOf(l));
  }
  return LEVELS[worst];
}

/** RL-fr 里这条笔记对应的义项：词条只有一个义项就用它；几个义项时按例句关键词比对，最高分明显领先才算判出 */
export function rlSense(note: N, rl: RlIndex | null | undefined) {
  if (!rl) return null;
  const k = altKey(note.lemma);
  const senses = rl.get(k) ?? rl.get(k.replace(/^(se |s')/, '')) ?? null;
  if (!senses?.length) return null;
  if (senses.length === 1) return senses[0];
  const ctx = new Set(tokens([note.sentence, ...(note.altSentences ?? []), note.extra ?? '', note.usage ?? '', ...(note.contexts ?? [])].join(' ').replace(/\{\{|\}\}/g, '')));
  const scored = senses.map((s) => ({ s, n: [...s.kw].filter((w) => ctx.has(w)).length })).sort((a, b) => b.n - a.n);
  return scored[0].n > 0 && scored[0].n > scored[1].n ? scored[0].s : null;
}

const deckIndex = new WeakMap<object, Map<string, N>>();
function indexOf(notes: readonly N[]) {
  let m = deckIndex.get(notes);
  if (!m) {
    m = new Map();
    for (const n of notes) if (!n.deleted && !n.frame) { const k = altKey(n.lemma); if (k && !m.has(k)) m.set(k, n); }
    deckIndex.set(notes, m);
  }
  return m;
}

const SOURCE_RANK: Record<AltSource, number> = { 自写: 0, 题面: 1, 补充: 2, 表达群: 3, 'RL-fr': 4 };

/** 合并所有来源：去重（同一个说法留排在前面的来源）、去掉 ✗ 过的和谜底本身，按 下位 → 平替 → 近义 → 上位、在库优先、级别从低到高排 */
export function altsOf(note: N, notes: readonly N[], data: { rl?: RlIndex | null; levels?: Levels | null; lemmatize?: (w: string) => string[] }, local: LocalAlt[] = [], perKind = 3): AltItem[] {
  const raw: LocalAlt[] = [...(note.alts ?? []).map((a) => ({ ...a, source: '自写' as const })), ...local];
  if (note.cluster) for (const m of notes) if (m.id !== note.id && !m.deleted && m.cluster === note.cluster) raw.push({ fr: m.lemma, kind: '平替', source: '表达群' });
  const sense = rlSense(note, data.rl);
  if (sense) for (const k of KIND_ORDER) for (const w of sense.alts[k]) raw.push({ fr: w, kind: k, source: 'RL-fr' });
  const no = new Set((note.altNo ?? []).map(altKey));
  const own = altKey(note.lemma);
  const deck = indexOf(notes);
  const seen = new Map<string, AltItem>();
  for (const a of raw.sort((x, y) => SOURCE_RANK[x.source] - SOURCE_RANK[y.source])) {
    const k = altKey(a.fr);
    if (!k || k === own || no.has(k) || seen.has(k)) continue;
    const hit = deck.get(k);
    const level = levelOf(a.fr, data.levels, data.lemmatize);
    const item: AltItem = { fr: a.fr, kind: a.kind, source: a.source, level };
    if (hit && hit.id !== note.id) { item.noteId = hit.id; item.zh = firstMeaning(hit); }
    else if (a.zh) item.zh = a.zh;
    if (a.kind === '下位' && level && LEVELS.indexOf(level) > 2) item.tooHard = true;
    seen.set(k, item);
  }
  const lv = (x: AltItem) => (x.level ? LEVELS.indexOf(x.level) : 9);
  // 每类最多 perKind 条：在库的优先，其次按来源（自写、题面最可靠），再按级别从低到高
  const count = new Map<AltKind, number>();
  return [...seen.values()]
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || Number(!!b.noteId) - Number(!!a.noteId) || SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || lv(a) - lv(b))
    .filter((a) => { const c = count.get(a.kind) ?? 0; count.set(a.kind, c + 1); return c < perKind; });
}
