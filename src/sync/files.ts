// 本地数据 ⇄ 仓库文件（结构沿用 TimeEncre）。
// 序列化是确定性的（固定键顺序、固定排序、2 空格缩进）：同样的数据永远得到同样的文本，
// 所以能用 git blob SHA 判断"本地改了没有""远端改了没有"，GitHub 上的 diff 也可读。
//
// 仓库布局（路径相对于数据目录）：
//   profile.json              牌组、设置
//   notes/2026-09.json        笔记，按创建月份
//   cards/2026-09.json        卡片调度状态，按所属笔记的创建月份
//   logs/2026-10/02.json      复习日志，按学习日。每次同步只会改当天这一个日志文件
import { db } from '../db/db';
import { getSettings, putSettingsRaw } from '../db/actions';
import { CURRENT_SCHEMA_VERSION, parseCardsFile, parseLogsFile, parseNotesFile, parseProfileFile } from '../schema';
import { mergeLww } from '../io/merge';
import { fromIso, monthOf } from '../lib/time';
import { sha1Hex } from '../lib/sha1';

const KEY_ORDER = [
  'schemaVersion', 'kind', 'month', 'day', 'id', 'name', 'order',
  'deckId', 'noteId', 'cardId', 'type', 'createdAt',
  'lemma', 'sentence', 'meaningZh', 'meaningEn', 'cueFamily', 'intentZh', 'hint', 'answerFr', 'extra', 'source',
  'layer', 'cardTypes', 'tags', 'usedCount', 'rot',
  'state', 'due', 'interval', 'ease', 'reps', 'lapses', 'step', 'lastReviewedAt', 'isLeech', 'suspended',
  'ts', 'rating', 'prevState', 'newState', 'prevInterval', 'newInterval', 'prevEase', 'newEase', 'prevDue', 'newDue', 'elapsedMs',
  'updatedAt', 'deleted', 'legacy', 'decks', 'settings', 'notes', 'cards', 'logs',
];
const rank = (k: string) => {
  const i = KEY_ORDER.indexOf(k);
  return i < 0 ? KEY_ORDER.length : i;
};

export function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = canonicalize((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

export const serialize = (obj: unknown): string => JSON.stringify(canonicalize(obj), null, 2) + '\n';

/** 与 `git hash-object` 相同的 blob SHA-1 */
export async function gitBlobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(head.length + body.length);
  buf.set(head);
  buf.set(body, head.length);
  // http://局域网IP 这类非安全上下文没有 crypto.subtle，退回纯 JS 实现
  if (!globalThis.crypto?.subtle) return sha1Hex(buf);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const PROFILE_PATH = 'profile.json';
const NOTES_RE = /^notes\/(\d{4}-\d{2})\.json$/;
const CARDS_RE = /^cards\/(\d{4}-\d{2})\.json$/;
const LOGS_RE = /^logs\/(\d{4}-\d{2})\/(\d{2})\.json$/;
export const isOurFile = (rel: string) => rel === PROFILE_PATH || NOTES_RE.test(rel) || CARDS_RE.test(rel) || LOGS_RE.test(rel);

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const sorted = <T extends { createdAt?: string; ts?: string; id: string }>(list: T[], key: 'createdAt' | 'ts') =>
  list.sort((a, b) => ((a[key] ?? '') < (b[key] ?? '') ? -1 : (a[key] ?? '') > (b[key] ?? '') ? 1 : byId(a, b)));

function group<T>(list: T[], keyOf: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = keyOf(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** 把本地数据序列化成仓库文件（路径相对于数据目录） */
export async function buildLocalFiles(): Promise<Map<string, string>> {
  const [decks, notes, cards, logs, settings] = await Promise.all([
    db.decks.toArray(), db.notes.toArray(), db.cards.toArray(), db.logs.toArray(), getSettings(),
  ]);
  const v = CURRENT_SCHEMA_VERSION;
  const files = new Map<string, string>();
  files.set(PROFILE_PATH, serialize({ schemaVersion: v, kind: 'profile', decks: decks.sort((a, b) => a.order - b.order || byId(a, b)), settings }));
  for (const [month, list] of [...group(notes, (n) => monthOf(n.createdAt))].sort())
    files.set(`notes/${month}.json`, serialize({ schemaVersion: v, kind: 'notes', month, notes: sorted(list, 'createdAt') }));
  for (const [month, list] of [...group(cards, (c) => monthOf(c.createdAt))].sort())
    files.set(`cards/${month}.json`, serialize({ schemaVersion: v, kind: 'cards', month, cards: sorted(list, 'createdAt') }));
  for (const [day, list] of [...group(logs, (l) => l.day)].sort())
    files.set(`logs/${day.slice(0, 7)}/${day.slice(8)}.json`, serialize({ schemaVersion: v, kind: 'logs', day, logs: sorted(list, 'ts') }));
  return files;
}

/** 把远端文件按"较新者胜出"合并进本地 */
export async function applyRemoteFile(rel: string, text: string): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`远端文件 ${rel} 不是有效的 JSON，同步已中止。`);
  }
  if (rel === PROFILE_PATH) {
    const p = parseProfileFile(raw);
    await db.transaction('rw', [db.decks, db.meta], async () => {
      await mergeLww(db.decks, p.decks);
      const cur = await getSettings();
      if (fromIso(p.settings.updatedAt) > fromIso(cur.updatedAt)) await putSettingsRaw(p.settings);
    });
  } else if (NOTES_RE.test(rel)) {
    const f = parseNotesFile(raw);
    await db.transaction('rw', db.notes, () => mergeLww(db.notes, f.notes));
  } else if (CARDS_RE.test(rel)) {
    const f = parseCardsFile(raw);
    await db.transaction('rw', db.cards, () => mergeLww(db.cards, f.cards));
  } else if (LOGS_RE.test(rel)) {
    const f = parseLogsFile(raw);
    await db.transaction('rw', db.logs, () => mergeLww(db.logs, f.logs));
  }
}
