import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { addNote, bumpUsed, clearAllLocalData, updateNote } from '../src/db/actions';
import { noteErrors, defaultCardTypes } from '../src/schema/validate';
import { parseImportLines } from '../src/io/lines';
import { computeStats } from '../src/srs/stats';
import type { Card, ReviewLog } from '../src/schema';
import { studyDay, toIso } from '../src/lib/time';

beforeEach(async () => { await clearAllLocalData(); });
const live = async (noteId: string) => (await db.cards.where('noteId').equals(noteId).toArray()).filter((c) => !c.deleted);

describe('卡型', () => {
  it('校验规则', () => {
    const base = { lemma: '', sentence: '', cardTypes: ['recognition'] as Card['type'][], intentZh: null, answerFr: null };
    expect(noteErrors({ ...base, lemma: 'repère' })).toEqual([]); // 旧卡：只有单词也行
    expect(noteErrors({ ...base, sentence: 'perdu leurs repères' })).toContain('例句里要用 {{…}} 标出考查的部分');
    expect(noteErrors({ ...base, sentence: 'leurs {{repères}}', cardTypes: ['cloze'] })).toEqual([]);
    expect(noteErrors({ ...base, lemma: 'x', cardTypes: ['production'] })).toContain('产出卡需要填写"中文意图"和"法语答案"');
    expect(defaultCardTypes('core')).toEqual(['recognition', 'production']);
  });

  it('加上产出卡 → 新建一张；去掉 → 墓碑；再加回来 → 恢复原来那张，进度保留', async () => {
    const { noteId } = await addNote({ deckId: 'd', lemma: 'repère' });
    expect((await live(noteId)).map((c) => c.type)).toEqual(['recognition']);
    await updateNote(noteId, { cardTypes: ['recognition', 'production'], intentZh: '失去方向感', answerFr: 'perdre ses repères' });
    const prod = (await live(noteId)).find((c) => c.type === 'production')!;
    expect(prod.state).toBe('new');
    await db.cards.put({ ...prod, state: 'review', interval: 9 });
    await updateNote(noteId, { cardTypes: ['recognition'] });
    expect((await live(noteId)).map((c) => c.type)).toEqual(['recognition']);
    await updateNote(noteId, { cardTypes: ['recognition', 'production'] });
    const back = (await live(noteId)).find((c) => c.type === 'production')!;
    expect([back.id, back.interval]).toEqual([prod.id, 9]);
  });

  it('改牌组：所有卡跟着走', async () => {
    const { noteId } = await addNote({ deckId: 'd', lemma: 'x', sentence: 'a {{x}}', cardTypes: ['recognition', 'cloze'] });
    await updateNote(noteId, { deckId: 'e' });
    expect((await live(noteId)).map((c) => c.deckId)).toEqual(['e', 'e']);
  });

  it('"用上了"计数', async () => {
    const { noteId } = await addNote({ deckId: 'd', lemma: 'x' });
    await bumpUsed(noteId); await bumpUsed(noteId);
    const n = (await db.notes.get(noteId))!;
    expect([n.usedCount, n.usedAt.length]).toEqual([2, 2]);
  });
});

describe('批量导入解析', () => {
  it('字段、主题、错误行', () => {
    const r = parseImportLines([
      '# 注释',
      'Les enfants ont perdu leurs {{repères}}. | 熟悉的参照 | bearings | InnerFrench 12 | societe',
      '',
      'Il faut {{tenir compte de}} ça | 考虑',
      'pas de marque | x',
    ].join('\n'));
    expect(r.map((x) => [x.line, x.lemma, x.error])).toEqual([[2, 'repères', null], [4, 'tenir compte de', null], [5, '', '句子里要用 {{…}} 标出考查的部分']]);
    expect([r[0].meaningZh, r[0].meaningEn, r[0].source, r[0].tags]).toEqual(['熟悉的参照', 'bearings', 'InnerFrench 12', ['SOCIÉTÉ']]);
  });
});

describe('统计', () => {
  it('保持率按复习日志手算可核对；成熟 / 年轻分开', () => {
    const now = new Date(2026, 9, 3, 15).getTime();
    const day = studyDay(now, 4);
    const card = { id: 'c', noteId: 'n', deckId: 'd', deleted: false, suspended: false, isLeech: false, state: 'review', due: toIso(now + 3 * 86400000) } as Card;
    const log = (rating: number, prevInterval: number, i: number) => ({ id: `l${i}`, cardId: 'c', noteId: 'n', day, rating, prevState: 'review', prevInterval, deleted: false } as ReviewLog);
    // 年轻：3 次通过 1 次忘记 → 75%；成熟：2 次全通过 → 100%
    const logs = [log(3, 5, 1), log(2, 5, 2), log(4, 5, 3), log(1, 5, 4), log(3, 30, 5), log(3, 25, 6)];
    const s = computeStats({ cards: [card], notes: [], logs, now, dayStartHour: 4 });
    expect([s.young.rate, s.mature.rate, s.all.pass, s.all.total]).toEqual([0.75, 1, 5, 6]);
    expect(s.forecast[3]).toBe(1);
  });
});
