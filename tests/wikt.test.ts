import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error 构建脚本是 .mjs，没有类型
import { createBuilder } from '../scripts/build-fr-wikt.mjs';
import { etymOf, linksOf, parseEtym, parseLinks } from '../src/lib/wikt';
import { head, headWord } from '../src/lib/headword';
import { cueHas, toggleCue } from '../src/features/noteform/model';

// 迷你词典：形式 词性 性 数 原形 词频 [v]
const DICT = [
  '# 注释行',
  'éminent\tA\tm\ts\t\t8', 'imminent\tA\tm\ts\t\t5', 'ver\tN\tm\ts\t\t12', 'verre\tN\tm\ts\t\t90', 'vert\tA\tm\ts\t\t60', 'vers\tO\t\t\t\t500',
  'verres\tN\tm\tp\tverre\t90', 'constater\tV\t\t\t\t40', 'constatation\tN\tf\ts\t\t9', 'constat\tN\tm\ts\t\t7', 'remarquer\tV\t\t\t\t80',
  'rare\tA\t\ts\t\t0', 'oeuvre\tN\th\ts\t\t70',
  ...Array.from({ length: 12 }, (_, i) => `mot${i}\tN\tm\ts\t\t${i + 1}`),
].join('\n');

// 手写的 wiktextract 行
const JSONL = [
  { word: 'éminent', lang_code: 'fr', pos: 'adj', paronyms: [{ word: 'imminent' }, { word: 'immanent' }], etymology_texts: ['Étymologie manquante ou incomplète. Si vous la connaissez, vous pouvez l’ajouter.'] },
  { word: 'éminent', lang_code: 'fr', pos: 'noun', etymology_texts: ['Du latin\teminens,  « qui s’élève ».', 'deuxième'] },
  { word: 'ver', lang_code: 'fr', pos: 'noun', sounds: [{ ipa: '\\vɛʁ\\' }, { homophone: 'verre' }, { homophone: 'vert' }, { homophone: 'vers' }, { homophone: 'vair' }], etymology_texts: [`Du latin vermis. ${'x'.repeat(400)}`] },
  { word: 'verres', lang_code: 'fr', pos: 'noun', tags: ['form-of'], sounds: [{ homophone: 'ver' }], etymology_texts: ['→ voir verre'] },
  { word: 'constater', lang_code: 'fr', pos: 'verb', derived: [{ word: 'constatation' }, { word: 'constat' }, { word: 'constatable' }], synonyms: [{ word: 'remarquer', sense: 'voir' }, { word: 'se rendre compte' }] },
  { word: 'constater', lang_code: 'fr', pos: 'verb', related: [{ word: 'constat' }], senses: [{ synonyms: [{ word: 'Remarquer' }] }] },
  { word: 'constater', lang_code: 'en', pos: 'noun', synonyms: [{ word: 'verre' }] },
  { word: 'Vert', lang_code: 'fr', pos: 'name', paronyms: [{ word: 'ver' }], etymology_texts: ['Nom de famille.'] },
  { word: 'rare', lang_code: 'fr', pos: 'adj', synonyms: [{ word: 'vert' }], etymology_texts: ['Du latin rarus.'] },
  { word: 'œuvre', lang_code: 'fr', pos: 'noun', paronyms: [{ word: 'ver' }, ...Array.from({ length: 12 }, (_, i) => ({ word: `mot${i}` }))] },
];
const build = (opts = {}) => { const b = createBuilder(DICT, opts); JSONL.forEach((e) => b.add(e)); return b.finish(); };

