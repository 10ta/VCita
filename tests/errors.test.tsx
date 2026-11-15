// TCF 错题：错题来源排最前、改写对卡、义项、错题挖点的复制格式
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildQueue } from '../src/srs/queue';
import { retentionFor } from '../src/srs/scheduler';
import { cardView, Cues } from '../src/features/CardFace';
import { errBlock, errReady, type ErrDraft } from '../src/features/add/MineErrors';
import { contextLines, fromNote, otherFields } from '../src/features/noteform/model';
import { noteErrors } from '../src/schema/validate';
import { addNotes, clearAllLocalData, getSettings } from '../src/db/actions';
import { exportBundle, importBundle } from '../src/io/bundle';
import { db } from '../src/db/db';
import { serialize } from '../src/sync/files';
import { parseNote, type Card, type Note } from '../src/schema';
import { toIso } from '../src/lib/time';

const NOW = new Date(2026, 10, 15, 15, 0).getTime();
let k = 0;
const card = (noteId: string, over: Partial<Card> = {}): Card => ({
  id: `c${++k}`, noteId, deckId: 'd', createdAt: toIso(NOW - 86400000 * 10 + k * 1000), type: 'recognition',
  state: 'new', due: toIso(NOW - 3600000), interval: 0, ease: 2.5, reps: 0, lapses: 0, step: 0,
  lastReviewedAt: null, isLeech: false, suspended: false, updatedAt: toIso(0), deleted: false, ...over,
});
const meta = (origin: Note['origin']) => ({ layer: 'mid' as const, tags: [], origin });

describe('错题卡进队列', () => {
  // 错题卡最早添加：按来源拆时挖矿卡"越新越先"，没有错题优先的话它会排在最后
  const err = card('e');
  const mined = [card('m1'), card('m2')];
  const list = [card('l1'), card('l2')];
  const notes = new Map<string, ReturnType<typeof meta>>([['e', meta('error')], ['m1', meta('mined')], ['m2', meta('mined')], ['l1', meta('list')], ['l2', meta('list')]]);
  const first = (newSplit: 'source' | 'recent' | 'off', newPerDay = 3) =>
    buildQueue({ cards: [...list, ...mined, err], todayLogs: [], deckId: 'd', now: NOW, settings: { newPerDay, reviewsPerDay: 0, dayStartHour: 4, newSplit, freshShare: 60 }, notes }).next?.noteId;

  it('按来源拆：错题算新鲜那一份，排在挖矿卡前面', () => expect(first('source')).toBe('e'));
  it('不拆、按添加时间拆：错题也排最前', () => {
    expect(first('off')).toBe('e');
    expect(first('recent')).toBe('e');
  });
  it('每日只剩一张新卡时给错题', () => expect(first('source', 1)).toBe('e'));
});

const PARA: NonNullable<Note['paraphrase']> = {
  question: 'Quel constat est dressé à propos de ce syndrome ?',
  answer: 'Son existence doit être officialisée.',
  bridge: 'reconnu 官方承认 = officialiser',
  wrong: 'Son traitement est peu efficace',
  trap: 'common-sense', root: 'sense',
};
const SENT = "C'est le mal du siècle et pourtant, il n'est {{pas encore reconnu}}.";

