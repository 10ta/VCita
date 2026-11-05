import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalLemma, parseDict, parseVerbs, lemmaOf } from '../src/lib/gender/dict';
import { annotate, buildIndex, coverage, coverageAdvice, importFile, parseSubtitles, stripMarkdown, tokenize } from '../src/lib/reading';
import { db } from '../src/db/db';
import { addNotes, addText, clearAllLocalData, deleteText, recordEncounter, setKnown, updateText } from '../src/db/actions';
import { applyRemoteFile, buildLocalFiles, clearFileCache } from '../src/sync/files';
import { exportBundle, importBundle } from '../src/io/bundle';
import type { Card, Note } from '../src/schema';

const dict = parseDict(readFileSync(new URL('../src/lib/gender/fr-dict.txt', import.meta.url), 'utf8'));
const verbs = parseVerbs(readFileSync(new URL('../src/lib/gender/fr-verbs.txt', import.meta.url), 'utf8'));

describe('原形与词频', () => {
  it('变位动词还原成不定式；名词动词同形取常用的', () => {
    expect(lemmaOf(dict, verbs, 'mangeait')?.lemma).toBe('manger');
    expect(lemmaOf(dict, verbs, 'déroge')?.lemma).toBe('déroger');
    expect(lemmaOf(dict, verbs, 'est')?.lemma).toBe('être');
    expect(lemmaOf(dict, verbs, 'sommes')?.lemma).toBe('être');
    expect(lemmaOf(dict, verbs, 'choses')?.lemma).toBe('chose');
    expect(lemmaOf(dict, verbs, 'xyzzy')).toBeNull();
    expect(canonicalLemma(dict, verbs, 'grouillante')).toBe('grouiller');
    expect(canonicalLemma(dict, verbs, 'est')).toBe('être');
    expect(canonicalLemma(dict, verbs, 'choses')).toBe('chose');
  });
  it('词频排名：越往后词频越低', () => {
    expect(dict.freqAtRank(100)).toBeGreaterThan(dict.freqAtRank(2000));
    expect(dict.freqAtRank(2000)).toBeGreaterThan(dict.freqAtRank(5000));
    expect(dict.freqAtRank(0)).toBe(Infinity);
  });
});

describe('切词与标色', () => {
  it("l'arbre 拆开，aujourd'hui 整体保留", () => {
    expect(tokenize("Aujourd'hui, l'arbre", dict).filter((t) => t.word).map((t) => t.text)).toEqual(["Aujourd'hui", 'arbre']);
  });
  const stamp = '2026-11-01T00:00:00.000Z';
  const note = (id: string, lemma: string): Note => ({ id, lemma, deckId: 'd', createdAt: stamp, updatedAt: stamp, deleted: false } as unknown as Note);
  const card = (noteId: string, state: Card['state'], interval: number): Card => ({ id: `c${noteId}`, noteId, state, interval, deleted: false, suspended: false } as unknown as Card);
  const notes = [note('a', 'déroger à qqch'), note('b', 'le pillage'), note('c', 'une émeute'), note('d', "d'après moi"), note('e', 'grouillant(e) de (monde)')];
  const cards = [card('a', 'review', 30), card('b', 'learning', 0), card('c', 'new', 0), card('d', 'new', 0), card('e', 'learning', 0)];

  it('认识 / 学习中 / 有卡未学 / 生词；专有名词不算', () => {
    const idx = buildIndex(dict, verbs, notes, cards, new Set(['grouiller']), 2000);
    const idxNoKnown = buildIndex(dict, verbs, notes, cards, new Set(), 2000);
    expect(idxNoKnown.of('grouillante')?.status).toBe('learning');
    const st = (w: string) => idx.of(w)?.status;
    expect(st('dérogeait')).toBe('known'); // 自己的卡已稳定
    expect(st('pillages')).toBe('learning');
    expect(st('émeutes')).toBe('new');
    expect(st('grouillant')).toBe('known'); // 手动标认识（现在分词还原成 grouiller）
    expect(st('maison')).toBe('known'); // 常用词
    expect(st('interdisciplinarité')).toBe('unknown');
    expect(idx.of('Montréal')).toBeNull();
    // 短语笔记不让常用词变色；一个词形属于几个原形时任何一个对上就算
    expect(st('après')).toBe('known');
    expect(st('grouillante')).toBe('known'); // grouiller 标了认识，手动标记优先
    expect(idxNoKnown.of('grouillait')?.status).toBe('learning');
    // N = 0：常用词不再算认识，虚词仍算
    const idx0 = buildIndex(dict, verbs, [], [], new Set(), 0);
    expect(idx0.of('maison')?.status).toBe('unknown');
    expect(idx0.of('les')?.status).toBe('known');
  });
  it('覆盖率和建议', () => {
    const idx = buildIndex(dict, verbs, notes, cards, new Set(), 2000);
    const toks = annotate('Les émeutes et le pillage ont dérogé à toute interdisciplinarité.', idx, dict);
    const c = coverage(toks);
    expect(c.total).toBe(10);
    expect(c).toMatchObject({ learning: 1, new: 1, unknown: 1, uniqueUnknown: 1 });
    expect(c.pct).toBe(70);
    expect(coverageAdvice(99)).toContain('泛读');
    expect(coverageAdvice(87)).toContain('精读');
    expect(coverageAdvice(70)).toContain('台阶');
  });
});

