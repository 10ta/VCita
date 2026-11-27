// 题面换说法、补充里的近义 / 朴素版：进「替代说法」，不再放在用法区
import { describe, expect, it } from 'vitest';
import { backZones, promptPlain } from '../src/features/BackZones';
import type { Note } from '../src/schema';

const note = (over: Partial<Note>) => ({ id: 'n', lemma: 'être hors de soi', sentence: 'Il {{était hors de lui}}.', extra: null, usage: null, etymology: null, contexts: [], cueFamily: null, source: null, ...over }) as unknown as Note;

describe('替代说法的笔记内来源', () => {
  it('题面换说法：类型取 promptKind', () => {
    const n = note({ promptFr: 'Il {{était très en colère}}.', answerFr: 'Il {{était hors de lui}}.', promptKind: '下位' });
    expect(promptPlain(n)).toBe('était très en colère');
    expect(backZones(n).alt).toEqual([{ fr: 'était très en colère', kind: '下位', source: '题面' }]);
    expect(backZones(n).use).toEqual([]);
  });
  it('场景题面没有换说法', () => {
    expect(promptPlain(note({ promptFr: "c'est {{…}} !" }))).toBeNull();
  });
  it('补充里的近义 / 同义 / 朴素版进替代说法', () => {
    const z = backZones(note({ extra: '近义：furieux 狂怒的；朴素版：très fâché\n高频：sortir de ses gonds：大发雷霆' }));
    expect(z.alt.map((a) => [a.fr, a.kind])).toEqual([['furieux', '近义'], ['très fâché', '下位']]);
    expect(z.use.map((e) => e.fr)).toEqual(['sortir de ses gonds']);
  });
});
