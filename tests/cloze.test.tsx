import { describe, expect, it } from 'vitest';
import { cardView, letterPattern } from '../src/features/CardFace';
import { SettingsSchema } from '../src/schema';
import { NoteV2 } from '../src/schema/v2';
import { toIso } from '../src/lib/time';

const S = SettingsSchema.parse({ updatedAt: toIso(0) });
const note = (over = {}) => NoteV2.parse({
  id: 'n', updatedAt: toIso(0), deckId: 'd', createdAt: toIso(0), sentence: "l'avion doit {{survoler}} la Sibérie",
  meaningZh: '飞越一个国家', cardTypes: ['cloze'], ...over,
});
const L: [string, string, string] = ['Français', '中文', 'English'];
const blankText = (v: ReturnType<typeof cardView>) =>
  (v.question.text as Array<string | { props: { children: string } }>).map((x) => (typeof x === 'string' ? '' : x.props.children)).join('');

describe('挖空提示', () => {
  it('首字母 + 字母数', () => {
    expect(letterPattern('survoler')).toBe('s _ _ _ _ _ _ _');
    expect(letterPattern('commis une')).toBe('c _ _ _ _ _   u _ _');
    expect(letterPattern("l'horreur")).toBe("l' _ _ _ _ _ _ _");
    expect(letterPattern('à')).toBe('à');
  });
  it('有挖空提示：横线处显示 [提示]，不再另给提示行', () => {
    const v = cardView('cloze', note({ clozeHint: '飞越' }), S, 0, L);
    expect(blankText(v)).toBe('[飞越]');
    expect(v.hint).toBeNull();
  });
  it('没有挖空提示：横线 + 提示行显示中文意思', () => {
    const v = cardView('cloze', note(), S, 0, L);
    expect(blankText(v)).toBe('___');
    expect(v.hint).toBe('飞越一个国家');
  });
  it('打开首字母：提示和首字母一起显示', () => {
    const v = cardView('cloze', note({ clozeHint: '飞越' }), { ...S, clozeLetters: true }, 0, L);
    expect(blankText(v)).toBe('[飞越] s _ _ _ _ _ _ _');
  });
});

describe('挖空专用例句', () => {
  it('有 clozeSentence 时挖空卡用它，认读卡仍用主例句', () => {
    const n = note({ clozeSentence: "Le drone doit {{survoler}} la zone avant l'aube.", clozeHint: '飞越' });
    const v = cardView('cloze', n, S, 0, L);
    expect(blankText(v)).toBe('[飞越]');
    expect((v.question.text as unknown[]).filter((x) => typeof x === 'string').join('')).toContain('Le drone doit');
    const r = cardView('recognition', n, S, 0, L);
    expect(JSON.stringify(r.question.text)).toContain("l'avion doit");
  });
  it('校验：挖空例句必须带 {{…}}；只有挖空例句时也能做挖空卡', async () => {
    const { noteErrors } = await import('../src/schema/validate');
    const base = { lemma: 'x', sentence: '', cardTypes: ['cloze'] as const, intentZh: null, answerFr: null };
    expect(noteErrors({ ...base, cardTypes: [...base.cardTypes], clozeSentence: 'sans marque' })).toContain('挖空例句里要用 {{…}} 标出挖掉的部分');
    expect(noteErrors({ ...base, cardTypes: [...base.cardTypes], clozeSentence: 'avec {{marque}}' })).toEqual([]);
  });
});
