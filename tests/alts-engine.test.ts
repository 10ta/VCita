// 替代说法：静态来源合并、义项判断、级别、在库、✗
import { describe, expect, it } from 'vitest';
import { altKey, altsOf, levelOf, rlSense } from '../src/srs/alts';
import { parseLevels, parseRl } from '../src/lib/alts';
import { buildFlelex, parseTsv } from '../scripts/build-alts-data.mjs';
import type { Note } from '../src/schema';

const note = (over: Partial<Note>) => ({ id: 'n', lemma: 'x', meaningZh: '', sentence: '', altSentences: [], extra: null, usage: null, contexts: [], deleted: false, frame: null, ...over }) as unknown as Note;
const RL = parseRl([
  '# 头',
  'susciter\t\témotion victime\tcauser\t\tinspirer|provoquer\t',
  'reposer\tI\tsommeil fatigue calmer\t\t\tdormir|se détendre\t',
  'reposer\tII\targument preuve théorie\t\tse fonder sur\t\t',
  'colère\t1\tcrier\t\t\t\trage|fureur|exaspération|irritation',
].join('\n'));
const LV = parseLevels('causer\tA2\nprovoquer\tA2\ninspirer\tB1\nrage\tB2\nfureur\tC1\nexaspération\tC2\nirritation\tC1\nfonder\tB2\naider\tA1');

describe('替代说法', () => {
  it('比较用的形式：去冠词、括号、qqn / qqch', () => {
    expect(altKey("l'enjeu (m.)")).toBe('enjeu');
    expect(altKey('susciter qqch')).toBe('susciter');
  });
  it('单义项直接用；多义项靠例句关键词判，判不出不用', () => {
    expect(rlSense(note({ lemma: 'susciter qqch' }), RL)?.alts.下位).toEqual(['causer']);
    expect(rlSense(note({ lemma: 'reposer sur qqch', sentence: 'Cet {{argument}} repose sur une preuve.' }), RL)).toBeNull(); // 「reposer sur」不是 RL-fr 的词条
    expect(rlSense(note({ lemma: 'reposer', sentence: 'Cette théorie {{repose}} sur un argument solide.' }), RL)?.num).toBe('II');
    expect(rlSense(note({ lemma: 'reposer', sentence: 'Il faut {{reposer}} la question.' }), RL)).toBeNull();
  });
  it('级别取最难的词；有词查不到返回 null', () => {
    expect(levelOf('provoquer', LV)).toBe('A2');
    expect(levelOf('se fonder sur', LV)).toBe('B2');
    expect(levelOf('inconnu total', LV)).toBeNull();
  });
  it('合并来源、在库、✗、下位超过 B1 标出、每类最多三条', () => {
    const n = note({ id: 'n', lemma: 'la colère', cluster: '生气', alts: [{ fr: 'agacement', kind: '下位' }], altNo: ['irritation'] });
    const m = note({ id: 'm', lemma: 'la rage', meaningZh: '狂怒；狂犬病', cluster: '生气' });
    const out = altsOf(n, [n, m], { rl: RL, levels: LV }, [{ fr: 'fureur', kind: '上位', source: '补充' }]);
    const by = (fr: string) => out.find((a) => a.fr === fr);
    expect(by('agacement')?.source).toBe('自写');
    expect(by('la rage')).toMatchObject({ kind: '平替', source: '表达群', noteId: 'm', zh: '狂怒' });
    expect(by('rage')).toBeUndefined(); // 和在库的 la rage 是同一个说法
    expect(by('fureur')?.source).toBe('补充'); // 同一个说法留排在前面的来源
    expect(by('irritation')).toBeUndefined(); // ✗ 过的
    expect(out.filter((a) => a.kind === '上位').length).toBeLessThanOrEqual(3);
    expect(out.map((a) => a.kind)).toEqual([...out.map((a) => a.kind)].sort((a, b) => ['下位', '平替', '近义', '上位'].indexOf(a) - ['下位', '平替', '近义', '上位'].indexOf(b)));
    const hard = altsOf(note({ lemma: 'y', alts: [{ fr: 'fureur', kind: '下位' }] }), [], { levels: LV });
    expect(hard[0].tooHard).toBe(true);
  });
});

describe('生成脚本', () => {
  it('带引号的制表符文件：字段里有换行、成对引号', () => {
    expect(parseTsv('"a"\t"b"\n"x\ny"\t"say ""hi"""\n')).toEqual([{ a: 'x\ny', b: 'say "hi"' }]);
  });
  it('FLELex 级别 = 每百万词 ≥ 3 次的最低级别', () => {
    const out = buildFlelex('word\ttag\tA1\tA2\tB1\tB2\tC1\tC2\ttotal\naider\tVER\t50\t40\t30\t20\t10\t5\t30\ndéfi\tNOM\t0.8\t0.5\t1\t2\t4\t6\t2\nrare\tNOM\t0\t0\t0\t0\t1\t2\t1\n');
    expect(out).toContain('aider\tA1');
    expect(out).toContain('défi\tC1');
    expect(out).not.toContain('rare');
  });
});
