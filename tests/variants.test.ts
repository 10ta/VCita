import { describe, expect, it } from 'vitest';
import { cardView, pickIntent, pickSentence } from '../src/features/CardFace';
import { SettingsSchema } from '../src/schema';
import { NoteV2 } from '../src/schema/v2';
import { toIso } from '../src/lib/time';

const S = SettingsSchema.parse({ updatedAt: toIso(0) });
const L: [string, string, string] = ['Français', '中文', 'English'];
const note = (over = {}) => NoteV2.parse({
  id: 'n', updatedAt: toIso(0), deckId: 'd', createdAt: toIso(0), sentence: 'A {{x}}.', meaningZh: '义',
  cardTypes: ['recognition', 'cloze', 'production'], intentZh: '意图1', answerFr: 'R1', hint: 'h1', ...over,
});

describe('例句 / 产出场景轮换', () => {
  it('没有备用时始终是主句、主意图（旧数据不受影响）', () => {
    const n = note();
    expect([0, 1, 5].map((v) => pickSentence(n, 'recognition', v))).toEqual(['A {{x}}.', 'A {{x}}.', 'A {{x}}.']);
    expect(pickIntent(n, 3).intentZh).toBe('意图1');
  });
  it('按复习次数轮换；没标 {{…}} 的备用句被忽略；挖空优先用挖空例句', () => {
    const n = note({ altSentences: ['B {{x}}.', 'sans marque', 'C {{x}}.'], clozeSentence: 'Z {{x}}.' });
    expect([0, 1, 2, 3].map((v) => pickSentence(n, 'recognition', v))).toEqual(['A {{x}}.', 'B {{x}}.', 'C {{x}}.', 'A {{x}}.']);
    expect([0, 1].map((v) => pickSentence(n, 'cloze', v))).toEqual(['Z {{x}}.', 'B {{x}}.']);
  });
  it('产出卡：意图、答案、提示成套轮换', () => {
    const n = note({ altIntents: [{ intentZh: '意图2', answerFr: 'R2' }] });
    const v1 = cardView('production', n, S, 0, L, 1);
    expect([v1.question.text, v1.answers[0].text, v1.hint]).toEqual(['意图2', 'R2', null]);
    const v2 = cardView('production', n, S, 0, L, 2);
    expect([v2.question.text, v2.answers[0].text, v2.hint]).toEqual(['意图1', 'R1', 'h1']);
  });
});

describe('内联提示与听力认读', () => {
  it('{{答案::提示}}：认读只显示答案，挖空横线显示提示，朗读只读答案', async () => {
    const { plainSentence } = await import('../src/features/CardFace');
    const { clozeTarget } = await import('../src/schema/validate');
    expect(plainSentence('Les prix ont {{dégringolé::dégringoler · 复合过去时}}.')).toBe('Les prix ont dégringolé.');
    expect(clozeTarget('Les prix ont {{dégringolé::dégringoler}}.')).toBe('dégringolé');
    const n = note({ altSentences: ['Les prix ont {{dégringolé::dégringoler · 复合过去时}}.'] });
    const v = cardView('cloze', n, S, 0, L, 1);
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement, Fragment } = await import('react');
    const html = renderToStaticMarkup(createElement(Fragment, null, v.question.text));
    expect(/<span class="blank has-hint">([^<]*)<\/span>/.exec(html)?.[1]).toBe('[dégringoler · 复合过去时]');
    // 句末标点和横线粘在一起
    expect(html).toContain('<span class="nowrap"><span class="blank has-hint">[dégringoler · 复合过去时]</span>.</span>');
    expect(v.hint).toBeNull();
  });
  it('听力认读：题面没有文字，有朗读内容；答案是句子和两个翻译', () => {
    const v = cardView('recognition', note(), S, 1, L, 0, true);
    expect([v.listen, v.question.text, v.question.speakText, v.answers.length]).toEqual([true, '', 'A x.', 3]);
    expect(cardView('production', note(), S, 0, L, 0, true).listen).toBeUndefined();
  });
});
