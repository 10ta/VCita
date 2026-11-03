// 找可能易混的词（纯函数），给词库"可能易混"筛选用：选中后设成易混组，就会生成辨析卡。
// 两种易混（干扰理论：相似的记忆互相干扰，是遗忘的主要原因之一）：
//  - 意思相近：中文意思里有同一个不常见的词（teinter / colorer 都有"染上"）
//  - 拼写相近：词头只差一个字母（amende / amande、ressembler / rassembler）
import type { Note } from '../schema';
import { fold } from '../lib/gender/rules';

export interface ConfusablePair { a: string; b: string; reason: string }

const FUNC = new Set('le la les l un une des de du d a au aux en et ou se s ne pas y que qu qui ce sa son ses leur leurs mon ma mes ton ta tes etre avoir faire qqch qqn pour par sur dans avec il elle est'.split(' '));
/** 词条的第一个实词（去掉重音），用来比拼写 */
const head = (lemma: string) => fold(lemma).replace(/\([^)]*\)/g, ' ').split(/[^a-z-]+/).find((w) => w.length > 1 && !FUNC.has(w)) ?? '';
/** 中文意思里的词：按标点切开，去掉括号说明，至少两个汉字 */
const zhTerms = (s: string) => [...new Set(s.replace(/[（(][^）)]*[）)]/g, ' ').replace(/…+|\.{3}/g, '').split(/[；;，,、/\s。:：|]+/).map((x) => x.replace(/^[把被让使对给在]|[的地得了着过]$/g, '').trim()).filter((x) => /^\p{Script=Han}{2,}$/u.test(x)))];

function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export function findConfusables(notes: readonly Pick<Note, 'id' | 'lemma' | 'meaningZh' | 'contrastGroup' | 'deleted'>[]): ConfusablePair[] {
  const live = notes.filter((n) => !n.deleted && n.lemma.trim());
  const pairs: ConfusablePair[] = [];
  const seen = new Set<string>();
  const add = (a: string, b: string, reason: string) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push({ a, b, reason });
  };
  const sameGroup = (x: (typeof live)[number], y: (typeof live)[number]) => !!x.contrastGroup && x.contrastGroup === y.contrastGroup;

  // 意思相近：同一个中文词只在 2–4 条笔记里出现（太常见的词如"影响"不算）
  const byTerm = new Map<string, Array<(typeof live)[number]>>();
  for (const n of live) for (const t of zhTerms(n.meaningZh)) (byTerm.get(t) ?? byTerm.set(t, []).get(t)!).push(n);
  for (const [term, ns] of byTerm) {
    if (ns.length < 2 || ns.length > 4) continue;
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      const x = ns[i], y = ns[j];
      // 同词族（constater / constatation）不算易混，是一家人
      if (sameGroup(x, y) || head(x.lemma).slice(0, 5) === head(y.lemma).slice(0, 5)) continue;
      add(x.id, y.id, `意思相近：${term}`);
    }
  }
  // 拼写相近：词头 ≥ 6 个字母、只差 1 个字母、而且不是差在第一个字母上（amende / amande、ressembler / rassembler、pécher / pencher）。
  // 差在开头的（mettre / lettre、rendre / prendre）一般不会混；同词族（一个是另一个的前缀）不算
  const heads = live.map((n) => ({ n, h: head(n.lemma) })).filter((x) => x.h.length >= 6);
  for (let i = 0; i < heads.length; i++) for (let j = i + 1; j < heads.length; j++) {
    const x = heads[i], y = heads[j];
    if (x.h[0] !== y.h[0] || x.h.slice(0, 5) === y.h.slice(0, 5) || sameGroup(x.n, y.n)) continue;
    if (lev(x.h, y.h, 1) <= 1) add(x.n.id, y.n.id, `拼写相近：${x.h} / ${y.h}`);
  }
  return pairs;
}
