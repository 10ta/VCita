// 当前版本的类型出口 + 文件迁移框架（与 TimeEncre 相同）。
// 以后出 v3：新建 v3.ts，把导出改指向它，在 migrations 里追加 { from: 2, to: 3, up }。
// 遇到比程序新的 schemaVersion 拒绝写入，提示刷新。
// 注：v1 是旧服务器版 VocabForge 的数据，不走文件迁移，由 io/legacy.ts 一次性导入。
import { z } from 'zod';
import {
  BundleFileV2, CardV2, CardsFileV2, DeckV2, LogsFileV2, NoteV2, NotesFileV2, ProfileFileV2, ReviewLogV2, SettingsV2,
} from './v2';

export { THEMES, CARD_STATES, CARD_TYPES } from './v2';
export const CURRENT_SCHEMA_VERSION = 2;

export const SettingsSchema = SettingsV2;
export type Deck = z.infer<typeof DeckV2>;
export type Note = z.infer<typeof NoteV2>;
export type Card = z.infer<typeof CardV2>;
export type ReviewLog = z.infer<typeof ReviewLogV2>;
export type Settings = z.infer<typeof SettingsV2>;
export type Theme = Note['tags'][number];
export type CardState = Card['state'];
export type BundleFile = z.infer<typeof BundleFileV2>;

type AnyFile = { schemaVersion: number; kind: string; [k: string]: unknown };
interface Migration { from: number; to: number; up: (file: AnyFile) => AnyFile }
const migrations: Migration[] = [];

export class SchemaTooNewError extends Error {
  constructor(public fileVersion: number) {
    super(`数据文件是 v${fileVersion}，当前程序只支持到 v${CURRENT_SCHEMA_VERSION}。请刷新页面更新到最新版本。`);
  }
}

export function migrateFile(raw: unknown): AnyFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('不是有效的数据文件（应为 JSON 对象）');
  let f = raw as AnyFile;
  let v = f.schemaVersion;
  if (typeof v !== 'number') throw new Error('数据文件缺少 schemaVersion');
  if (v > CURRENT_SCHEMA_VERSION) throw new SchemaTooNewError(v);
  while (v < CURRENT_SCHEMA_VERSION) {
    const m = migrations.find((x) => x.from === v);
    if (!m) throw new Error(`缺少从 v${v} 升级的迁移脚本`);
    f = { ...m.up(f), schemaVersion: m.to };
    v = m.to;
  }
  return f;
}

export const parseProfileFile = (raw: unknown) => ProfileFileV2.parse(migrateFile(raw));
export const parseNotesFile = (raw: unknown) => NotesFileV2.parse(migrateFile(raw));
export const parseCardsFile = (raw: unknown) => CardsFileV2.parse(migrateFile(raw));
export const parseLogsFile = (raw: unknown) => LogsFileV2.parse(migrateFile(raw));
export const parseBundle = (raw: unknown) => BundleFileV2.parse(migrateFile(raw));
export const parseNote = (raw: unknown) => NoteV2.parse(raw);
export const parseCard = (raw: unknown) => CardV2.parse(raw);
