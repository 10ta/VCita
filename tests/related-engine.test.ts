// 关联引擎：概念表、同概念 / 同类 / 词族 / 可能相关、否决
import { describe, expect, it } from 'vitest';
import { CONCEPT_GROUPS, CONCEPT_LIST, conceptGroup, isConcept } from '../src/lib/concepts';
import { centerWord, relatedOf, similarity } from '../src/srs/related';
import { parseNote, type Note } from '../src/schema';

const T = '2026-11-23T00:00:00.000Z';
const note = (id: string, over: Partial<Note> = {}): Note => parseNote({ id, deckId: 'd', createdAt: T, updatedAt: T, lemma: id, ...over });

describe('概念表', () => {
  it('概念名全表唯一，每个大类都有概念', () => {
    expect(new Set(CONCEPT_LIST).size).toBe(CONCEPT_LIST.length);
    for (const g of CONCEPT_GROUPS) expect(g.items.length).toBeGreaterThan(3);
    expect(conceptGroup('愤怒')).toBe('情绪');
    expect(isConcept('竞争冲突')).toBe(false);
  });
});

describe('关联引擎', () => {
  const colere = note('colere', { lemma: 'être hors de soi', meaningZh: '气得失去理智、怒不可遏', topics: ['愤怒'] });
  const rage = note('rage', { lemma: 'fou de rage', meaningZh: '气疯了', topics: ['愤怒'] });
  const peur = note('peur', { lemma: 'redouter qqch', meaningZh: '惧怕、担心', topics: ['恐惧担心'] });
  const agace = note('agace', { lemma: 'exaspéré(e)', meaningZh: '忍无可忍、怒不可遏', topics: ['失望沮丧'] });
  const indigne = note('indigne', { lemma: 'être indigné(e) par qqch', meaningZh: '对……感到愤慨', meaningEn: 'to be outraged by' });
  const outre = note('outre', { lemma: 'outré(e)', meaningZh: '感到愤慨、气愤', meaningEn: 'outraged' });
  const releve = note('releve', { lemma: 'mettre qqch en relief', meaningZh: '突出', cueFamily: 'le relief 浮雕' });
  const relief = note('relief', { lemma: 'le relief', meaningZh: '浮雕；地形' });
  const avant = note('avant', { lemma: 'mettre qqch en avant', meaningZh: '突出、推到显眼位置' });
  const all = [colere, rage, peur, agace, indigne, outre, releve, relief, avant];

  it('同概念互相关联；强关联太少时同一大类按意思补上（不沾边的不补）', () => {
    const r = relatedOf(colere, all);
    expect(r.concepts[0]).toMatchObject({ concept: '愤怒', legacy: false });
    expect(r.concepts[0].mates.map((n) => n.id)).toEqual(['rage']);
    expect(r.weak?.group).toBe('情绪');
    // 同类只补意思沾边的：同属「情绪」但意思不沾边的 peur 不列
    expect(r.weak?.mates.map((n) => n.id)).toEqual(['agace']);
  });
  it('没有共同概念、意思高度重合 → 可能相关；否决后不再推荐', () => {
    expect(similarity(indigne, outre, all)).toBeGreaterThanOrEqual(0.5);
    expect(relatedOf(indigne, all).suspects.map((n) => n.id)).toContain('outre');
    const no = { ...indigne, relNo: ['outre'] };
    expect(relatedOf(no, [no, ...all.filter((n) => n.id !== 'indigne')]).suspects.map((n) => n.id)).not.toContain('outre');
  });
  it('中心词跳过轻动词和介词：同词族只连真正同根的', () => {
    expect(centerWord('mettre qqch en relief')).toBe('relief');
    expect(centerWord("sous l'emprise de qqch")).toBe('emprise');
    const fam = relatedOf(releve, all).family.map((n) => n.id);
    expect(relatedOf(releve, all).sameWord.map((n) => n.id)).toContain('relief');
    expect(fam).not.toContain('avant');
  });
  it('同表达群的不列（它们在表达群回想里）', () => {
    const a = note('a', { topics: ['愤怒'], cluster: '生气' });
    const b = note('b', { topics: ['愤怒'], cluster: '生气' });
    expect(relatedOf(a, [a, b]).concepts).toEqual([]);
  });
});

describe('同词另义、情境题面', () => {
  it('confier / se confier：同一个中心词 → 同词另义，排在最前', () => {
    const a = parseNote({ id: 'a', deckId: 'd', createdAt: T, updatedAt: T, lemma: 'confier qqch à qqn', meaningZh: '托付' });
    const b = parseNote({ id: 'b', deckId: 'd', createdAt: T, updatedAt: T, lemma: 'se confier à qqn', meaningZh: '倾诉', sense: '吐露心事' });
    expect(relatedOf(a, [a, b]).sameWord.map((n) => n.id)).toEqual(['b']);
    expect(relatedOf(a, [a, b]).family).toEqual([]);
  });
});
