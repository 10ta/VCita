import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { addNotes, answerCard, clearAllLocalData, deleteNotes, groupContrast, leaveContrast, updateNote } from '../src/db/actions';

const live = async (noteId: string) => (await db.cards.where('noteId').equals(noteId).toArray()).filter((c) => !c.deleted).map((c) => c.type).sort();

describe('易混组', () => {
  beforeEach(() => clearAllLocalData());
  it('设为易混组：每条带例句的笔记加一张辨析卡；没有例句的跳过；已在组里的整组并进来', async () => {
    const [a, b, c, d] = await addNotes([
      { deckId: 'd', lemma: 'teinter', sentence: 'Ça va {{teinter}} tout.' },
      { deckId: 'd', lemma: 'colorer', sentence: 'Il {{colore}} le dessin.' },
      { deckId: 'd', lemma: 'nuancer', sentence: 'Il faut {{nuancer}} ce propos.' },
      { deckId: 'd', lemma: 'sans phrase', sentence: '' },
    ]);
    expect(await groupContrast([a.noteId, b.noteId, d.noteId])).toBe(2);
    expect(await live(a.noteId)).toEqual(['contrast', 'recognition']);
    expect(await live(d.noteId)).toEqual(['recognition']);
    const g = (await db.notes.get(a.noteId))!.contrastGroup;
    expect(await groupContrast([c.noteId, b.noteId])).toBe(3);
    expect((await db.notes.get(c.noteId))!.contrastGroup).toBe(g);
  });
  it('编辑保存不会丢辨析卡；移出 / 删除后只剩一条时整组解散', async () => {
    const [a, b] = await addNotes([
      { deckId: 'd', lemma: 'amende', sentence: 'une {{amende}}' },
      { deckId: 'd', lemma: 'amande', sentence: 'une {{amande}}' },
    ]);
    await groupContrast([a.noteId, b.noteId]);
    await updateNote(a.noteId, { contrastNote: '罚款' });
    expect(await live(a.noteId)).toEqual(['contrast', 'recognition']);
    await leaveContrast(a.noteId);
    expect(await live(a.noteId)).toEqual(['recognition']);
    expect((await db.notes.get(b.noteId))!.contrastGroup).toBeNull();
    expect(await live(b.noteId)).toEqual(['recognition']);

    const [x, y] = await addNotes([
      { deckId: 'd', lemma: 'x', sentence: '{{x}}' },
      { deckId: 'd', lemma: 'y', sentence: '{{y}}' },
    ]);
    await groupContrast([x.noteId, y.noteId]);
    await deleteNotes([x.noteId]);
    expect(await live(y.noteId)).toEqual(['recognition']);
  });
  it('作答走 FSRS（默认），日志照常写', async () => {
    const [a] = await addNotes([{ deckId: 'd', lemma: 'x', sentence: '{{x}}' }]);
    const r = await answerCard(a.cardId, 3);
    expect(r.after.state).toBe('learning');
    expect(await db.logs.count()).toBe(1);
  });
});
