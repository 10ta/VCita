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
/**
 * 挖空卡没写提示时自动用的提示：中文意思，但去掉带法语的部分（「甚至……这件事本身（même le fait d'avoir + p.p.）」
 * 括号里就是答案，原来整条都不给，横线处就没有提示了）。只挖虚词、或去掉后还露出答案时不给
 */
export function autoClozeHint(meaningZh: string | null | undefined, sentence: string): string | null {
  if (blankIsFunctionWords(sentence)) return null;
  const segs = (meaningZh ?? '').split(/[；;]/)
    .map((x) => x.replace(/\s*[(（][^)）]*[A-Za-zÀ-ÿœæ][^)）]*[)）]/g, '').trim())
    .filter((x) => x && !/[A-Za-zÀ-ÿœæ]{2,}/.test(x));
  const zh = segs.join('；');
  if (!zh) return null;
  return hintLeaks(clozeTargets(sentence).join(' '), zh, true).length ? null : zh;
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

type Fields = Pick<Note, 'lemma' | 'sentence' | 'cardTypes' | 'intentZh' | 'answerFr'> & Partial<Pick<Note, 'clozeSentence' | 'clozeHint' | 'promptFr' | 'altSentences' | 'frame'>>;

export function noteErrors(n: Fields): string[] {
  const errs: string[] = [];
  // 句框：例句是填好的整句（不用 {{…}}），只要求有句框
  if (n.frame) {
    if (!n.cardTypes.length) errs.push('至少选一种卡');
    if (!n.lemma.trim()) errs.push('句框不能为空');
    return errs;
  }
  const cloze = hasCloze(n.sentence);
  if (!n.cardTypes.length) errs.push('至少选一种卡');
  if (n.sentence.trim() && !cloze) errs.push('例句里要用 {{…}} 标出考查的部分');
  const cs = n.clozeSentence?.trim() ?? '';
  if (cs && !hasCloze(cs)) errs.push('挖空例句里要用 {{…}} 标出挖掉的部分');
  if (n.cardTypes.includes('cloze') && !cloze && !cs) errs.push('挖空卡需要带 {{…}} 的例句');
  // 迁移来的旧卡没有例句，允许只有单词
  if (n.cardTypes.includes('recognition') && !cloze && !n.lemma.trim()) errs.push('认读卡需要例句或单词');
  if (n.cardTypes.includes('production')) errs.push(...promptErrors(n.promptFr ?? null, n.intentZh, n.answerFr, n.lemma));
  if (n.cardTypes.includes('contrast') && !cloze) errs.push('在易混组里的笔记需要带 {{…}} 的例句（辨析卡挖掉考查部分）');
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
  // 挖空 / 辨析：空里的词在句子别处又出现了，等于把答案写在题面上
  if (n.cardTypes.includes('cloze') || n.cardTypes.includes('contrast')) {
    [n.sentence, cs, ...(n.altSentences ?? [])].forEach((x, i) => {
      const e = x && hasCloze(x) ? blankEchoes(x) : [];
      if (e.length) errs.push(`${i === 0 ? '例句' : i === 1 ? '挖空例句' : `备用例句第 ${i - 1} 句`}：要填的 ${e.join('、')} 在句子别处又出现了，等于给出答案（换个说法或换句子）`);
    });
  }
  return errs;
}

const stripAcc = (w: string) => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** 空里的实词（4 个字母以上）在空外面又出现了（同词或同词根：vanter ~ vantent）。返回这些词 */
export function blankEchoes(sentence: string): string[] {
  const inside = clozeTargets(sentence).join(' ');
  const outside = sentence.replace(/\{\{.*?\}\}/g, ' ');
  const words = (t: string) => (stripAcc(t).match(/[a-z\u00e6\u0153]{4,}/g) ?? []).filter((w) => !FUNC.has(w));
  const out = words(outside);
  const same = (a: string, b: string) => {
    let k = 0;
    while (k < a.length && k < b.length && a[k] === b[k]) k++;
    return a === b || k >= Math.max(5, Math.min(a.length, b.length) - 1);
  };
  return [...new Set(words(inside).filter((w) => out.some((o) => same(w, o))))];
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

// ---- 考查部分要是词条本身 ----
// 一条笔记只考它的词条：例句里 {{…}} 标的就是词条在句中的样子。错误笔记里顺带记下的别的错（certains 前不加冠词、
// dire qch de qqn 的 de）不能拿来当某个例句的考查部分，否则认读卡高亮的是别的词，挖空卡的提示（词条的意思）也对不上
const ALIAS: Record<string, string> = { au: 'a', aux: 'a', du: 'de', des: 'de', d: 'de', l: 'le', la: 'le', les: 'le', s: 'se', m: 'me', t: 'te', n: 'ne', c: 'ce', j: 'je', qu: 'que' };
const OBJ = new Set('me m te t se s le la les l lui leur nous vous y en'.split(' '));
const norm = (w: string) => ALIAS[w] ?? w;
const verbStem = (w: string) => (w.length >= 4 ? w.replace(/(oir|er|ir|re)$/, '') : w);
const near = (a: string, b: string) => norm(a) === norm(b) || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4))
  || (b.length >= 4 && verbStem(b).length >= 2 && verbStem(b) !== b && a.startsWith(verbStem(b)));
