// 产出卡法语题面、挖空多处、提示泄露检查
import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cardView, pickIntent } from '../src/features/CardFace';
import { altIntentLine, parseAltIntent } from '../src/features/NoteEditor';
import { SettingsSchema } from '../src/schema';
import { NoteV2 } from '../src/schema/v2';
import { clozeTarget, hintLeaks, labelOnlyHint, noteErrors, promptErrors } from '../src/schema/validate';
import { toIso } from '../src/lib/time';

const S = SettingsSchema.parse({ updatedAt: toIso(0) });
const L: [string, string, string] = ['Français', '中文', 'English'];
const html = (x: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, x));
const note = (over = {}) => NoteV2.parse({ id: 'n', updatedAt: toIso(0), deckId: 'd', createdAt: toIso(0), sentence: 'x {{y}}', cardTypes: ['production'], ...over });

describe('产出卡：法语题面', () => {
  const n = note({
    promptFr: 'On m’a refusé l’entrée {{en donnant comme raison que}} mon trépied gênait.',
    answerFr: 'On m’a refusé l’entrée {{au motif que}} mon trépied gênait.',
    intentZh: '以……为理由', hint: 'a… m… q…',
  });
  it('正面是法语题面，高亮要换掉的说法；背面高亮答案，中文作注释', () => {
    const v = cardView('production', n, S, 0, L);
    expect(v.question.label).toBe('法语题面');
    expect(v.question.lang).toBe(S.sourceLang);
    expect(html(v.question.text)).toContain('<b class="cloze">en donnant comme raison que</b>');
    expect(html(v.answers[0].text)).toContain('<b class="cloze">au motif que</b>');
    expect(v.answers[0].speakText).toBe('On m’a refusé l’entrée au motif que mon trépied gênait.');
    expect(v.answers[1].text).toBe('以……为理由');
    expect(v.hint).toBe('a… m… q…');
  });
  it('没有法语题面：正面退回中文意图，中文里也可以高亮', () => {
    const v = cardView('production', note({ intentZh: '要{{考虑}}居民的意见', answerFr: 'tenir compte de' }), S, 0, L);
    expect(v.question.label).toBe('中文意图');
    expect(html(v.question.text)).toContain('<b class="cloze">考虑</b>');
    expect(v.question.speakText).toBe('要考虑居民的意见');
    expect(v.answers).toHaveLength(1);
  });
  it('备用题轮换，新旧格式都能读写', () => {
    const alt = parseAltIntent('Je viendrai {{seulement si}} tu cuisines. | Je viendrai {{à condition que}} tu cuisines. | à c… q… | 前提是');
    expect(alt).toEqual({ promptFr: 'Je viendrai {{seulement si}} tu cuisines.', answerFr: 'Je viendrai {{à condition que}} tu cuisines.', hint: 'à c… q…', intentZh: '前提是' });
    expect(parseAltIntent(altIntentLine(alt))).toEqual(alt);
    const old = parseAltIntent('失去方向 | perdre ses repères');
    expect(old).toEqual({ promptFr: null, intentZh: '失去方向', answerFr: 'perdre ses repères', hint: null });
    expect(altIntentLine(old)).toBe('失去方向 | perdre ses repères');
    const m = note({ promptFr: 'a {{b}}', answerFr: 'a {{c}}', altIntents: [alt] });
    expect(pickIntent(m, 1).promptFr).toBe(alt.promptFr);
    expect(pickIntent(m, 2).promptFr).toBe('a {{b}}');
  });
  it('校验：题面要有 {{…}}，高亮部分不能用答案的同根词', () => {
    expect(promptErrors('sans marque', null, 'au motif que')).toEqual(['法语题面要用 {{…}} 标出要换掉的说法']);
    expect(promptErrors('pour le {{motif}} suivant', null, '{{au motif que}}')[0]).toContain('motif');
    expect(promptErrors('refusé {{en donnant comme raison que}}', '以……为理由', 'refusé {{au motif que}}')).toEqual([]);
    expect(promptErrors(null, '以……为理由', 'au motif que')).toEqual([]);
    expect(noteErrors({ lemma: '', sentence: 'x {{y}}', cardTypes: ['production'], intentZh: null, answerFr: 'a', promptFr: 'b {{c}}' })).toEqual([]);
  });
});

