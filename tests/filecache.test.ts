import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { answerCard, clearAllLocalData, deleteNotes, undoAnswer, updateNote, updateNotes } from '../src/db/actions';
import { clearFileCache, localFiles } from '../src/sync/files';
import { importLegacy, readLegacyBackup } from '../src/io/legacy';
import { makeLegacyBackup } from './legacyData';

beforeEach(async () => { await clearAllLocalData(); clearFileCache(); });

/** 缓存版本必须和从零序列化的结果逐字节一致 */
async function expectSameAsFresh() {
  const cached = await localFiles();
  clearFileCache();
  const fresh = await localFiles();
  expect([...cached.keys()].sort()).toEqual([...fresh.keys()].sort());
  for (const [rel, f] of fresh) expect(cached.get(rel), rel).toEqual(f);
}

describe('同步文件缓存', () => {
  it('作答、撤销、编辑、批量修改、删除之后，缓存结果与重新序列化一致', async () => {
    await importLegacy(readLegacyBackup(makeLegacyBackup(40)), 'zzz', {});
    await localFiles(); // 建立缓存
    const cards = await db.cards.toArray();
    const res = await answerCard(cards[0].id, 3);
    await expectSameAsFresh();
    await undoAnswer(res);
    await expectSameAsFresh();
    const notes = await db.notes.toArray();
    await updateNote(notes[1].id, { meaningZh: '改过' });
    await expectSameAsFresh();
    await updateNotes(notes.slice(2, 6).map((n) => n.id), (n) => ({ rot: (n.rot + 1) % 3 }));
    await expectSameAsFresh();
    await updateNote(notes[7].id, { createdAt: '2020-01-01T12:00:00.000+08:00' }); // 换月份：两个文件都变
    await expectSameAsFresh();
    await deleteNotes([notes[8].id]);
    await expectSameAsFresh();
  });
});
