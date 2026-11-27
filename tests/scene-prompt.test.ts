import { describe, expect, it } from 'vitest';
import { isScenePrompt } from '../src/features/CardFace';
import { promptPlain } from '../src/features/BackZones';
import { promptErrors } from '../src/schema/validate';
import { parseNote, type Note } from '../src/schema';

const T = '2026-11-24T00:00:00.000Z';
describe('情境题面', () => {
  const n: Note = parseNote({ id: 'g', deckId: 'd', createdAt: T, updatedAt: T, lemma: "la goutte d'eau qui fait déborder le vase", meaningZh: '最后一根稻草', cardTypes: ['production'],
    promptFr: 'Trois retards, et maintenant il oublie notre réunion : c\'est {{…}} !', answerFr: "Trois retards, et maintenant il oublie notre réunion : c'est {{la goutte d'eau qui fait déborder le vase}} !", intentZh: '压垮骆驼的最后一根稻草' });
  it('高亮只有 … 的题面是情境题：中文意图直接显示，不当提示、不列题面说法', () => {
    expect(isScenePrompt(n.promptFr)).toBe(true);
    expect(isScenePrompt('Il {{était très en colère}}.')).toBe(false);
    expect(promptPlain(n)).toBeNull();
  });
  it("校验放行", () => { expect(promptErrors(n.promptFr ?? null, n.intentZh ?? null, n.answerFr ?? null, n.lemma)).toEqual([]); });
});
