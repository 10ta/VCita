// 本地数据库（IndexedDB）。它是唯一的数据源；GitHub 数据仓库是它的同步副本。
import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Card, Deck, Note, ReviewLog } from '../schema';

export interface MetaRow {
  key: string;
  value: unknown;
}

class VocabDb extends Dexie {
  decks!: EntityTable<Deck, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  logs!: EntityTable<ReviewLog, 'id'>;
  meta!: Table<MetaRow, string>;

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
  }
}

export const db = new VocabDb();
