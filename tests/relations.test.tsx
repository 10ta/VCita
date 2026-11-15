// 话题、关联、合并笔记
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { planMerge } from '../src/lib/merge';
import { Related, topicMates } from '../src/features/review/Related';
import { topicList } from '../src/features/noteform/model';
import { parseNote, type Card, type Note } from '../src/schema';
import { addNotes, clearAllLocalData, mergeNotes } from '../src/db/actions';
import { db } from '../src/db/db';
import { serialize } from '../src/sync/files';

const T = '2026-11-15T00:00:00.000Z';
const note = (id: string, over: Partial<Note> = {}): Note => parseNote({ id, deckId: 'd', createdAt: T, updatedAt: T, lemma: id, ...over });
const card = (id: string, noteId: string, type: Card['type'], reps = 0): Card => ({
  id, noteId, deckId: 'd', createdAt: T, type, state: reps ? 'review' : 'new', due: T, interval: reps, ease: 2.5, reps, lapses: 0, step: 0,
  lastReviewedAt: null, isLeech: false, suspended: false, updatedAt: T, deleted: false,
} as Card);

describe('话题', () => {
  it('输入用、，分开，去重；空的不写这个键', () => {
    expect(topicList('能力、做不到，能力')).toEqual(['能力', '做不到']);
    expect(topicList('  ')).toBeUndefined();
    expect(serialize(note('x'))).not.toContain('topics');
  });
  const capable = note('capable', { lemma: "Je n'ai pas été capable de", topics: ['能力'], cluster: '能力够不够' });
  const hauteur = note('hauteur', { lemma: 'être à la hauteur de qqch', topics: ['能力'], cluster: '能力够不够' });
  const beau = note('beau', { lemma: "j'ai beau faire", meaningZh: '怎么努力也没用', topics: ['能力'] });
  const inne = note('inne', { lemma: 'inné(e)', meaningZh: '天生的', topics: ['能力', '天赋'] });
  it('同话题的其他卡；同表达群的不重复列（它们在表达群回想里）', () => {
    expect(topicMates(capable, [capable, hauteur, beau, inne])[0].mates.map((n) => n.id)).toEqual(['inne', 'beau']);
  });
  it('关联块只在有话题或易混组时出现', () => {
    expect(renderToStaticMarkup(<Related note={capable} notes={[capable, hauteur, beau, inne]} />)).toContain('话题 · 能力');
    expect(renderToStaticMarkup(<Related note={note('solo')} notes={[capable]} />)).toBe('');
  });
});

describe('合并的规划', () => {
  const keep = note('k', { lemma: 'reconnaître qqch', meaningZh: '承认', sentence: 'Il {{reconnaît ses erreurs}}.', cardTypes: ['recognition'], cluster: '承认、坦白' });
  const other = note('o', {
    lemma: 'reconnaître son implication dans qqch', meaningZh: '承认参与其中', usage: 'reconnaître son implication dans qqch：承认参与了…',
    sentence: 'Trois suspects {{reconnaissent leur implication}}.', promptFr: 'Trois suspects {{admettent avoir participé}}.', answerFr: 'Trois suspects {{reconnaissent leur implication}}.',
    intentZh: '读新闻', cardTypes: ['recognition', 'production'], topics: ['法律'], layer: 'core',
  });
  const cards = [card('kr', 'k', 'recognition', 5), card('or', 'o', 'recognition', 2), card('op', 'o', 'production', 3)];
  const plan = planMerge(keep, [other], cards);
  it('例句和产出题变成轮换版本；保留笔记没有产出题时并进来的那道当主题', () => {
    expect(plan.patch.altSentences).toEqual(['Trois suspects {{reconnaissent leur implication}}.']);
    expect(plan.patch.answerFr).toBe('Trois suspects {{reconnaissent leur implication}}.');
    expect(plan.patch.altIntents).toEqual([]);
    expect(plan.patch.cardTypes).toEqual(['recognition', 'production']);
  });
  it('用法列进补充的「高频」；话题、层级、表达群合并', () => {
    expect(plan.patch.extra).toBe('高频：reconnaître son implication dans qqch：承认参与了…');
    expect(plan.patch.topics).toEqual(['法律']);
    expect(plan.patch.layer).toBe('core');
    expect(plan.patch.cluster).toBe('承认、坦白');
  });
  it('保留笔记没有的卡型连卡挪过来，其余打墓碑', () => {
    expect(plan.move.map((c) => [c.id, c.noteId])).toEqual([['op', 'k']]);
    expect(plan.drop.map((c) => [c.id, c.deleted])).toEqual([['or', true]]);
  });
});

describe('合并（数据库）', () => {
  beforeEach(() => clearAllLocalData());
  it('被并的笔记删除，产出卡挪到保留的笔记下，复习记录跟着卡', async () => {
    const [a, b] = await addNotes([
      { deckId: 'd', lemma: 'reconnaître ses erreurs', meaningZh: '承认错误', sentence: 'Il {{reconnaît ses erreurs}}.' },
      { deckId: 'd', lemma: 'reconnaître son implication', meaningZh: '承认参与', sentence: 'Ils {{reconnaissent leur implication}}.', promptFr: 'Ils {{admettent avoir participé}}.', answerFr: 'Ils {{reconnaissent leur implication}}.', intentZh: '新闻', cardTypes: ['recognition', 'production'] },
    ] as never);
    const prod = (await db.cards.where('noteId').equals(b.noteId).toArray()).find((c) => c.type === 'production')!;
    const r = await mergeNotes(a.noteId, [b.noteId]);
    expect(r).toEqual({ moved: 1, dropped: 1 });
    expect((await db.notes.get(b.noteId))?.deleted).toBe(true);
    const moved = await db.cards.get(prod.id);
    expect([moved?.noteId, moved?.deleted]).toEqual([a.noteId, false]);
    const kept = await db.notes.get(a.noteId);
    expect(kept?.cardTypes).toContain('production');
    expect(kept?.altSentences).toEqual(['Ils {{reconnaissent leur implication}}.']);
    const live = (await db.cards.where('noteId').equals(a.noteId).toArray()).filter((c) => !c.deleted);
    expect(live.map((c) => c.type).sort()).toEqual(['production', 'recognition']);
  });
});