describe('Wiktionnaire 构建脚本', () => {
  const r = build();
  const idx = parseLinks(r.links);
  const etym = parseEtym(r.etym);
  it('过滤：只留法语、词频 > 0 的原形；链接词只留词典里有的；专有名词不并进来', () => {
    expect(idx.get('éminent')?.paronyms).toEqual(['imminent']); // immanent 不在词典里
    expect(idx.get('constater')?.synonyms).toEqual(['remarquer']); // 英语那行、多词的 se rendre compte 都不要
    expect(idx.has('rare')).toBe(false); // 词频 0
    expect(idx.get('vert')?.synonyms).toEqual(['rare']); // 但 rare 在词典里，可以当别人的链接词（反向挂到 vert 上）
    expect(idx.get('ver')?.paronyms).toEqual(['oeuvre']); // 来自 œuvre 那行的反向；Vert（专有名词）那行不算
    expect(idx.get('ver')?.homophones).toEqual(['vers', 'verre', 'verres', 'vert']); // 按词频从高到低，vair 不在词典里
  });
  it('合并：同一个词多个词性的行并成一行；关系补成双向', () => {
    expect(idx.get('constater')?.family).toEqual(['constatation', 'constat']);
    expect(idx.get('constat')?.family).toEqual(['constater']);
    expect(idx.get('imminent')?.paronyms).toEqual(['éminent']);
    expect(idx.get('verre')?.homophones).toEqual(['ver']);
    expect(idx.get('remarquer')?.synonyms).toEqual(['constater']);
  });
  it('截断：每类最多 8 个，留词频高的；词源取第一条有内容的，截到 300 字符', () => {
    expect(idx.get('oeuvre')?.paronyms).toEqual(['mot11', 'ver', 'mot10', 'mot9', 'mot8', 'mot7', 'mot6', 'mot5']);
    expect(etym.get('éminent')).toBe('Du latin eminens, « qui s’élève ».'); // 跳过"Étymologie manquante"，制表符、多余空格收掉
    expect([...etym.get('ver')!]).toHaveLength(300);
    expect(etym.get('ver')!.endsWith('…')).toBe(true);
    expect(etym.has('verres')).toBe(false);
    expect(etym.has('rare')).toBe(false);
  });
  it('超过目标大小时从词频最低的原形开始丢；覆盖率和抽查', () => {
    const small = build({ linksBudget: 520 });
    const kept = parseLinks(small.links);
    expect(small.stats.linkDropped).toBeGreaterThan(0);
    expect(Buffer.byteLength(small.links)).toBeLessThanOrEqual(520);
    expect(kept.has('verre')).toBe(true); // 词频 90
    expect(kept.has('mot0')).toBe(false); // 词频 1
    expect(r.coverage[5000].n).toBe(23);
    expect(r.coverage[5000].homophones).toBeCloseTo(4 / 23);
    expect(r.hasPair('paronyms', 'éminent', 'imminent')).toBe(true);
    expect(r.hasPair('homophones', 'verre', 'ver')).toBe(true);
    expect(r.hasPair('homophones', 'verre', 'vert')).toBe(false);
  });
});

describe('Wiktionnaire 索引读取', () => {
  const idx = parseLinks('# 注释\nprendre\t\t\tsaisir\tprise,reprendre\noccuper\tocculter\n');
  const etym = parseEtym('# 注释\nprendre\tDu latin prehendere\t(avec tab).\n');
  it('多词表达取第一个实词', () => {
    expect(headWord('prendre qqn dans le sens du poil')).toBe('prendre');
    expect(headWord("s'occuper de")).toBe('occuper');
    expect(headWord('l’œuvre (f.)')).toBe('oeuvre');
    expect(headWord('être à la hauteur')).toBe('hauteur');
    expect(head('une Évidence')).toBe('evidence');
    expect(linksOf(idx, 'prendre qqn dans le sens du poil')).toEqual({ paronyms: [], homophones: [], synonyms: ['saisir'], family: ['prise', 'reprendre'] });
    expect(linksOf(idx, "s'occuper de")?.paronyms).toEqual(['occulter']);
    expect(etymOf(etym, 'Prendre qqch')).toBe('Du latin prehendere\t(avec tab).');
  });
  it('查不到、索引没加载：null', () => {
    expect(linksOf(idx, 'inconnu')).toBeNull();
    expect(linksOf(null, 'prendre')).toBeNull();
    expect(etymOf(undefined, 'prendre')).toBeNull();
    expect(linksOf(idx, '')).toBeNull();
  });
  it('仓库里的两份数据文件能解析（没生成时是空的占位）', () => {
    for (const [f, parse] of [['fr-links.txt', parseLinks], ['fr-etym.txt', parseEtym]] as const) {
      const text = readFileSync(new URL(`../src/lib/wikt/${f}`, import.meta.url), 'utf8');
      expect(text.startsWith('# VCita Wiktionnaire')).toBe(true);
      expect(parse(text).size).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('词族候选：点一下填进词族线索，再点一次去掉', () => {
  it('toggleCue', () => {
    expect(toggleCue('', 'repérer', '找出、标出')).toBe('repérer 找出、标出');
    expect(toggleCue('repérer 找出、标出', 'le repère')).toBe('repérer 找出、标出；le repère');
    expect(cueHas('repérer 找出、标出；repère', 'repère')).toBe(true);
    expect(cueHas('repérer 找出、标出', 'repère')).toBe(false);
    expect(toggleCue('repérer 找出、标出；repère', 'repérer')).toBe('repère');
    expect(toggleCue('repère', 'repère')).toBe('');
  });
});