/** 词条的第一种写法（不含括号里的说明、分号 / 斜杠后的其他写法） */
const firstForm = (lemma: string) => lemma.replace(/\(.*?\)|（.*?）/g, ' ').split(/[;；｜|/,=]|\svs\.?\s/)[0];

/** 例句的考查部分里一个词条的词都没有（标的是别的词）。词条带 qqn / qqch / 不定式 / 从句时，标宾语代词、从句动词也算考词条 */
export function markOffLemma(sentence: string, lemma: string): boolean {
  if (!hasCloze(sentence) || !lemma.trim()) return false;
  const marked = words(clozeTargets(sentence).join(' '));
  if (!marked.length) return false;
  const lw = words(lemma);
  if (marked.some((m) => lw.some((w) => near(m, w)))) return false;
  if (/\b(qqn|qqch|qch)\b/i.test(lemma) && marked.every((m) => OBJ.has(m))) return false;
  if (/subj|ind\.|indicatif|\bque\b|\binf\b/i.test(lemma)) return false;
  return true;
}

/** 主例句：词条的实词出现在考查部分外面，却没标进去（如 se rendre compte de 只标了 de） */
export function lemmaOutsideMark(sentence: string, lemma: string): string[] {
  if (!hasCloze(sentence)) return [];
  return lemmaOutside(sentence, clozeTargets(sentence).join(' '), firstForm(lemma)).filter((w) => w.length >= 4);
}

/** 一条笔记例句标注的问题；词库"题面有误"筛选用，也在编辑笔记里提示（不拦保存） */
export function markErrors(n: Pick<Note, 'lemma' | 'sentence'> & Partial<Pick<Note, 'clozeSentence' | 'altSentences' | 'frame'>>): string[] {
  if (n.frame) return [];
  const errs: string[] = [];
  const out = lemmaOutsideMark(n.sentence, n.lemma);
  if (out.length) errs.push(`例句里词条的 ${out.join('、')} 在考查部分外面：{{…}} 要把整个表达标进去（认读卡高亮的就是它）`);
  const all: Array<[string, string]> = [['例句', n.sentence], ['挖空例句', n.clozeSentence ?? ''], ...(n.altSentences ?? []).map((x, i) => [`备用例句第 ${i + 1} 句`, x] as [string, string])];
  for (const [label, x] of all) if (x && markOffLemma(x, n.lemma)) errs.push(`${label}标的「${clozeTarget(x)}」不是词条：一条笔记只考词条，别的易错点写进补充或单独做一条`);
  return errs;
}

/** 一条笔记所有产出题（主题 + 备用题）的问题；词库"题面有误"筛选用 */
export function productionErrors(n: Pick<Note, 'lemma' | 'cardTypes' | 'intentZh' | 'answerFr'> & Partial<Pick<Note, 'promptFr' | 'altIntents'>>): string[] {
  if (!n.cardTypes.includes('production')) return [];
  return [
    ...promptErrors(n.promptFr ?? null, n.intentZh, n.answerFr, n.lemma),
    ...(n.altIntents ?? []).flatMap((x, i) => promptErrors(x.promptFr ?? null, x.intentZh ?? null, x.answerFr, n.lemma).map((e) => `备用产出题第 ${i + 1} 行：${e}`)),
  ];
}

