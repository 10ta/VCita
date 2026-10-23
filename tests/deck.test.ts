import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { clearAllLocalData, mergeDeck } from '../src/db/actions';
import { seedData } from './seedData';

beforeEach(async () => { await clearAllLocalData(); });

describe('合并牌组', () => {
  it('笔记和卡片改归属，进度和日志不变，源牌组打墓碑', async () => {
    await seedData(10);
    await db.notes.update('n_old1', { deckId: 'd_a2' });
    await db.cards.update('c_old1', { deckId: 'd_a2' });
    const before = await db.cards.get('c_old1');
    const logs = await db.logs.count();
    expect(await mergeDeck('d_a2', 'd_default')).toBe(1);
    const after = await db.cards.get('c_old1');
    expect(after!.deckId).toBe('d_default');
    expect([after!.state, after!.interval, after!.due, after!.ease]).toEqual([before!.state, before!.interval, before!.due, before!.ease]);
    expect(after!.updatedAt > before!.updatedAt).toBe(true);
    expect((await db.notes.get('n_old1'))!.deckId).toBe('d_default');
    expect((await db.decks.get('d_a2'))!.deleted).toBe(true);
    expect(await db.logs.count()).toBe(logs);
    expect(await db.cards.where('deckId').equals('d_a2').count()).toBe(0);
  });
});
