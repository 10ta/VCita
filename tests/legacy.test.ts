import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { clearAllLocalData } from '../src/db/actions';
import { guessTheme, importLegacy, readLegacyBackup } from '../src/io/legacy';
import { makeLegacyBackup } from './legacyData';

beforeEach(async () => { await clearAllLocalData(); });

describe('导入旧版备份', () => {
  it('识别用户、标签，并猜主题', () => {
    const b = readLegacyBackup(makeLegacyBackup());
    expect(b.users.map((u) => [u.uid, u.name, u.cards.length])).toEqual([['zzz', 'ZZZ', 667]]);
    expect(b.users[0].tags.map((t) => t.name)).toEqual(['Police et Justice', 'médecine']);
    expect(guessTheme('Police et Justice')).toBe('SOCIÉTÉ');
    expect(guessTheme('médecine')).toBe('SANTÉ');
  });

  it('卡片数量不变，每张卡的调度字段与旧卡一致，复习历史转成日志', async () => {
    const raw = makeLegacyBackup();
    const b = readLegacyBackup(raw);
    const r = await importLegacy(b, 'zzz', { 'Police et Justice': 'SOCIÉTÉ', 'médecine': 'SANTÉ' });
    expect([r.notes.added, r.cards.added]).toEqual([667, 667]);
    const old = b.users[0].cards;
    const cards = await db.cards.toArray();
    for (const o of old) {
      const c = cards.find((x) => x.id === `c_${o.id}`)!;
      expect([c.state, c.interval, c.ease, c.lapses, c.reps]).toEqual([o.state, o.state === 'review' ? o.interval : 0, o.ease, o.lapses, o.reps]);
      if (o.state === 'review') expect(c.due.slice(0, 10)).toBe(o.due);
    }
    expect(await db.logs.count()).toBe(old.reduce((s, o) => s + (o.reviewHistory?.length ?? 0), 0));
    const note = await db.notes.get('n_old0');
    expect([note!.lemma, note!.meaningZh, note!.meaningEn, note!.tags, note!.deckId]).toEqual(['mot0', '词0', 'word0', ['SOCIÉTÉ'], 'd_default']);
    expect((await db.decks.toArray()).map((d) => d.name).sort()).toEqual(['A2', 'B1']);
  });

  it('再次导入同一份备份不产生任何变化，也不覆盖之后的复习进度', async () => {
    const b = readLegacyBackup(makeLegacyBackup());
    await importLegacy(b, 'zzz', {});
    const c = (await db.cards.get('c_old1'))!;
    await db.cards.put({ ...c, interval: 99, updatedAt: new Date().toISOString() });
    const r = await importLegacy(b, 'zzz', {});
    expect([r.notes.added + r.notes.updated, r.cards.added + r.cards.updated, r.logs.added + r.logs.updated]).toEqual([0, 0, 0]);
    expect((await db.cards.get('c_old1'))!.interval).toBe(99);
  });
});