// ---- 辨析卡：空外面不能露出能排除其他组员的线索 ----
// 辨析卡正面挖掉考查部分、列出组里几个词让人选。组员有的是代动词（s'attacher à）有的不是（tenir à）时，
// 空前面的 me suis / se 直接告诉你答案是代动词；组员阴阳性不同（la journée / le jour）时，空前面的 la / une / cette 直接给出答案；
// 组员带的介词不同（servir à / se servir de）时，空后面紧跟的 à / de 也是线索。这些词要挖进空里，或者换个句子
type ContrastNote = Pick<Note, 'lemma' | 'sentence'> & Partial<Pick<Note, 'altSentences'>>;
/** 辨析卡正面选项上显示的词条：去掉括号里的例子 / 说明，只留第一种写法（「le sens de (l'humour, du devoir)」→「le sens de」），免得例子正好是句子里的词 */
export const choiceLabel = (lemma: string) => lemma.replace(/\s*[(（][^)）]*[)）]/g, '').split(/\s[;；｜|]\s?|；/)[0].replace(/\s+/g, ' ').trim() || lemma.trim();
const lemmaCore = (lemma: string) => lemma.replace(/\(.*?\)|（.*?）/g, ' ').split(/[;,/｜|]/)[0].replace(/\b(qqch|qqn|qch|inf)\b\.?/gi, ' ').replace(/\s+/g, ' ').trim();
const isPronominal = (lemma: string) => /^(se\s|s['’])/i.test(lemmaCore(lemma));
const hasEn = (lemma: string) => /^(s['’]en|en)\s/i.test(lemmaCore(lemma));
function lemmaGender(lemma: string): 'm' | 'f' | null {
  const l = lemma.trim().toLowerCase();
  if (/^(le|un)\s/.test(l)) return 'm';
  if (/^(la|une)\s/.test(l)) return 'f';
  if (/^l['’]/.test(l)) return /\(m\.?\)/.test(l) ? 'm' : /\(f\.?\)/.test(l) ? 'f' : null;
  return null;
}
const PREPS = ['à', 'de', 'sur', 'pour', 'avec', 'contre', 'dans', 'par', 'en', 'vers', 'envers'];
function lemmaPrep(lemma: string): string {
  const last = lemmaCore(lemma).split(' ').pop()?.toLowerCase() ?? '';
  return PREPS.includes(last) ? last : '';
}
const ETRE = 'suis|es|est|sommes|êtes|sont|étais|était|étions|étiez|étaient|serai|seras|sera|serons|serez|seront|serais|serait|serions|seriez|seraient|sois|soit|soyons|soyez|soient|être|étant';
const REFL_BEFORE = new RegExp(`(?:^|[\\s«"(])(?:me|te|se|m['’]|t['’]|s['’]|nous nous|vous vous)\\s*(?:(?:en|y)\\s+)?(?:(?:ne|n['’])\\s*)?(?:(?:${ETRE})\\s*)?(?:(?:pas|plus|jamais)\\s*)?$`, 'i');
const EN_BEFORE = /(?:^|[\s'’])en\s*(?:(?:suis|es|est|sommes|êtes|sont|ai|as|a|avons|avez|ont)\s*)?$/i;
const FEM_DET = /(?:^|\s)(?:la|une|cette|ma|ta|sa|quelle|toute|aucune)\s+(?:\S+\s+)?$/i;
const MASC_DET = /(?:^|\s)(?:le|un|ce|cet|du|au|quel|tout|aucun)\s+(?:\S+\s+)?$/i;
/** 辨析卡例句的空外面有没有露出能排除其他组员的线索；返回问题描述（空数组 = 没问题） */
export function contrastLeaks(note: ContrastNote, mates: Array<Pick<Note, 'lemma'>>): string[] {
  if (!mates.length) return [];
  const all = [note, ...mates];
  const mixedRefl = new Set(all.map((n) => isPronominal(n.lemma))).size > 1;
  const mixedEn = new Set(all.map((n) => hasEn(n.lemma))).size > 1;
  const genders = all.map((n) => lemmaGender(n.lemma));
  const mixedGender = genders.every(Boolean) && new Set(genders).size > 1;
  const preps = new Set(all.map((n) => lemmaPrep(n.lemma)));
  const out: string[] = [];
  // 选项上的词出现在空外面：只有这条笔记的选项有，等于直接指出答案
  const wordsOf = (s: string) => new Set((s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}]{3,}/gu) ?? []).filter((w) => !FUNC.has(w)));
  const mine = wordsOf(choiceLabel(note.lemma));
  const others = mates.map((m) => wordsOf(choiceLabel(m.lemma)));
  const sentences = [note.sentence, ...(note.altSentences ?? [])].filter((s) => s && hasCloze(s));
  sentences.forEach((s, i) => {
    const where = i === 0 ? '例句' : `备用例句 ${i}`;
    const at = s.indexOf('{{');
    const before = s.slice(0, at).replace(/\s+$/, ' ');
    const after = s.slice(s.indexOf('}}', at) + 2).trimStart().toLowerCase();
    const outsideWords = wordsOf(before + ' ' + s.slice(s.indexOf('}}', at) + 2).replace(/\{\{.*?\}\}/g, ' '));
    const giveaway = [...mine].filter((w) => outsideWords.has(w) && !others.every((o) => o.has(w)));
    if (giveaway.length) out.push(`${where}：空外面的 ${giveaway.join('、')} 也出现在这个词的选项上，等于指出答案，换个句子或改词条`);
    if (mixedRefl && REFL_BEFORE.test(before)) out.push(`${where}：空前面的代词（me / se / me suis…）露出了答案是代动词，把它挖进空里或换个句子`);
    else if (mixedEn && EN_BEFORE.test(before)) out.push(`${where}：空前面的 en 露出了答案，把它挖进空里或换个句子`);
    if (mixedGender && (FEM_DET.test(before) || MASC_DET.test(before))) out.push(`${where}：空前面的冠词 / 限定词露出了阴阳性，组里的词阴阳性不同，把它挖进空里或换个句子`);
    if (preps.size > 1) {
      const first = after.split(/[\s'’]/)[0];
      const p = first === 'au' || first === 'aux' ? 'à' : first === 'du' || first === 'des' || first === 'd' ? 'de' : first;
      if (preps.has(p)) out.push(`${where}：空后面紧跟的 ${first} 露出了答案带哪个介词，把介词挖进空里`);
    }
  });
  return out;
}
