// 笔记的校验规则（编辑器、批量导入共用）
import type { Note } from './index';

export const hasCloze = (s: string) => /\{\{.+?\}\}/.test(s);
/** 句子里所有 {{…}} 的内容（{{答案::提示}} 只取答案），多处用 … 连起来：{{avoir}} ces idées {{en tête}} → avoir … en tête */
export const clozeTargets = (s: string) => [...s.matchAll(/\{\{(.+?)\}\}/g)].map((m) => m[1].split('::')[0].trim()).filter(Boolean);
export const clozeTarget = (s: string) => clozeTargets(s).join(' … ');
/** 句子里是否带内联提示 {{答案::提示}} */
export const hasInlineHint = (s: string) => /\{\{[^}]*?::[^}]+?\}\}/.test(s);

export const defaultCardTypes = (layer: Note['layer']): Note['cardTypes'] =>
  layer === 'core' ? ['recognition', 'production'] : ['recognition'];

// 不算"泄露"的虚词：提示里出现 de、à、le、所有格、avoir / être 的变位（ait、ont、soit…）不等于给出了答案（除非答案本身就只有这些词）。写的是去掉重音后的形式
const FUNC = new Set('a à au aux de des du d le la les l un une en et ou y ne pas se s me m te t sa son ses ma mon mes ta ton tes leur leurs ait aient eu ont avons avez avait avaient aura aurait auraient soit soient sera serait seraient suis es sommes etes etais etait etaient ete dont si mais comme quand donc car qqch qqn nous vous tu toi moi lui eux il ils elle elles on je j que qu qui ce c ça est sont être avoir pour par sur dans avec sans plus très'.split(' ').map((w) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
const words = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
/** 同词根：都 ≥5 个字母且前 5 个字母相同（changement / changements、motif / motiver） */
const sameStem = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));

/** 提示里出现了答案的词，返回泄露的词，没有就是空数组。
 *  挖空提示（stem = false）：只查原样出现的词——提示给原形、考变位（{{dégringolé::dégringoler · 复合过去时}}）是正常用法；
 *  产出卡法语题面（stem = true）：换说法不能用同词根的词 */
export function hintLeaks(answer: string, hint: string, stem = false): string[] {
  const same = stem ? sameStem : (a: string, b: string) => a === b;
  const aw = words(answer);
  const hw = words(hint);
  // 单个字母（convaincu(e) 里的 e）不算词
  const content = aw.filter((w) => !FUNC.has(w) && w.length > 1);
  // 答案全是虚词（如只挖了 de）：提示里整串出现就算泄露
  if (!content.length) return aw.length && ` ${hw.join(' ')} `.includes(` ${aw.join(' ')} `) ? [aw.join(' ')] : [];
  return [...new Set(content.filter((w) => hw.some((h) => same(w, h))))];
}

/** 挖空卡的提示（笔记的挖空提示 + 句中 {{答案::提示}}）有没有泄露答案 */
function clozeLeaks(sentence: string, clozeHint: string | null | undefined): string[] {
  const answer = clozeTargets(sentence).join(' ');
  const inline = [...sentence.matchAll(/\{\{[^}]*?::([^}]+?)\}\}/g)].map((m) => m[1]).join(' ');
  return hintLeaks(answer, `${clozeHint ?? ''} ${inline}`);
}

type Fields = Pick<Note, 'lemma' | 'sentence' | 'cardTypes' | 'intentZh' | 'answerFr'> & Partial<Pick<Note, 'clozeSentence' | 'clozeHint' | 'promptFr'>>;

export function noteErrors(n: Fields): string[] {
  const errs: string[] = [];
  const cloze = hasCloze(n.sentence);
  if (!n.cardTypes.length) errs.push('至少选一种卡');
  if (n.sentence.trim() && !cloze) errs.push('例句里要用 {{…}} 标出考查的部分');
  const cs = n.clozeSentence?.trim() ?? '';
  if (cs && !hasCloze(cs)) errs.push('挖空例句里要用 {{…}} 标出挖掉的部分');
  if (n.cardTypes.includes('cloze') && !cloze && !cs) errs.push('挖空卡需要带 {{…}} 的例句');
  // 迁移来的旧卡没有例句，允许只有单词
  if (n.cardTypes.includes('recognition') && !cloze && !n.lemma.trim()) errs.push('认读卡需要例句或单词');
  if (n.cardTypes.includes('production')) errs.push(...promptErrors(n.promptFr ?? null, n.intentZh, n.answerFr));
  if (n.cardTypes.includes('cloze')) {
    const leak = clozeLeaks(cs && hasCloze(cs) ? cs : n.sentence, n.clozeHint);
    if (leak.length) errs.push(`挖空提示里出现了答案：${leak.join('、')}（提示只给意思，不给答案的词）`);
  }
  return errs;
}

/** 一道产出题（主题或备用题）的校验：法语题面或中文意图至少一个，题面要用 {{…}} 标出要换掉的说法，且不能直接给出答案 */
export function promptErrors(promptFr: string | null, intentZh: string | null, answerFr: string | null): string[] {
  const p = promptFr?.trim() ?? '';
  if (!answerFr?.trim() || (!p && !intentZh?.trim())) return ['产出卡需要"法语题面"（或"中文意图"）和"法语答案"'];
  if (!p) return [];
  if (!hasCloze(p)) return ['法语题面要用 {{…}} 标出要换掉的说法'];
  const answer = hasCloze(answerFr) ? clozeTargets(answerFr).join(' ') : answerFr;
  const leak = hintLeaks(answer, clozeTargets(p).join(' '), true);
  return leak.length ? [`法语题面的高亮部分直接给出了答案：${leak.join('、')}（换一个说法）`] : [];
}
