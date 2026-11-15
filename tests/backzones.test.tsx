// 卡片背面固定分区：字段拆进各区、空区占位、注意区按需出现、标题样式、评分按钮上的标准
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BackZones, backZones, splitEntry, zoneHeadsOf } from '../src/features/BackZones';
import { gradeCriterion } from '../src/features/review/ReviewPage';
import { parseNote, type Note } from '../src/schema';
import { DEFAULTS } from '../src/features/settings/fields';
import { serialize } from '../src/sync/files';
import { SettingsV2 } from '../src/schema/v2';

const note = (over: Partial<Note>): Note => parseNote({
  id: 'n', deckId: 'd', createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z', lemma: 'prescription', ...over,
});

describe('一条「法语 + 中文」', () => {
  it('全角冒号、箭头、第一个汉字处分开', () => {
    expect(splitEntry('imputer qqch à qqn：把…归咎于…')).toEqual({ fr: 'imputer qqch à qqn', zh: '把…归咎于…' });
    expect(splitEntry('un cas classique → 典型的、常见的')).toEqual({ fr: 'un cas classique', zh: '典型的、常见的' });
    expect(splitEntry('bout 末端')).toEqual({ fr: 'bout', zh: '末端' });
  });
  it('整段括号里的中文去掉括号；只有法语或只有中文', () => {
    expect(splitEntry('la vulgarité（粗俗）')).toEqual({ fr: 'la vulgarité', zh: '粗俗' });
    expect(splitEntry('des querelles internes / politiques')).toEqual({ fr: 'des querelles internes / politiques', zh: '' });
    expect(splitEntry('衬衫袖口')).toEqual({ fr: '', zh: '衬衫袖口' });
  });
});

describe('字段拆进各区', () => {
  const n = note({
    usage: 'sur prescription médicale：凭处方',
    contexts: ["les prescriptions du règlement → 规定、指令", "la prescription d'un crime → 时效（法律）"],
    cueFamily: 'prescrire 开处方 · prescrit(e) 规定的',
    etymology: 'prae- 前 + scribere 写 → 处方',
    source: 'InnerFrench 第 31 集',
    extra: '高频：une prescription médicale；les prescriptions du médecin 医嘱\n⚠ prescrire 开处方 ≠ proscrire 禁止\n原文：forme de prescription à prendre du plaisir；已有卡：prescrire\n其他义：规定、指令\n语域：书面',
  });
  const z = backZones(n);
  it('用法 = 用法字段 + 高频；一条一行', () => {
    expect(z.use.map((e) => e.fr)).toEqual(['sur prescription médicale', 'une prescription médicale', 'les prescriptions du médecin']);
    expect(z.use[2].zh).toBe('医嘱');
  });
  it('其他语境用笔记的字段（有它时补充里的其他义不重复显示）', () => {
    expect(z.ctx).toHaveLength(2);
    expect(z.ctx[1]).toEqual({ fr: "la prescription d'un crime", zh: '时效（法律）' });
  });
  it('词族按 · 分开；⚠ 和已有卡进注意；出处 + 原文进出处；认不出的进补充', () => {
    expect(z.fam.map((e) => e.fr)).toEqual(['prescrire', 'prescrit(e)']);
    expect(z.warn).toEqual(['prescrire 开处方 ≠ proscrire 禁止', '已有卡：prescrire']);
    expect(z.src).toEqual(['InnerFrench 第 31 集', '原文：forme de prescription à prendre du plaisir']);
    expect(z.more).toEqual(['语域：书面']);
  });
  it('没写其他语境时，补充里的其他义放进其他语境', () => {
    expect(backZones(note({ extra: '其他义：衬衫袖口；排球垫球' })).ctx).toEqual([{ fr: '', zh: '衬衫袖口' }, { fr: '', zh: '排球垫球' }]);
  });
  it('没有中文的高频条目按 、 分；a（意）、b（意）式的词族也能分开', () => {
    expect(backZones(note({ extra: '高频：attraper la grippe、le vaccin contre la grippe' })).use).toHaveLength(2);
    expect(backZones(note({ cueFamily: 'frénétique（狂热的）、frénétiquement（疯狂地）' })).fam)
      .toEqual([{ fr: 'frénétique', zh: '狂热的' }, { fr: 'frénétiquement', zh: '疯狂地' }]);
  });
  it('出处是链接时单独给链接', () => {
    expect(backZones(note({ source: 'https://youtu.be/x?t=3' })).sourceUrl).toBe('https://youtu.be/x?t=3');
  });
});