describe('挖空：多处、提示不泄露答案', () => {
  const view = (sentence: string, clozeHint: string | null = null) => html(cardView('cloze', note({ sentence, clozeHint, cardTypes: ['cloze'] }), S, 0, L).question.text);
  it('分开的表达挖两处，提示只在第一处', () => {
    const h = view("Essaie d'{{avoir}} ces trois idées {{en tête}}.", '记在脑子里');
    expect(h.match(/\[记在脑子里\]/g)).toHaveLength(1);
    expect(h).toContain('ces trois idées');
    expect(h).toContain('<span class="nowrap"><span class="blank">___</span>.</span>');
    expect(clozeTarget("Essaie d'{{avoir}} ces trois idées {{en tête}}.")).toBe('avoir … en tête');
  });
  it('收集到的三个问题都会被拦下', () => {
    const errs = (sentence: string, clozeHint: string) => noteErrors({ lemma: '', sentence, cardTypes: ['cloze'], intentZh: null, answerFr: null, clozeHint });
    expect(errs('Ce nouveau poste va {{amener beaucoup de changements}} dans ma routine.', 'amener des changements · beaucoup de')[0]).toContain('挖空提示里出现了答案');
    expect(errs("Essaie d'{{avoir}} ces trois idées {{en tête}}.", 'avoir … en tête · 三个想法')[0]).toContain('tete');
    expect(errs('Il ne se rend pas compte {{de}} la chance qu’il a.', 'se rendre compte de · 现在时')[0]).toContain('de');
    // 正确写法：挖整个表达，提示只给意思和时态
    expect(errs('Il ne {{se rend}} pas {{compte de}} la chance qu’il a.', '意识到（现在时）')).toEqual([]);
  });
  it('提示给原形也算泄露：写意思 + 时态', () => {
    expect(hintLeaks('dégringolé', 'dégringoler · 复合过去时', true)).toEqual(['degringole']);
    expect(noteErrors({ lemma: '', sentence: 'Les prix ont {{dégringolé::dégringoler · 复合过去时}}.', cardTypes: ['cloze'], intentZh: null, answerFr: null }).join()).toContain('出现了答案');
    expect(noteErrors({ lemma: '', sentence: 'Les prix ont {{dégringolé::暴跌（复合过去时）}}.', cardTypes: ['cloze'], intentZh: null, answerFr: null })).toEqual([]);
  });
  it('备用例句的内联提示也查泄露', () => {
    expect(noteErrors({ lemma: '', sentence: 'Les prix ont {{dégringolé}}.', clozeHint: '暴跌（复合过去时）', cardTypes: ['cloze'], intentZh: null, answerFr: null, altSentences: ['Il ne se rend pas compte {{de::se rendre compte de · 现在时}} la chance.'] }).join()).toContain('备用例句第 1 句');
  });
});

describe('挖空提示不能只是语法标签', () => {
  it('识别纯标签', () => {
    expect(labelOnlyHint('介词')).toBe(true);
    expect(labelOnlyHint('动词（复合过去时）')).toBe(true);
    expect(labelOnlyHint('关系代词，阴性复数')).toBe(true);
    expect(labelOnlyHint('担心（+ 不定式）')).toBe(false);
    expect(labelOnlyHint('飞越（复合过去时）')).toBe(false);
    expect(labelOnlyHint('dégringoler · 复合过去时')).toBe(false);
    expect(labelOnlyHint('')).toBe(false);
  });
  const base = { lemma: 'craindre de', cardTypes: ['cloze' as const], intentZh: null, answerFr: null };
  it('笔记提示、主句内联提示、备用例句内联提示都检查', () => {
    expect(noteErrors({ ...base, sentence: 'Je craignais {{de}} rater le métro.', clozeHint: '介词' }).join()).toContain('语法标签');
    expect(noteErrors({ ...base, sentence: 'Je craignais {{de::介词}} rater le métro.' }).join()).toContain('语法标签');
    expect(noteErrors({ ...base, sentence: 'Je {{craignais de}} rater le métro.', clozeHint: '担心（+ 不定式）', altSentences: ['Tu {{craignais de::动词}} partir.'] }).join()).toContain('语法标签');
    expect(noteErrors({ ...base, sentence: 'Je {{craignais de}} rater le métro.', clozeHint: '担心（未完成过去时，后接不定式）' })).toEqual([]);
  });
});
