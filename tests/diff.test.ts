import { describe, expect, it } from 'vitest';
import { diffWords, pickReference, summarize, tokens } from '../src/lib/diff';

describe('产出卡逐词对照', () => {
  it('分词：省音单独成词，弯撇号统一', () => {
    expect(tokens("J’ai écopé d'une amende.")).toEqual(["J'", 'ai', 'écopé', "d'", 'une', 'amende', '.']);
  });
  it('全对（大小写不算）', () => {
    const ops = diffWords('écopé d’une amende', "Écopé d'une amende");
    expect(ops.every((o) => o.op === 'same')).toBe(true);
    expect(summarize(ops).total).toBe(0);
  });
  it('重音、阴阳性、其他错误分开标', () => {
    const ops = diffWords('ecope d un amende', "écopé d'une amende");
    expect(ops).toContainEqual({ op: 'sub', typed: 'ecope', expected: 'écopé', kind: 'accent' });
    const g = diffWords('un amende', 'une amende');
    expect(g).toContainEqual({ op: 'sub', typed: 'un', expected: 'une', kind: 'gender' });
    expect(diffWords('une belle voiture', 'une beau voiture')[1]).toMatchObject({ op: 'sub', kind: 'gender' });
    expect(diffWords('reçu une amende', 'écopé une amende')[0]).toMatchObject({ op: 'sub', kind: 'word' });
    expect(summarize(diffWords('ecope un amende', "écopé d'une amende"))).toMatchObject({ accent: 1 });
  });
  it('漏写、多写', () => {
    expect(diffWords('une amende', "d'une amende")).toEqual([{ op: 'missing', expected: "d'" }, { op: 'same', text: 'une' }, { op: 'same', text: 'amende' }]);
    expect(diffWords('une grosse amende', 'une amende')).toContainEqual({ op: 'extra', typed: 'grosse' });
  });
  it('只写了要换的部分就只和高亮比，写了整句就和整句比', () => {
    const ans = "J'ai {{écopé d'une amende}} pour stationnement.";
    expect(pickReference("écopé d'une amende", ans)).toEqual({ ref: "écopé d'une amende", whole: false });
    expect(pickReference("J'ai écopé d'une amende pour stationnement", ans).whole).toBe(true);
  });
  it('词不和标点配对', () => {
    const ops = diffWords('mecontente un client', 'déplaire.');
    expect(ops).toContainEqual({ op: 'sub', typed: 'mecontente', expected: 'déplaire', kind: 'word' });
    expect(ops).toContainEqual({ op: 'missing', expected: '.' });
    expect(ops.some((o) => o.op === 'sub' && o.expected === '.')).toBe(false);
  });
});
