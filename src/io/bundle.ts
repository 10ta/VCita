// 新格式单文件备份（schemaVersion 2）。导入按 LWW 逐条合并。
import { db } from '../db/db';
import { getSettings, putSettingsRaw } from '../db/actions';
import { CURRENT_SCHEMA_VERSION, parseBundle, type BundleFile } from '../schema';
import { fromIso, toIso } from '../lib/time';
import { mergeLww, type MergeCount } from './merge';

export async function exportBundle(): Promise<BundleFile> {
  const [decks, notes, cards, logs, settings] = await Promise.all([
    db.decks.toArray(), db.notes.toArray(), db.cards.toArray(), db.logs.toArray(), getSettings(),
  ]);
  // 墓碑也导出，合并时才能正确传播删除
  return { schemaVersion: CURRENT_SCHEMA_VERSION as 2, kind: 'bundle', app: 'VocabForge', exportedAt: toIso(Date.now()), decks, settings, notes, cards, logs };
}

export async function importBundle(raw: unknown): Promise<Record<'decks' | 'notes' | 'cards' | 'logs', MergeCount>> {
  const b = parseBundle(raw);
  return db.transaction('rw', [db.decks, db.notes, db.cards, db.logs, db.meta], async () => {
    const r = {
      decks: await mergeLww(db.decks, b.decks),
      notes: await mergeLww(db.notes, b.notes),
      cards: await mergeLww(db.cards, b.cards),
      logs: await mergeLww(db.logs, b.logs),
    };
    const cur = await getSettings();
    if (fromIso(b.settings.updatedAt) > fromIso(cur.updatedAt)) await putSettingsRaw(b.settings);
    return r;
  });
}
