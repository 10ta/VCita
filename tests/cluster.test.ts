import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { addNotes, clearAllLocalData, clusterRecall } from '../src/db/actions';
import { maskLabel } from '../src/schema/validate';
import { fromIso, toIso } from '../src/lib/time';

const DAY = 86_400_000;

describe('表达群', () => {
  beforeEach(async () => { await clearAllLocalData(); });

  it('遮住的答案：虚词照常显示，实词只留首字母', () => {
    expect(maskLabel('une écrasante majorité de')).toBe('une é________ m_______ de');
    expect(maskLabel("le sens de l'humour")).toBe("le s___ de l'h_____");
    expect(maskLabel('figé (de peur) ; pétrifié')).toBe('f___');
    expect(maskLabel('bon nombre de qqch')).toBe('b__ n_____ de qqch');
  });

  it('新建笔记保留用法和表达群', async () => {
    const [r] = await addNotes([{ deckId: 'd', lemma: 'nombre de', sentence: '{{Nombre d\'}}étudiants.', usage: 'nombre de + 复数名词：很多', cluster: '说「很多」' }]);
    expect(await db.notes.get(r.noteId)).toMatchObject({ usage: 'nombre de + 复数名词：很多', cluster: '说「很多」' });
  });

  it('想起来了：认读卡记一次隐性良好、往后推；没想起来：只记日期，不动排期', async () => {
    const [r] = await addNotes([{ deckId: 'd', lemma: 'sidéré', sentence: 'Je suis resté {{sidéré}}.', cluster: '惊呆' }]);
    const rec = (await db.cards.where('noteId').equals(r.noteId).toArray())[0];
    const now = Date.now();
    await db.cards.put({ ...rec, state: 'review', interval: 10, reps: 3, due: toIso(now + 4 * DAY), lastReviewedAt: toIso(now - 6 * DAY) });

    expect(await clusterRecall(r.noteId, false)).toBe('marked');
    expect(await clusterRecall(r.noteId, false)).toBe('marked');
    const n = (await db.notes.get(r.noteId))!;
    expect(n.recallMisses).toEqual([toIso(now).slice(0, 10)]);
    expect((await db.cards.get(rec.id))!.due).toBe(toIso(now + 4 * DAY));
    expect(await db.logs.count()).toBe(0);

    expect(await clusterRecall(r.noteId, true)).toBe('credited');
    const after = (await db.cards.get(rec.id))!;
    expect(fromIso(after.due)).toBeGreaterThan(now + 4 * DAY);
    expect((await db.logs.toArray())[0]).toMatchObject({ implicit: true, rating: 3 });
    // 同一天再点不会重复推
    expect(await clusterRecall(r.noteId, true)).toBe('skipped');
  });

  it('认读卡还没进复习：想起来了也不动', async () => {
    const [r] = await addNotes([{ deckId: 'd', lemma: 'figé', sentence: 'Il est resté {{figé}}.', cluster: '惊呆' }]);
    expect(await clusterRecall(r.noteId, true)).toBe('skipped');
    expect(await db.logs.count()).toBe(0);
  });
});

describe('表达群的意思', () => {
  it('括号里带法语的去掉，免得露出答案', async () => {
    const { firstMeaning } = await import('../src/features/review/ClusterStrip');
    const n = (meaningZh: string) => ({ meaningZh, meaningEn: 'x' }) as never;
    expect(firstMeaning(n('铺天盖地的指控（un déluge de … 大量的……）'))).toBe('铺天盖地的指控');
    expect(firstMeaning(n('（惊讶得）缓不过神来（ne pas en revenir）'))).toBe('（惊讶得）缓不过神来');
    expect(firstMeaning(n('压倒性的多数；écrasant：压倒性的'))).toBe('压倒性的多数');
  });
});
