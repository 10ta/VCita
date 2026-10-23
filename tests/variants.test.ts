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