describe('导入', () => {
  it('srt / vtt：开始时间、去标记、去重复的滚动行', () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,000\n<i>Bonjour</i> à tous\n\n2\n00:01:02,500 --> 00:01:04,000\n{\\an8}On commence.\n\n3\n00:01:04,000 --> 00:01:05,000\nOn commence.\n';
    expect(parseSubtitles(srt)).toEqual([{ t: '00:00:01', text: 'Bonjour à tous' }, { t: '00:01:02', text: 'On commence.' }]);
    const vtt = 'WEBVTT\n\n01:02:03.400 --> 01:02:05.000\nSalut';
    expect(parseSubtitles(vtt)).toEqual([{ t: '01:02:03', text: 'Salut' }]);
    expect(importFile('video.srt', srt).body).toBe('Bonjour à tous\nOn commence.');
  });
  it('Markdown：front matter 的标题、去掉语法', () => {
    const md = '---\ntitle: "Mon texte"\ntags: [x]\n---\n# Titre\n\nUn **mot** et [un lien](http://x).\n\n```\ncode\n```\n> cité';
    const r = importFile('a.md', md);
    expect(r.title).toBe('Mon texte');
    expect(r.body).toBe('Titre\n\nUn mot et un lien.\n\ncité');
    expect(stripMarkdown('- item\n1. deux')).toBe('item\ndeux');
  });
});

describe('阅读数据：保存、同步、备份', () => {
  beforeEach(async () => { await clearAllLocalData(); clearFileCache(); });
  it('遇见：同一句只记一次，不同句子累加', async () => {
    expect(await recordEncounter({ key: 'Déroger', form: 'dérogeait', sentence: 'A.' })).toHaveLength(1);
    expect(await recordEncounter({ key: 'déroger', form: 'déroger', sentence: 'A.' })).toHaveLength(1);
    expect(await recordEncounter({ key: 'déroger', form: 'déroge', sentence: 'B.' })).toHaveLength(2);
  });
  it('认识：标记、取消（墓碑）', async () => {
    await setKnown('Pillage', true);
    expect((await db.known.get('pillage'))?.deleted).toBe(false);
    await setKnown('pillage', false);
    expect((await db.known.get('pillage'))?.deleted).toBe(true);
  });
  it('同步文件：texts / encounters 按月份，known.json 一个文件；远端合并', async () => {
    const id = await addText({ title: 'Article', source: 'TCF', body: 'Texte.' });
    await updateText(id, { summary: 'Résumé.' });
    await recordEncounter({ key: 'texte', form: 'Texte', sentence: 'Texte.', textId: id });
    await setKnown('texte', true);
    const files = await buildLocalFiles();
    const rels = [...files.keys()];
    const textRel = rels.find((r) => r.startsWith('texts/'))!;
    const encRel = rels.find((r) => r.startsWith('encounters/'))!;
    expect(rels).toContain('known.json');
    expect(JSON.parse(files.get(textRel)!).texts[0]).toMatchObject({ title: 'Article', summary: 'Résumé.', body: 'Texte.' });
    await clearAllLocalData();
    for (const r of [textRel, encRel, 'known.json']) await applyRemoteFile(r, files.get(r)!);
    expect((await db.texts.get(id))?.summary).toBe('Résumé.');
    expect(await db.encounters.count()).toBe(1);
    expect((await db.known.get('texte'))?.deleted).toBe(false);
    await deleteText(id);
    expect((await db.texts.get(id))?.deleted).toBe(true);
  });
  it('备份带上文章、遇见、认识；旧备份照样能导入', async () => {
    await addText({ title: 'A', body: 'x' });
    await recordEncounter({ key: 'x', form: 'x', sentence: 'x' });
    await setKnown('x', true);
    const b = await exportBundle();
    expect([b.texts.length, b.encounters.length, b.known.length]).toEqual([1, 1, 1]);
    await clearAllLocalData();
    const r = await importBundle(b);
    expect([r.texts.added, r.encounters.added, r.known.added]).toEqual([1, 1, 1]);
    await clearAllLocalData();
    const r2 = await importBundle({ ...b, texts: undefined, encounters: undefined, known: undefined });
    expect(r2.texts.added).toBe(0);
    await addNotes([{ deckId: 'd', lemma: 'y' }]);
  });
});
