// 笔记表单的数据：一个「表达」+ 一张例句表。例句表里不写换说法的句子给认读 / 挖空 / 辨析（每次复习轮换），
// 写了换说法的句子是一道产出题（题面 = 把标出的部分换成换说法）。存进数据库时换回原来的字段（sentence、altSentences、
// promptFr / answerFr / altIntents…），卡片、导入、同步都不用改。
import type { Card, Note, Theme } from '../../schema';
import { clozeTargets, hasCloze } from '../../schema/validate';

export interface Row {
  key: string;
  /** ex = 认读 / 挖空 / 辨析用的例句；prod = 产出题（这句是答案） */
  kind: 'ex' | 'prod';
  /** 带 {{…}} 的句子（不含 ::提示） */
  text: string;
  /** 手动点过词：改「表达」时不自动重标 */
  manual: boolean;
  /** ex：这句的挖空提示（第一句存在 clozeHint，其他句存成 {{答案::提示}}） */
  hint: string;
  /** prod：换说法（题面里替换标出部分的简单说法） */
  para: string;
  /** prod：整句手写的题面（表达分成几段、或换说法替换不了时用）；null = 用换说法自动生成 */
  prompt: string | null;
  /** prod：中文注释（背面；也是复习时的第一级提示） */
  zh: string;
  /** prod：老式中文题（没有法语题面）的首字母提示 */
  legacyHint: string;
}

export interface Draft {
  lemma: string; meaningZh: string; meaningEn: string;
  cueFamily: string; source: string; extra: string; etymology: string; contrastNote: string;
  layer: Note['layer']; origin: NonNullable<Note['origin']>; cardTypes: Card['type'][]; tags: Theme[]; deckId: string; day: string;
  rows: Row[];
}

let seq = 0;
export const rowKey = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;
export const newRow = (kind: Row['kind'], text = ''): Row => ({ key: rowKey(), kind, text, manual: false, hint: '', para: '', prompt: null, zh: '', legacyHint: '' });

const outside = (s: string) => s.replace(/\{\{.*?\}\}/g, '{}').trim();
const spans = (s: string) => [...s.matchAll(/\{\{(.*?)\}\}/g)].length;

/** {{答案::提示}} → 去掉提示的句子 + 第一个提示 */
export function splitInlineHint(s: string): { text: string; hint: string } {
  let hint = '';
  const text = s.replace(/\{\{(.*?)\}\}/g, (_, x: string) => {
    const [a, h] = x.split('::');
    if (h && !hint) hint = h.trim();
    return `{{${a}}}`;
  });
  return { text, hint };
}
/** 把提示放回第一个 {{…}} */
export const withInlineHint = (s: string, hint: string) => (hint.trim() ? s.replace(/\{\{(.*?)\}\}/, (_, x: string) => `{{${x}::${hint.trim()}}}`) : s);

/** 产出题：题面和答案高亮外一样、各只有一处高亮时，题面的高亮就是「换说法」；否则题面整句手写 */
function prodRow(p: { promptFr?: string | null; answerFr?: string | null; intentZh?: string | null; hint?: string | null }): Row {
  const r = newRow('prod', p.answerFr?.trim() ?? '');
  r.zh = p.intentZh?.trim() ?? '';
  const pf = p.promptFr?.trim() ?? '';
  if (!pf) { r.legacyHint = p.hint?.trim() ?? ''; return r; }
  if (hasCloze(pf) && hasCloze(r.text) && spans(pf) === 1 && spans(r.text) === 1 && outside(pf) === outside(r.text)) r.para = clozeTargets(pf)[0];
  else r.prompt = pf;
  return r;
}
const intentKey = (x: { promptFr?: string | null; answerFr?: string | null; intentZh?: string | null }) =>
  `${x.promptFr?.trim() ?? ''}|${x.promptFr?.trim() ? '' : x.intentZh?.trim() ?? ''}|${x.answerFr?.trim() ?? ''}`;

