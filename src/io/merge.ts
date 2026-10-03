// "较新者胜出"（LWW）合并，与 TimeEncre 相同。同步和备份导入共用。
import { fromIso } from '../lib/time';

export interface MergeCount { added: number; updated: number; kept: number }
export interface BulkTable<Row> {
  bulkGet(ids: string[]): Promise<(Row | undefined)[]>;
  bulkPut(items: Row[]): Promise<unknown>;
}

export async function mergeLww<T extends { id: string; updatedAt: string }>(table: BulkTable<T>, items: T[]): Promise<MergeCount> {
  const count: MergeCount = { added: 0, updated: 0, kept: 0 };
  const existing = await table.bulkGet(items.map((x) => x.id));
  const puts: T[] = [];
  items.forEach((item, i) => {
    const cur = existing[i];
    if (!cur) { count.added++; puts.push(item); }
    else if (fromIso(item.updatedAt) > fromIso(cur.updatedAt)) { count.updated++; puts.push(item); }
    else count.kept++;
  });
  await table.bulkPut(puts);
  return count;
}
