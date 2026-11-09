import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { addClip, clearAllLocalData } from '../src/db/actions';
import { exportBundle, importBundle } from '../src/io/bundle';
import { bundleText, compactBundle, gzip, readBackupText } from '../src/io/pack';
import { parseBundle } from '../src/schema';
import { seedData } from './seedData';

const tables = ['decks', 'notes', 'cards', 'logs', 'clips', 'texts', 'encounters', 'known'] as const;
const sorted = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : 1));

describe('smaller backups', () => {
  it('drops default-valued fields and restores them on import', async () => {
    await clearAllLocalData();
    await seedData(30);
    await addClip({ kind: 'expr', text: 'mettre la main à la pâte', context: null, source: null });
    const full = await exportBundle();
    const small = compactBundle(full) as Record<string, Array<Record<string, unknown>>>;
    // 默认值字段确实不写了
    expect(small.notes.every((n) => !('promptFr' in n) && !('altIntents' in n) && !('deleted' in n))).toBe(true);
    expect(bundleText(full).length).toBeLessThan(JSON.stringify(full, null, 2).length * 0.6);
    // 解析后和原备份一模一样
    const a = parseBundle(JSON.parse(bundleText(full)));
    const b = parseBundle(full);
    for (const t of tables) expect(sorted(a[t] as never[]), t).toEqual(sorted(b[t] as never[]));
    // 导进空库再导出，和原来一样
    await clearAllLocalData();
    await importBundle(JSON.parse(bundleText(full)));
    const again = parseBundle(await exportBundle());
    for (const t of tables) expect(sorted(again[t] as never[]), t).toEqual(sorted(b[t] as never[]));
    expect(await db.notes.count()).toBe(full.notes.length);
  });

  it('reads gzip and plain files alike', async () => {
    const text = JSON.stringify({ hello: 'café ✓' });
    expect(await readBackupText(await gzip(text))).toBe(text);
    expect(await readBackupText(new Blob([text]))).toBe(text);
  });
});