describe('渲染', () => {
  const html = (n: Note, heads: 'text' | 'icon' | 'tint' = 'icon') => renderToStaticMarkup(<BackZones note={n} heads={heads} />);
  it('四个格子永远都在、顺序固定；没内容的是虚线占位', () => {
    const h = html(note({ etymology: 'verbal 口头的 → verbaliser' }));
    const order = ['z-use', 'z-ctx', 'z-ety', 'z-fam'].map((c) => h.indexOf(`zone ${c}`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect((h.match(/is-empty/g) ?? []).length).toBe(3);
    expect(h).toContain('出处');
  });
  it('注意区只在有内容时出现', () => {
    expect(html(note({}))).not.toContain('z-warn');
    expect(html(note({ extra: '⚠ 不用 à' }))).toContain('z-warn');
  });
  it('标题样式写在容器的 class 上，默认是图标', () => {
    expect(html(note({}), 'tint')).toContain('zones zh-tint');
    expect(zoneHeadsOf(undefined)).toBe('icon');
    expect(zoneHeadsOf({ zoneHeads: 'text' })).toBe('text');
    expect(DEFAULTS.zoneHeads).toBe('icon');
  });
  it('没改过的设置序列化出来不带 zoneHeads（同步文件不变）', () => {
    const s = SettingsV2.parse({ updatedAt: '2026-11-15T00:00:00.000Z' });
    expect(serialize(s)).not.toContain('zoneHeads');
  });
});

describe('评分按钮上的标准', () => {
  it('按卡型给标准；听力卡看了上下文 / 文字后跟着变', () => {
    expect(gradeCriterion('production', 2)).toBe('想出来但形式错');
    expect(gradeCriterion('listen', 1)).toBe('听不出来');
    expect(gradeCriterion('listen', 1, 2)).toBe('看了文字才懂');
    expect(gradeCriterion('listen', 2, 1)).toBe('看了上下文才懂');
    expect(gradeCriterion('recognition', 3)).toBe('');
  });
});

describe('补充里用 。 隔开的标记、近义 / 另义', () => {
  // 真实卡（s'affranchir de qqch）：高频、原文、近义、另义写在同一行，用 。 隔开
  const z = backZones(note({
    usage: "s'affranchir de qqch：摆脱（束缚、规则、依赖）",
    extra: "高频：s'affranchir des contraintes / des règles / de la tutelle de qqn。原文：s'affranchir d'une histoire ancienne（摆脱一段旧事）。近义：se libérer de、se défaire de。另义：affranchir une lettre 贴邮票",
  }));
  it('高频只剩搭配本身，原文进出处', () => {
    expect(z.use[1]).toEqual({ fr: "s'affranchir des contraintes / des règles / de la tutelle de qqn", zh: '' });
    expect(z.src).toEqual(["原文：s'affranchir d'une histoire ancienne（摆脱一段旧事）"]);
  });
  it('近义进用法、标上「近义」；另义进其他语境', () => {
    expect(z.use.slice(2)).toEqual([{ fr: 'se libérer de', zh: '近义' }, { fr: 'se défaire de', zh: '近义' }]);
    expect(z.ctx).toEqual([{ fr: 'affranchir une lettre', zh: '贴邮票' }]);
    expect(z.more).toEqual([]);
  });
  it('笔记写了其他语境时，补充里的其他义不重复的照样列出', () => {
    expect(backZones(note({ contexts: ['les prescriptions du règlement → 规定、指令'], extra: '其他义：规定、指令；法律时效' })).ctx.map((e) => e.zh))
      .toEqual(['规定、指令', '法律时效']);
  });
});

describe('图 5 / 图 7 的拆分', () => {
  it('中文义里的 ；不再拆出一条没有法语的条目', () => {
    expect(backZones(note({ cueFamily: 'preuve 证据 · prouver 证明 · éprouver 感受；考验 · une épreuve 考验；考试科目' })).fam).toEqual([
      { fr: 'preuve', zh: '证据' }, { fr: 'prouver', zh: '证明' }, { fr: 'éprouver', zh: '感受；考验' }, { fr: 'une épreuve', zh: '考验；考试科目' },
    ]);
  });
  it('｜ 分开的几段、回译 / 误写 / 朴素版各回各区，和出处重复的不再列', () => {
    const z = backZones(note({
      source: '回译 202610T1',
      extra: '⚠ 无人称结构 mieux vaut + inf. 里不能放 toi-même ｜ ⚠ propre 放名词前、不加冠词 ｜ 朴素版：venir voir par toi-même ｜ 回译 202610T1，误写：mieux vaut regarder toi-même',
    }));
    expect(z.warn).toEqual(['无人称结构 mieux vaut + inf. 里不能放 toi-même', 'propre 放名词前、不加冠词', '误写：mieux vaut regarder toi-même']);
    expect(z.use).toEqual([{ fr: 'venir voir par toi-même', zh: '朴素版' }]);
    expect(z.src).toEqual(['回译 202610T1']);
  });
});
