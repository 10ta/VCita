// 新格式单文件备份（schemaVersion 2）。导入按 LWW 逐条合并。
import { db } from '../db/db';
import { getSettings, putSettingsRaw } from '../db/actions';
import { CURRENT_SCHEMA_VERSION, parseBundle, type BundleFile } from '../schema';
import { fromIso, toIso } from '../lib/time';
import { mergeLww, type MergeCount } from './merge';

export async function exportBundle(): Promise<BundleFile> {
  const [decks, notes, cards, logs, settings, clips, texts, encounters, known] = await Promise.all([
    db.decks.toArray(), db.notes.toArray(), db.cards.toArray(), db.logs.toArray(), getSettings(), db.clips.toArray(),
    db.texts.toArray(), db.encounters.toArray(), db.known.toArray(),
  ]);
  // 墓碑也导出，合并时才能正确传播删除
  return { schemaVersion: CURRENT_SCHEMA_VERSION as 2, kind: 'bundle', app: 'VCita', exportedAt: toIso(Date.now()), decks, settings, notes, cards, logs, clips, texts, encounters, known };
}

export async function importBundle(raw: unknown): Promise<Record<'decks' | 'notes' | 'cards' | 'logs' | 'clips' | 'texts' | 'encounters' | 'known', MergeCount>> {
  const b = parseBundle(raw);
  return db.transaction('rw', [db.decks, db.notes, db.cards, db.logs, db.clips, db.texts, db.encounters, db.known, db.meta], async () => {
    const r = {
      decks: await mergeLww(db.decks, b.decks),
      notes: await mergeLww(db.notes, b.notes),
      cards: await mergeLww(db.cards, b.cards),
      logs: await mergeLww(db.logs, b.logs),
      clips: await mergeLww(db.clips, b.clips),
      texts: await mergeLww(db.texts, b.texts),
      encounters: await mergeLww(db.encounters, b.encounters),
      known: await mergeLww(db.known, b.known),
    };
    const cur = await getSettings();
    if (fromIso(b.settings.updatedAt) > fromIso(cur.updatedAt)) await putSettingsRaw(b.settings);
    return r;
  });
}

const IMPORT_LABELS = { notes: '笔记', cards: '卡片', logs: '复习记录', decks: '牌组', clips: '摘句', texts: '短文', encounters: '遇见', known: '认识' } as const;
/** 导入结果的提示：列出每个有变化的表。只改卡片的包（如批量暂停）也看得到「卡片更新 N」；全都没变时说明原因 */
export function describeImport(r: Record<keyof typeof IMPORT_LABELS, MergeCount>): string {
  const parts = (Object.keys(IMPORT_LABELS) as Array<keyof typeof IMPORT_LABELS>)
    .filter((k) => r[k] && (r[k].added || r[k].updated))
    .map((k) => `${IMPORT_LABELS[k]}新增 ${r[k].added}、更新 ${r[k].updated}`);
  return parts.length ? `导入完成：${parts.join(' · ')}` : '导入完成：没有变化（本地的记录一样新或更新）';
}
