import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildQueue } from '../src/srs/queue';
import { cardView } from '../src/features/CardFace';
import { frameMeta, frameSortKey, hasSlots, pickTopic } from '../src/lib/frames';
import { SEED_FRAMES } from '../src/lib/frames-seed';
import { importStarterFrames, pendingStarterFrames } from '../src/lib/frames-import';
import { noteErrors } from '../src/schema/validate';
import { db } from '../src/db/db';
import { clearAllLocalData, getSettings } from '../src/db/actions';
import { studyDay, toIso } from '../src/lib/time';
import type { Card, Note, ReviewLog } from '../src/schema';

const NOW = new Date(2026, 10, 5, 15, 0).getTime();
let k = 0;
const card = (noteId: string, over: Partial<Card> = {}): Card => ({
  id: `c${++k}`, noteId, deckId: 'd', createdAt: toIso(NOW - 86400000 * 10 + k * 1000), type: 'recognition',
  state: 'new', due: toIso(NOW - 3600000), interval: 0, ease: 2.5, reps: 0, lapses: 0, step: 0,
  lastReviewedAt: null, isLeech: false, suspended: false, updatedAt: toIso(0), deleted: false, ...over,
});
const seen = (c: Card): ReviewLog => ({
  id: `l${++k}`, cardId: c.id, noteId: c.noteId, ts: toIso(NOW), day: studyDay(NOW, 4), rating: 3, prevState: 'new', newState: 'learning',
  prevInterval: null, newInterval: null, prevEase: null, newEase: null, prevDue: null, newDue: null, elapsedMs: null, source: 'app', updatedAt: toIso(NOW), deleted: false,
});
const FRAME = { task: 'T3', slot: '⑤', lens: '①', register: null };
const meta = (frame: Note['frame']) => ({ layer: 'core' as const, tags: [], frame });

describe('句框卡进队列', () => {
  const words = Array.from({ length: 6 }, (_, i) => card(`w${i}`));
  const frames = Array.from({ length: 4 }, (_, i) => card(`f${i}`, { type: 'frame' }));
  const notes = new Map([...words.map((c) => [c.noteId, meta(null)] as const), ...frames.map((c) => [c.noteId, meta(FRAME)] as const)]);
  const S = { newPerDay: 5, reviewsPerDay: 0, dayStartHour: 4, frameNewPerDay: 2, newSplit: false };
  const news = (cards: Card[], logs: ReviewLog[] = [], s = S) => {
    const q = buildQueue({ cards, todayLogs: logs, deckId: 'd', now: NOW, settings: s, notes });
    return [...q.servable].map((id) => cards.find((c) => c.id === id)!).filter((c) => c.state === 'new');
  };

  it('句框占用每日新卡名额，最多 frameNewPerDay 张，剩下给单词', () => {
    const got = news([...words, ...frames]);
    expect(got).toHaveLength(5);
    expect(got.filter((c) => c.type === 'frame')).toHaveLength(2);
  });
  it('没有句框时名额全给单词；今天已经学过的句框算进去', () => {
    expect(news(words)).toHaveLength(5);
    const got = news([...words, ...frames], [seen(frames[0]), seen(frames[1])].map((l) => l));
    // 今天已学 2 张句框：句框名额用完，单词还能出 3 张
    expect(got.filter((c) => c.type === 'frame')).toHaveLength(0);
    expect(got).toHaveLength(3);
  });
  it('frameNewPerDay = 0 时不出句框', () => {
    expect(news([...words, ...frames], [], { ...S, frameNewPerDay: 0 }).some((c) => c.type === 'frame')).toBe(false);
  });
  it('套用卡要等同一条笔记的句框卡进入复习', () => {
    const f = card('g', { type: 'frame' });
    const a = card('g', { type: 'apply' });
    const n2 = new Map([['g', meta(FRAME)]]);
    const q1 = buildQueue({ cards: [f, a], todayLogs: [], deckId: 'd', now: NOW, settings: S, notes: n2 });
    expect(q1.servable.has(a.id)).toBe(false);
    const f2 = { ...f, state: 'review' as const, interval: 3, due: toIso(NOW + 86400000 * 3) };
    const q2 = buildQueue({ cards: [f2, a], todayLogs: [], deckId: 'd', now: NOW, settings: S, notes: n2 });
    expect(q2.servable.has(a.id)).toBe(true);
  });
});