export function fromNote(note: Note, origin: NonNullable<Note['origin']>): Draft {
  const rows: Row[] = [];
  const addEx = (s: string | null | undefined, hint = '') => {
    if (!s?.trim()) return;
    const sp = splitInlineHint(s.trim());
    if (rows.some((r) => r.kind === 'ex' && r.text === sp.text)) return;
    rows.push({ ...newRow('ex', sp.text), hint: sp.hint || hint });
  };
  // 老笔记的挖空提示属于挖空例句（有的话）或主句
  const cs = note.clozeSentence?.trim() && hasCloze(note.clozeSentence) ? note.clozeSentence : null;
  addEx(note.sentence, cs ? '' : note.clozeHint ?? '');
  addEx(cs, note.clozeHint ?? '');
  for (const a of note.altSentences ?? []) addEx(a);
  // 产出题：主题 + 备用题，一模一样的只留一道
  const seen = new Set<string>();
  for (const p of [{ promptFr: note.promptFr, answerFr: note.answerFr, intentZh: note.intentZh, hint: note.hint }, ...(note.altIntents ?? [])]) {
    if (!p.answerFr?.trim() && !p.promptFr?.trim() && !p.intentZh?.trim()) continue;
    const k = intentKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(prodRow(p));
  }
  return {
    lemma: note.lemma, meaningZh: note.meaningZh, meaningEn: note.meaningEn,
    cueFamily: note.cueFamily ?? '', source: note.source ?? '', extra: note.extra ?? '', etymology: note.etymology ?? '', contrastNote: note.contrastNote ?? '',
    layer: note.layer, origin, cardTypes: note.cardTypes, tags: note.tags, deckId: note.deckId, day: note.createdAt.slice(0, 10),
    rows,
  };
}

/** 产出题的题面：手写的，或者把答案里唯一的一处高亮换成换说法 */
export function promptOf(r: Row): string | null {
  if (r.prompt != null) return r.prompt.trim() || null;
  if (!r.para.trim() || spans(r.text) !== 1) return null;
  return r.text.replace(/\{\{.*?\}\}/, `{{${r.para.trim()}}}`);
}

const nul = (x: string) => (x.trim() ? x.trim() : null);

/** 表单 → 笔记里和例句、题目有关的字段 */
export function rowFields(d: Pick<Draft, 'rows'>): Pick<Note, 'sentence' | 'altSentences' | 'clozeSentence' | 'clozeHint' | 'promptFr' | 'answerFr' | 'intentZh' | 'hint' | 'altIntents'> {
  const ex = d.rows.filter((r) => r.kind === 'ex' && r.text.trim());
  const prod = d.rows.filter((r) => r.kind === 'prod' && (r.text.trim() || r.para.trim() || r.prompt?.trim() || r.zh.trim()));
  const intents = prod.map((r) => {
    const promptFr = promptOf(r);
    return { promptFr, answerFr: r.text.trim(), intentZh: nul(r.zh), hint: promptFr ? null : nul(r.legacyHint) };
  });
  const [main, ...alts] = intents;
  return {
    sentence: ex[0]?.text.trim() ?? '',
    clozeHint: nul(ex[0]?.hint ?? ''),
    altSentences: ex.slice(1).map((r) => withInlineHint(r.text.trim(), r.hint)),
    clozeSentence: null,
    promptFr: main?.promptFr ?? null, answerFr: main ? nul(main.answerFr) : null, intentZh: main?.intentZh ?? null, hint: main?.hint ?? null,
    altIntents: alts.map((x) => ({ promptFr: x.promptFr, answerFr: x.answerFr, intentZh: x.intentZh ?? '', hint: x.hint })),
  };
}

export const otherFields = (d: Draft) => ({
  lemma: d.lemma.trim(), meaningZh: d.meaningZh.trim(), meaningEn: d.meaningEn.trim(),
  cueFamily: nul(d.cueFamily), source: nul(d.source), extra: nul(d.extra), etymology: nul(d.etymology), contrastNote: nul(d.contrastNote),
  layer: d.layer, tags: d.tags,
});
