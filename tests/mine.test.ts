import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDict, parseVerbs } from '../src/lib/gender/dict';
import { annotate, buildIndex } from '../src/lib/reading';
import { mineLine, splitSentences, unknownWords } from '../src/features/add/MineText';

const dict = parseDict(readFileSync(new URL('../src/lib/gender/fr-dict.txt', import.meta.url), 'utf8'));
const verbs = parseVerbs(readFileSync(new URL('../src/lib/gender/fr-verbs.txt', import.meta.url), 'utf8'));

describe('短文挖词', () => {
  it('切句：句末标点、换行；引号跟着句子', () => {
    expect(splitSentences('Il pleut. Elle dit « non ! »\nEt après ?')).toEqual(['Il pleut.', 'Elle dit « non ! »', 'Et après ?']);
  });
  it('生词按原形去重，记第一次的词形、句子和次数；格式 词(原句', () => {
    const idx = buildIndex(dict, verbs, [], [], new Set(), 2000);
    const text = "L'interdisciplinarité séduit. Les chercheurs vantent l'interdisciplinarité depuis longtemps.";
    const sents = splitSentences(text).map((t) => ({ text: t, toks: annotate(t, idx, dict) }));
    const u = unknownWords(sents);
    const inter = u.find((x) => x.key === 'interdisciplinarité')!;
    expect(inter).toMatchObject({ form: 'interdisciplinarité', sentence: "L'interdisciplinarité séduit.", count: 2 });
    expect(u.some((x) => ['le', 'depuis', 'long'].includes(x.key))).toBe(false); // 虚词、常用词不算
    expect(mineLine(inter)).toBe("interdisciplinarité(L'interdisciplinarité séduit.");
  });
});