describe('句框卡面', () => {
  const note = { id: 'n_abc', lemma: 'Interdire ⬚ ne ferait que déplacer le problème.', meaningZh: '反事实：禁止只会把问题挪到别处', sentence: 'Interdire les téléphones ne ferait que déplacer le problème.', frame: FRAME } as unknown as Note;
  const s = { targetLang1: 'zh', sourceLang: 'fr' } as never;
  const html = (x: unknown) => renderToStaticMarkup(<>{x as never}</>);
  it('句框卡：正面功能，背面句框（⬚ 标出）和例句', () => {
    const v = cardView('frame', note, s, ['法语', '中文', '英文']);
    expect(html(v.question.text)).toContain('反事实');
    expect(html(v.question.text)).not.toContain('déplacer');
    expect(html(v.answers[0].text)).toContain('<span class="slot">⬚</span>');
    expect(v.answers[1].text).toBe(note.sentence);
    expect(v.answerFr).toBe(note.lemma);
  });
  it('套用卡：多一个主题，按复习次数轮换，同一张卡顺序固定', () => {
    const v = cardView('apply', note, s, ['法语', '中文', '英文'], 1);
    expect(html(v.question.text)).toContain('主题');
    expect(v.hint).toContain('写一整句');
    expect(pickTopic(note, 1)).toEqual(pickTopic(note, 1));
    expect(new Set([0, 1, 2, 3].map((i) => pickTopic(note, i).fr)).size).toBeGreaterThan(1);
    // 透镜 ① 推荐的主题：SOCIÉTÉ / ENVIRONNEMENT
    expect(['SOCIÉTÉ', 'ENVIRONNEMENT']).toContain(pickTopic(note, 0).theme);
    // T1 用信件场景
    expect(pickTopic({ id: 'x', frame: { ...FRAME, task: 'T1', lens: null } }, 0).theme).toBe('T1');
    expect(frameMeta(note)).toBe('T3 · ⑤ · ① 反事实');
  });
  it('排序：T3 标题 → ① … ⑨，再口语、T1', () => {
    const at = (task: string, slot: string) => ({ frame: { task, slot, lens: null, register: null }, createdAt: '2026' });
    const keys = [at('T1', 'T1-02'), at('T3', '⑨'), at('口语', '复述'), at('T3', '标题'), at('T3', '①')].map(frameSortKey).sort();
    expect(keys.map((x) => x.split('|').slice(0, 2).join('|'))).toEqual(['0|0', '0|10', '0|18', '1|2复述', '2|2T1-02']);
  });
});

describe('手册句框', () => {
  beforeEach(async () => { await clearAllLocalData(); });
  it('每条都有功能、例句、语法锁；例句是填好的句子；能通过校验', () => {
    expect(SEED_FRAMES.length).toBeGreaterThan(60);
    const lemmas = new Set<string>();
    for (const f of SEED_FRAMES) {
      expect(f.meaningZh, f.lemma).toBeTruthy();
      expect(f.sentence, f.lemma).toBeTruthy();
      expect(f.sentence, f.lemma).not.toMatch(/⬚/);
      expect(f.extra, f.lemma).toMatch(/^语法锁：./);
      expect(noteErrors({ lemma: f.lemma, sentence: f.sentence, cardTypes: ['frame'], intentZh: null, answerFr: null, promptFr: null, clozeHint: null, clozeSentence: null, altSentences: [], frame: f.frame }), f.lemma).toEqual([]);
      expect(lemmas.has(f.lemma), `重复：${f.lemma}`).toBe(false);
      lemmas.add(f.lemma);
    }
  });
  it('导入：有 ⬚ 的出句框卡 + 套用卡，固定表达只出句框卡；再导入跳过已有的', async () => {
    await getSettings();
    expect(await pendingStarterFrames()).toBe(SEED_FRAMES.length);
    expect(await importStarterFrames('d')).toBe(SEED_FRAMES.length);
    const notes = await db.notes.toArray();
    const cards = await db.cards.toArray();
    expect(notes.every((n) => n.frame && n.layer === 'core' && n.deckId === 'd')).toBe(true);
    const slots = SEED_FRAMES.filter((f) => hasSlots(f.lemma)).length;
    expect(cards.filter((c) => c.type === 'frame')).toHaveLength(SEED_FRAMES.length);
    expect(cards.filter((c) => c.type === 'apply')).toHaveLength(slots);
    expect(await pendingStarterFrames()).toBe(0);
    expect(await importStarterFrames('d')).toBe(0);
  });
});

describe('校验', () => {
  const base = { sentence: 'x', intentZh: null, answerFr: null, promptFr: null, clozeHint: null, clozeSentence: null, altSentences: [] };
  it('句框笔记不要求 {{…}}，只要求句框和卡型', () => {
    expect(noteErrors({ ...base, lemma: 'Sans ⬚, ⬚.', cardTypes: ['frame', 'apply'], frame: FRAME })).toEqual([]);
    expect(noteErrors({ ...base, lemma: ' ', cardTypes: ['frame'], frame: FRAME })).toContain('句框不能为空');
    expect(noteErrors({ ...base, lemma: 'x', cardTypes: [], frame: FRAME }).length).toBeGreaterThan(0);
  });
});
