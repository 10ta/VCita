import { describe, expect, it } from 'vitest';
import { backZones, plainPair } from '../src/features/BackZones';
import { contentGaps } from '../src/schema/validate';
import { isConcept } from '../src/lib/concepts';
import { diffWords, summarize } from '../src/lib/diff';
import { parseNote, type Note } from '../src/schema';

const T = '2026-11-23T00:00:00.000Z';
const note = (over: Partial<Note>): Note => parseNote({ id: 'x', deckId: 'd', createdAt: T, updatedAt: T, lemma: 'x', ...over });

describe('朴素说法', () => {
  const n = note({ lemma: 'être hors de soi', promptFr: 'Il {{était très en colère}}.', answerFr: 'Il {{était hors de lui}}.', promptKind: '下位' });
  it('题面高亮 → 答案高亮，标出下位 / 平替；产出卡背面不重复列', () => {
    expect(plainPair(n)).toEqual({ fr: 'était très en colère → était hors de lui', zh: '朴素说法 · 下位' });
    expect(backZones(n).use.at(-1)?.zh).toBe('朴素说法 · 下位');
    expect(backZones(n, false).use).toEqual([]);
  });
});

describe('内容缺项', () => {
  it('只有词源、带介词缺用法、中文意思不是中文开头、没有概念', () => {
    const bare = note({ lemma: 'être indigné(e) par qqch', meaningZh: 'indigné 愤慨', etymology: 'x' });
    expect(contentGaps(bare, isConcept)).toEqual(['thin', 'usage', 'zh', 'concept']);
    const ok = note({ lemma: 'le constat', meaningZh: '观察结论', extra: '高频：dresser un constat', topics: ['判断认为'] });
    expect(contentGaps(ok, isConcept)).toEqual([]);
  });
  it('产出题面的换说法超过 5 个词', () => {
    const long = note({ meaningZh: '意思', usage: 'u', topics: ['愤怒'], cardTypes: ['production'], promptFr: 'Il {{a vraiment perdu tout son calme ce jour-là}}.', answerFr: 'Il {{a explosé}}.' });
    expect(contentGaps(long, isConcept)).toEqual(['prompt']);
  });
});

describe('小词', () => {
  it('介词、代词写错单独数出来', () => {
    const sum = summarize(diffWords('réputé de sa cuisine', 'réputé pour sa cuisine'));
    expect(sum.small).toBe(1);
    expect(sum.smallPairs).toEqual(['de → pour']);
    expect(summarize(diffWords("j'étais hors de toi", "j'étais hors de moi")).small).toBe(1);
  });
});
