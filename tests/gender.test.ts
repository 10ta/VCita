import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { genderInfo, lemmaFreq, parseDict } from '../src/lib/gender/dict';
import { matchRule } from '../src/lib/gender/rules';
import { RULE_STATS } from '../src/lib/gender/stats.gen';

const dict = parseDict(readFileSync(new URL('../src/lib/gender/fr-dict.txt', import.meta.url), 'utf8'));

describe('法语词典：阴阳性', () => {
  it('Lexique 没标、Lefff 补上的常用名词', () => {
    expect(dict.get('voiture')?.g).toBe('f');
    expect(dict.get('main')?.g).toBe('f');
    expect(dict.get('Maisons')?.g).toBe('f');
    expect(dict.get('œuvre')?.g).toBe('h');
  });
  it('词尾规则 + 例外：la page 不是 -age 的例外（同形异义），l\'image 是', () => {
    const img = genderInfo(dict, 'image')!;
    expect(img.gender).toBe('f');
    expect(img.rule?.suffix).toBe('age');
    expect(img.rule?.isException).toBe(true);
    const v = genderInfo(dict, 'voyages')!;
    expect(v.rule).toMatchObject({ suffix: 'age', gender: 'm', isException: false });
    expect(genderInfo(dict, 'nation')!.rule?.pct).toBeGreaterThanOrEqual(99);
    expect(genderInfo(dict, 'page')!.homograph?.f).toContain('页');
  });
  it('另一个性的形式：acteur ↔ actrice，beau ↔ belle；指人名词不给词尾规则', () => {
    expect(genderInfo(dict, 'actrice')!.other).toContain('acteur');
    expect(genderInfo(dict, 'acteur')!.other).toContain('actrice');
    expect(genderInfo(dict, 'acteur')!.rule).toBeNull();
    const b = genderInfo(dict, 'belle')!;
    expect(b.pos).toBe('A');
    expect(b.other).toContain('beau');
  });
  it('冠词定性：la tour / le tour', () => {
    expect(genderInfo(dict, 'tour', 'la')!.ctxGender).toBe('f');
    expect(genderInfo(dict, 'tour', 'un')!.ctxGender).toBe('m');
    expect(genderInfo(dict, 'tour', 'les')!.ctxGender).toBeNull();
  });
  it('不是名词 / 形容词的词不给信息', () => {
    expect(genderInfo(dict, 'est')).toBeNull();
    expect(genderInfo(dict, 'pour')).toBeNull();
  });
  it('规则统计来自真实数据，-tion 几乎全阴性、-ment 几乎全阳性', () => {
    expect(RULE_STATS.tion.pct).toBeGreaterThanOrEqual(99);
    expect(RULE_STATS.ment.pct).toBeGreaterThanOrEqual(99);
    expect(matchRule('information')?.suffix).toBe('tion');
    expect(matchRule('son')?.suffix).toBe('on');
  });
});

describe('词频', () => {
  it('短语取最生僻的实词；qqch、括号说明不算', () => {
    const t = lemmaFreq(dict, 'teinter qqch')!;
    expect(t).toBeGreaterThan(0);
    expect(lemmaFreq(dict, 'avoir besoin de')).toBe(dict.get('besoin')!.freq);
    expect(lemmaFreq(dict, 'écoper (de qqch)')).toBe(dict.get('écoper')!.freq);
    expect(lemmaFreq(dict, "faire face à")!).toBeGreaterThan(lemmaFreq(dict, 'teinter qqch')!);
    expect(lemmaFreq(dict, 'zzzqqq')).toBeNull();
  });
});

import { genderDisplayOf } from '../src/features/FrText';
describe('阴阳性下划线设置', () => {
  it('默认只标考查部分；旧开关关掉过的默认关闭；设过就用设的', () => {
    expect(genderDisplayOf({})).toBe('focus');
    expect(genderDisplayOf({ genderColors: false })).toBe('off');
    expect(genderDisplayOf({ genderColors: false, genderDisplay: 'hover' })).toBe('hover');
  });
});
