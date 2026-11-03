// 产出卡：把自己写的和标准答案逐词对照（不自动判对错，只把不同的地方标出来）。
// 差别分三类：重音（只差重音符号）、阴阳性（le / la、un / une、grand / grande 这种同一个词的另一性）、其他。
import { fold, norm } from './gender/rules';

export type DiffKind = 'accent' | 'gender' | 'word';
export type DiffOp =
  | { op: 'same'; text: string }
  | { op: 'sub'; typed: string; expected: string; kind: DiffKind }
  | { op: 'missing'; expected: string }
  | { op: 'extra'; typed: string };

/** 词和标点；省音的 d' / l' / qu' 单独成一个词 */
export function tokens(s: string): string[] {
  return s.replace(/’/g, "'").match(/\p{L}+'|\p{L}+(?:-\p{L}+)*|\d+|[^\s\p{L}\d]/gu) ?? [];
}

const GENDER_PAIRS: Array<[string, string]> = [
  ['le', 'la'], ['un', 'une'], ['du', 'de la'], ['au', 'à la'], ['ce', 'cette'], ['cet', 'cette'], ['mon', 'ma'], ['ton', 'ta'], ['son', 'sa'],
  ['il', 'elle'], ['ils', 'elles'], ['celui', 'celle'], ['ceux', 'celles'], ['lequel', 'laquelle'], ['auquel', 'à laquelle'], ['duquel', 'de laquelle'],
  ['quel', 'quelle'], ['aucun', 'aucune'], ['tout', 'toute'], ['tous', 'toutes'], ['certain', 'certaine'], ['nul', 'nulle'],
];
const pairKey = (a: string, b: string) => [norm(a), norm(b)].sort().join('|');
const GENDER_SET = new Set(GENDER_PAIRS.map(([a, b]) => pairKey(a, b)));

/** 同一个词的阳性 / 阴性形式（不靠词典的粗判：去掉阴性词尾后相同） */
const FEM_ENDINGS: Array<[string, string]> = [['e', ''], ['ne', ''], ['le', ''], ['te', ''], ['se', 'x'], ['ve', 'f'], ['euse', 'eur'], ['trice', 'teur'], ['ère', 'er'], ['ière', 'ier'], ['elle', 'eau'], ['ienne', 'ien'], ['enne', 'en'], ['onne', 'on'], ['ette', 'et'], ['es', 's'], ['es', '']];
function isGenderVariant(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (GENDER_SET.has(pairKey(x, y))) return true;
  for (const [f, m] of FEM_ENDINGS) {
    if (x.endsWith(f) && x.slice(0, -f.length) + m === y) return true;
    if (y.endsWith(f) && y.slice(0, -f.length) + m === x) return true;
  }
  return false;
}

function classify(typed: string, expected: string): DiffKind {
  if (fold(typed) === fold(expected)) return 'accent';
  if (isGenderVariant(typed, expected)) return 'gender';
  return 'word';
}

/** 逐词对照；大小写不算差别 */
export function diffWords(typed: string, expected: string): DiffOp[] {
  const a = tokens(typed), b = tokens(expected);
  const eq = (x: string, y: string) => norm(x) === norm(y);
  // LCS
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = eq(a[i], b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const raw: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && eq(a[i], b[j])) { raw.push({ op: 'same', text: b[j] }); i++; j++; }
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) { raw.push({ op: 'missing', expected: b[j++] }); }
    else raw.push({ op: 'extra', typed: a[i++] });
  }
  // 相邻的"多写 / 漏写"配成替换：一段连续的差异里按顺序一一配对
  const out: DiffOp[] = [];
  for (let k = 0; k < raw.length;) {
    if (raw[k].op === 'same') { out.push(raw[k++]); continue; }
    const extras: string[] = [], missing: string[] = [];
    while (k < raw.length && raw[k].op !== 'same') {
      const r = raw[k++];
      if (r.op === 'extra') extras.push(r.typed); else if (r.op === 'missing') missing.push(r.expected);
    }
    // 词和词配、标点和标点配（不把 un 配成 .）
    const isP = (t: string) => /^[^\p{L}\d]+$/u.test(t);
    for (const punct of [false, true]) {
      const ex = extras.filter((t) => isP(t) === punct), mi = missing.filter((t) => isP(t) === punct);
      const p = Math.min(ex.length, mi.length);
      for (let x = 0; x < p; x++) out.push({ op: 'sub', typed: ex[x], expected: mi[x], kind: classify(ex[x], mi[x]) });
      for (const t of ex.slice(p)) out.push({ op: 'extra', typed: t });
      for (const e of mi.slice(p)) out.push({ op: 'missing', expected: e });
    }
  }
  return out;
}

/** 写的是整句还是只写了要换的那部分：词数接近整句时和整句比，否则只和答案的高亮部分比 */
export function pickReference(typed: string, answerFr: string): { ref: string; whole: boolean } {
  const plain = answerFr.replace(/\{\{(.*?)\}\}/g, (_, x: string) => x.split('::')[0]);
  const targets = [...answerFr.matchAll(/\{\{(.*?)\}\}/g)].map((m) => m[1].split('::')[0]);
  if (!targets.length) return { ref: plain, whole: true };
  const t = tokens(typed).length, whole = tokens(plain).length, part = tokens(targets.join(' ')).length;
  return Math.abs(t - whole) < Math.abs(t - part) ? { ref: plain, whole: true } : { ref: targets.join(' '), whole: false };
}

export function summarize(ops: DiffOp[]): { total: number; accent: number; gender: number } {
  let total = 0, accent = 0, gender = 0;
  for (const o of ops) {
    if (o.op === 'same' || (o.op !== 'sub' && /^[^\p{L}\d]$/u.test(o.op === 'missing' ? o.expected : o.typed))) continue;
    total++;
    if (o.op === 'sub' && o.kind === 'accent') accent++;
    if (o.op === 'sub' && o.kind === 'gender') gender++;
  }
  return { total, accent, gender };
}
