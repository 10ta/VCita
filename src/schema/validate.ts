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
 *  stem = true：同词根也算（原形 dégringoler 泄露 dégringolé；产出卡的换说法也不能用同根词）。挖空提示和产出题面都用 stem = true */
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

/** 挖空卡的提示（笔记的挖空提示 + 句中 {{答案::提示}}）有没有泄露答案（含原形 / 同根词） */
function clozeLeaks(sentence: string, clozeHint: string | null | undefined): string[] {
  const answer = clozeTargets(sentence).join(' ');
  const inline = [...sentence.matchAll(/\{\{[^}]*?::([^}]+?)\}\}/g)].map((m) => m[1]).join(' ');
  return hintLeaks(answer, `${clozeHint ?? ''} ${inline}`, true);
}
/** 挖掉的只有虚词（介词、冠词、代词……如 se rend pas compte {{de}}）：答案由上下文决定，不需要提示，也不自动用中文意思当提示 */
export function blankIsFunctionWords(sentence: string): boolean {
  const aw = words(clozeTargets(sentence).join(' '));
  return aw.length > 0 && aw.every((w) => FUNC.has(w) || w.length < 2);
}

// 纯语法标签：只说了"是什么词 / 什么时态"，没说意思。去掉这些词和标点后什么都不剩，就是纯标签（「介词」「动词（复合过去时）」）
const LABELS = '介词短语 介词 前置词 动词短语 动词 形容词 名词短语 名词 副词短语 副词 连词 关系代词 人称代词 指示代词 宾语代词 代词 宾语 主语 冠词 限定词 固定搭配 搭配 短语 表达 词组 习语 变位 原形 不定式 条件式现在时 条件式过去时 条件式 虚拟式现在时 虚拟式过去时 虚拟式 复合过去时 未完成过去时 愈过去时 简单将来时 先将来时 最近将来时 将来时 现在时 命令式 直陈式 过去分词 现在分词 副动词 被动态 被动 阴性 阳性 复数 单数 否定 强调句 时态 语式 一个词 两个词 填空 答案'
  .split(' ').sort((a, b) => b.length - a.length);
/** 提示只是语法标签、没有意思（「介词」「动词（复合过去时）」）：横线处有多种填法，答案不唯一 */
export function labelOnlyHint(hint: string | null | undefined): boolean {
  let x = hint?.trim() ?? '';
  if (!x) return false;
  for (const t of LABELS) x = x.split(t).join('');
  return !/[\p{L}]/u.test(x.replace(/[\d_]/g, ''));
}
const inlineHints = (s: string) => [...s.matchAll(/\{\{[^}]*?::([^}]+?)\}\}/g)].map((m) => m[1]);

type Fields = Pick<Note, 'lemma' | 'sentence' | 'cardTypes' | 'intentZh' | 'answerFr'> & Partial<Pick<Note, 'clozeSentence' | 'clozeHint' | 'promptFr' | 'altSentences'>>;

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
  if (n.cardTypes.includes('production')) errs.push(...promptErrors(n.promptFr ?? null, n.intentZh, n.answerFr, n.lemma));
  if (n.cardTypes.includes('cloze')) {
    const leak = clozeLeaks(cs && hasCloze(cs) ? cs : n.sentence, n.clozeHint);
    if (leak.length) errs.push(`挖空提示里出现了答案：${leak.join('、')}（提示只给意思，不给答案的词或原形）`);
    (n.altSentences ?? []).forEach((a, i) => {
      const l = clozeLeaks(a, null);
      if (l.length) errs.push(`备用例句第 ${i + 1} 句的提示里出现了答案：${l.join('、')}`);
    });
    const labels = [n.clozeHint ?? '', ...[n.sentence, cs, ...(n.altSentences ?? [])].flatMap(inlineHints)].filter(labelOnlyHint);
    if (labels.length) errs.push(`挖空提示只写了语法标签：${labels.map((x) => `「${x.trim()}」`).join('、')}（要写出横线处的意思，如"担心（+ 不定式）"，让答案唯一）`);
  }
  return errs;
}

/** 一道产出题（主题或备用题）的校验：法语题面或中文意图至少一个，题面要用 {{…}} 标出要换掉的说法，且不能直接给出答案；
 *  传了 lemma 时，词条的实词不能留在高亮外面（否则考的是旁边的词：{{écopé d'}}une amende 考的是 écoper，不是 amende） */
export function promptErrors(promptFr: string | null, intentZh: string | null, answerFr: string | null, lemma?: string | null): string[] {
  const p = promptFr?.trim() ?? '';
  if (!answerFr?.trim() || (!p && !intentZh?.trim())) return ['产出卡需要"法语题面"（或"中文意图"）和"法语答案"'];
  if (!p) return [];
  if (!hasCloze(p)) return ['法语题面要用 {{…}} 标出要换掉的说法'];
  const answer = hasCloze(answerFr) ? clozeTargets(answerFr).join(' ') : answerFr;
  const leak = hintLeaks(answer, clozeTargets(p).join(' '), true);
  const errs = leak.length ? [`法语题面的高亮部分直接给出了答案：${leak.join('、')}（换一个说法）`] : [];
  const out = lemma ? lemmaOutside(p, answer, lemma) : [];
  if (out.length) errs.push(`题面高亮外面直接露出了词条的词：${out.join('、')}（这样考的是别的词；高亮要把它包进去，题面换说法时也换掉它）`);
  return errs;
}

/** 词条的实词：出现在题面高亮外、又不在答案高亮里 → 产出题没考到词条 */
export function lemmaOutside(promptFr: string, answerTarget: string, lemma: string): string[] {
  const lw = words(lemma).filter((w) => !FUNC.has(w) && w.length > 1);
  const outside = words(promptFr.replace(/\{\{.+?\}\}/g, ' '));
  const target = words(answerTarget);
  return [...new Set(lw.filter((w) => outside.some((o) => sameStem(w, o)) && !target.some((t) => sameStem(w, t))))];
}

/** 一条笔记所有产出题（主题 + 备用题）的问题；词库"题面有误"筛选用 */
export function productionErrors(n: Pick<Note, 'lemma' | 'cardTypes' | 'intentZh' | 'answerFr'> & Partial<Pick<Note, 'promptFr' | 'altIntents'>>): string[] {
  if (!n.cardTypes.includes('production')) return [];
  return [
    ...promptErrors(n.promptFr ?? null, n.intentZh, n.answerFr, n.lemma),
    ...(n.altIntents ?? []).flatMap((x, i) => promptErrors(x.promptFr ?? null, x.intentZh ?? null, x.answerFr, n.lemma).map((e) => `备用产出题第 ${i + 1} 行：${e}`)),
  ];
}