describe('改写对卡', () => {
  beforeEach(async () => { await clearAllLocalData(); });

  it('正面原文句 + 题干，背面正确选项、桥、错选和陷阱', async () => {
    const s = await getSettings();
    const note = { lemma: 'ne pas être reconnu', sentence: SENT, paraphrase: PARA, cardTypes: ['paraphrase'] } as unknown as Note;
    const v = cardView('paraphrase', note, s, ['法语', '中文', '英文']);
    const q = renderToStaticMarkup(<>{v.question.text}</>);
    expect(q).toContain('<b class="cloze">pas encore reconnu</b>');
    expect(q).toContain(PARA.question);
    const a = renderToStaticMarkup(<>{v.answers.map((x, i) => <div key={i}>{x.text}</div>)}</>);
    expect(a).toContain(PARA.answer);
    expect(a).toContain('桥：reconnu');
    expect(a).toContain('当时错选');
    expect(a).toContain('常识替换');
    expect(a).toContain('根因：义项');
    expect(v.hint).toMatch(/作者断言/);
  });

  it('按认读类的目标保持率排期', () => {
    expect(retentionFor('paraphrase', { desiredRetention: 0.9, retentionRecognition: 0.85 })).toBe(0.85);
  });

  it('校验：原文句要标出部分，要有题干和正确选项，只出改写卡', () => {
    const base = { lemma: 'x', sentence: SENT, cardTypes: ['paraphrase'] as Card['type'][], intentZh: null, answerFr: null, paraphrase: PARA };
    expect(noteErrors(base)).toEqual([]);
    expect(noteErrors({ ...base, sentence: 'pas de marque' })).toHaveLength(1);
    expect(noteErrors({ ...base, paraphrase: { ...PARA, answer: ' ' } })).toEqual(['正确选项不能为空']);
    expect(noteErrors({ ...base, cardTypes: ['paraphrase', 'recognition'] })).toEqual(['改写对笔记只生成改写卡']);
  });

  it('导出再导入：改写对、错题来源、义项原样保留', async () => {
    await db.decks.put({ id: 'd', name: 'd', order: 0, updatedAt: toIso(NOW), deleted: false });
    await addNotes([
      { deckId: 'd', lemma: 'ne pas être reconnu', sentence: SENT, paraphrase: PARA, cardTypes: ['paraphrase'], origin: 'error' },
      { deckId: 'd', lemma: 'la raison', sentence: 'Il faut écouter {{la raison}}.', sense: '理性（≠ 原因）', origin: 'error', etymology: 'x' },
    ]);
    const b = JSON.parse(JSON.stringify(await exportBundle()));
    await clearAllLocalData();
    await importBundle(b);
    const notes = (await db.notes.toArray()).filter((n) => !n.deleted);
    const p = notes.find((n) => n.paraphrase)!;
    expect(p.paraphrase).toEqual(PARA);
    expect(p.origin).toBe('error');
    expect(notes.find((n) => n.sense)!.sense).toBe('理性（≠ 原因）');
    const cards = await db.cards.where('noteId').equals(p.id).toArray();
    expect(cards.map((c) => c.type)).toEqual(['paraphrase']);
  });
});

describe('义项', () => {
  it('背面最先显示义项', () => {
    const html = renderToStaticMarkup(<Cues note={{ sense: '理性（≠ 原因）', usage: 'u', etymology: 'e' } as unknown as Note} />);
    expect(html.indexOf('义项 · 理性')).toBeGreaterThan(-1);
    expect(html.indexOf('义项')).toBeLessThan(html.indexOf('用法'));
  });
  it('没有义项、改写对的旧笔记，同步文件和以前一字不差', () => {
    const raw = { id: 'n', deckId: 'd', createdAt: toIso(0), updatedAt: toIso(0), lemma: 'a', sentence: '{{a}}' };
    const n = parseNote(raw);
    expect('sense' in n).toBe(false);
    expect('paraphrase' in n).toBe(false);
    expect(serialize(n)).not.toMatch(/sense|paraphrase/);
  });
});

describe('其他语境', () => {
  const note = { sense: '机构（≠ 建立）', contexts: ['un établissement scolaire → 学校', "l'établissement des faits → 确立"] } as unknown as Note;
  it('认读 / 挖空卡背面列出，产出类（只显示补充）不列', () => {
    const all = renderToStaticMarkup(<Cues note={note} />);
    expect(all).toContain('其他语境');
    expect(all).toContain('↳ un établissement scolaire → 学校');
    expect(renderToStaticMarkup(<Cues note={note} only="extra" />)).not.toContain('其他语境');
  });
  it('表单里一行一条；清空后不留空数组，没写过的笔记不多出键', () => {
    expect(contextLines(' a → x \n\n b → y ')).toEqual(['a → x', 'b → y']);
    expect(contextLines('  \n ')).toBeUndefined();
    const n = parseNote({ id: 'n', deckId: 'd', createdAt: toIso(0), updatedAt: toIso(0), lemma: 'a', sentence: '{{a}}' });
    const out = JSON.parse(JSON.stringify(otherFields(fromNote(n, 'list'))));
    expect('sense' in out || 'contexts' in out).toBe(false);
  });
});

describe('错题挖点的复制格式', () => {
  const e: ErrDraft = { id: 'x', source: 'TCF CE · 第 12 套', question: 'Quel constat ?', sentence: "il n'est pas encore reconnu.", answer: 'Son existence doit être officialisée.', wrong: 'Son traitement est peu efficace', why: '以为 reconnu\n是"治好"', trip: '' };
  it('一道题一段，空栏不写，换行压成一行', () => {
    expect(errBlock(e, 0)).toBe([
      'ERR 1', '出处：TCF CE · 第 12 套', '题干：Quel constat ?', "原文：il n'est pas encore reconnu.",
      '正确：Son existence doit être officialisée.', '我选：Son traitement est peu efficace', '为什么：以为 reconnu 是"治好"',
    ].join('\n'));
  });
  it('至少要有原文句、正确选项和错选', () => {
    expect(errReady(e)).toBe(true);
    expect(errReady({ ...e, wrong: '' })).toBe(false);
  });
});
