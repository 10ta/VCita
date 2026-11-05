// 本地数据库（IndexedDB）。它是唯一的数据源；GitHub 数据仓库是它的同步副本。
import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Card, Clip, Deck, Encounter, Known, Note, ReviewLog, Text } from '../schema';

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface CacheRow {
  key: string;
  value: unknown;
  /** 写入时间（毫秒） */
  at: number;
}

class VocabDb extends Dexie {
  decks!: EntityTable<Deck, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  logs!: EntityTable<ReviewLog, 'id'>;
  meta!: Table<MetaRow, string>;
  clips!: EntityTable<Clip, 'id'>;
  texts!: EntityTable<Text, 'id'>;
  encounters!: EntityTable<Encounter, 'id'>;
  known!: EntityTable<Known, 'id'>;
  /** 查词 / 翻译结果的本机缓存（不同步） */
  cache!: Table<CacheRow, string>;

  constructor() {
    super('vcita');
    // 本地索引结构的版本，和数据文件的 schemaVersion 是两回事
    this.version(1).stores({
      decks: 'id',
      notes: 'id, deckId, createdAt',
      cards: 'id, noteId, deckId, due, state',
      logs: 'id, cardId, noteId, day',
      meta: 'key',
    });
    // v2：摘句篮、查词缓存
    this.version(2).stores({ clips: 'id, createdAt, status', cache: 'key' });
    // v3：阅读页的文章、遇见记录、手动标记的认识词
    this.version(3).stores({ texts: 'id, createdAt', encounters: 'id, key, textId, createdAt', known: 'id' });
  }
}

export const db = new VocabDb();
