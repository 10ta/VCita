// 一次性导入旧版（服务器版）VocabForge 的备份：
//   备份页导出的 vocabforge-YYYY-MM-DD.json：{ version, files: { "users/<uid>/YYMM/MMDD.json": [卡片…], "users/<uid>/meta.json": {...}, "global.json": {...} } }
//   更早的格式：{ decks, cards }
// 每张旧卡 → 一条笔记 + 一张认读卡；reviewHistory → 复习日志。调度字段原样保留。
// id 由旧 id 派生、updatedAt 取备份导出时间：同一份备份重复导入不会产生任何变化，也不会覆盖之后的复习进度。
import { db } from '../db/db';
import { getSettings, putSettingsRaw } from '../db/actions';
import { THEMES, type Card, type Deck, type Note, type ReviewLog, type Theme, SettingsSchema } from '../schema';
import { dayStartMs, fromIso, noonIso, toIso } from '../lib/time';
import { mergeLww, type MergeCount } from './merge';

interface OldCard {
  id: string; word?: string; translation?: string; translation2?: string; deckId?: string;
  createdAt?: string; tags?: string[]; rot?: number;
  state?: 'new' | 'review'; interval?: number; ease?: number; due?: string; lapses?: number; reps?: number; lastReview?: string | null;
  reviewHistory?: Array<{ date: string; rating?: number; remembered?: boolean; interval?: number; wasNew?: boolean }>;
}
interface OldMeta { decks?: Array<{ id: string; name: string }>; sourceLang?: string; targetLang1?: string; targetLang2?: string }

export interface LegacyUser {
  uid: string;
  name: string;
  meta: OldMeta;
  cards: OldCard[];
  /** 旧标签及使用次数 */
  tags: Array<{ name: string; count: number }>;
}

export interface LegacyBackup { exportedAt: string; users: LegacyUser[] }

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function readLegacyBackup(raw: unknown): LegacyBackup {
  if (!raw || typeof raw !== 'object') throw new Error('不是有效的 JSON 备份');
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== undefined) throw new Error('这是新版备份，请用"导入备份"而不是"导入旧版备份"');
  const exportedAt = typeof r.exportedAt === 'string' && !Number.isNaN(Date.parse(r.exportedAt)) ? r.exportedAt : toIso(Date.UTC(2026, 0, 1));
  const byUser = new Map<string, LegacyUser>();
  const user = (uid: string) => {
    let u = byUser.get(uid);
    if (!u) byUser.set(uid, (u = { uid, name: uid, meta: {}, cards: [], tags: [] }));
    return u;
  };
  if (r.files && typeof r.files === 'object') {
    const files = r.files as Record<string, unknown>;
    const global = files['global.json'] as { users?: Array<{ id: string; name: string }> } | undefined;
    for (const [p, data] of Object.entries(files)) {
      const m = /^users\/([^/]+)\/(.+)$/.exec(p);
      if (!m) continue;
      const u = user(m[1]);
      if (m[2] === 'meta.json') u.meta = (data as OldMeta) ?? {};
      else if (Array.isArray(data)) u.cards.push(...(data as OldCard[]).filter((c) => c && c.id && isDay(c.createdAt)));
    }
    for (const g of global?.users ?? []) if (byUser.has(g.id)) byUser.get(g.id)!.name = g.name;
  } else if (Array.isArray(r.cards)) {
    const u = user('default');
    u.meta = { decks: r.decks as OldMeta['decks'] };
    u.cards = (r.cards as OldCard[]).filter((c) => c && c.id && isDay(c.createdAt));
  } else throw new Error('无法识别的备份格式');
  // 同一 id 出现多次（旧版文件错放）时保留复习记录更多的那份
  for (const u of byUser.values()) {
    const best = new Map<string, OldCard>();
    for (const c of u.cards) {
      const prev = best.get(c.id);
      if (!prev || (c.reviewHistory?.length ?? 0) > (prev.reviewHistory?.length ?? 0)) best.set(c.id, c);
    }
    u.cards = [...best.values()];
    const counts = new Map<string, number>();
    for (const c of u.cards) for (const t of c.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    u.tags = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }
  return { exportedAt, users: [...byUser.values()].filter((u) => u.cards.length || u.meta.decks?.length) };
}

/** 按名称猜主题，导入界面里可以改 */
export function guessTheme(tag: string): Theme {
  const t = tag.toLowerCase();
  const rules: Array<[RegExp, Theme]> = [
    [/police|justice|loi|droit|politi|société|social|crime|tribunal/, 'SOCIÉTÉ'],
    [/médec|santé|sante|maladie|hôpital|corps|medic/, 'SANTÉ'],
    [/travail|emploi|boulot|entreprise|économ|métier/, 'TRAVAIL'],
    [/techn|numérique|informati|internet|science/, 'TECHNOLOGIE'],
    [/environ|écolog|climat|nature|énergie/, 'ENVIRONNEMENT'],
    [/média|presse|journal|télé|réseau/, 'MÉDIAS'],
    [/éduc|école|université|étud|enseign/, 'ÉDUCATION'],
  ];
  return rules.find(([re]) => re.test(t))?.[1] ?? 'GÉNÉRAL';
}

export interface Converted { decks: Deck[]; notes: Note[]; cards: Card[]; logs: ReviewLog[] }

export function convertLegacy(u: LegacyUser, exportedAt: string, themeMap: Record<string, Theme>, startingEase: number, dayStartHour: number): Converted {
  const stamp = exportedAt;
  const deckIds = new Set<string>();
  const decks: Deck[] = (u.meta.decks ?? []).map((d, i) => {
    deckIds.add(d.id);
    return { id: `d_${d.id}`, name: d.name, order: i, updatedAt: stamp, deleted: false };
  });
  const notes: Note[] = [], cards: Card[] = [], logs: ReviewLog[] = [];
  for (const o of u.cards) {
    const deckKey = o.deckId && deckIds.has(o.deckId) ? o.deckId : (decks[0] ? decks[0].id.slice(2) : 'default');
    if (!deckIds.has(deckKey)) {
      deckIds.add(deckKey);
      decks.push({ id: `d_${deckKey}`, name: deckKey === 'default' ? '默认' : deckKey, order: decks.length, updatedAt: stamp, deleted: false });
    }
    const createdAt = noonIso(o.createdAt!);
    const tags = [...new Set((o.tags ?? []).map((t) => themeMap[t] ?? guessTheme(t)))].filter((t) => (THEMES as readonly string[]).includes(t));
    const note: Note = {
      id: `n_${o.id}`, deckId: `d_${deckKey}`, createdAt,
      lemma: o.word ?? '', sentence: '', meaningZh: o.translation ?? '', meaningEn: o.translation2 ?? '',
      cueFamily: null, intentZh: null, hint: null, answerFr: null, extra: null, source: null,
      layer: 'mid', cardTypes: ['recognition'], tags, usedCount: 0, rot: ((o.rot ?? 0) % 3 + 3) % 3, legacy: o,
      updatedAt: stamp, deleted: false,
    };
    const hist = (o.reviewHistory ?? []).filter((h) => h && isDay(h.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
    const learned = o.state === 'review' || (!o.state && hist.length > 0);
    const dueDay = isDay(o.due) ? o.due : (hist.at(-1)?.date ?? o.createdAt!);
    const card: Card = {
      id: `c_${o.id}`, noteId: note.id, deckId: note.deckId, createdAt, type: 'recognition',
      state: learned ? 'review' : 'new',
      due: learned ? toIso(dayStartMs(dueDay, dayStartHour)) : createdAt,
      interval: learned ? Math.max(1, o.interval ?? 1) : 0,
      ease: o.ease ?? startingEase,
      reps: o.reps ?? hist.length,
      lapses: o.lapses ?? hist.filter((h) => h.remembered === false).length,
      step: 0,
      lastReviewedAt: o.lastReview && isDay(o.lastReview) ? noonIso(o.lastReview) : hist.length ? noonIso(hist.at(-1)!.date) : null,
      isLeech: false, suspended: false, updatedAt: stamp, deleted: false,
    };
    hist.forEach((h, i) => {
      const rating = h.rating ?? (h.remembered === false ? 1 : 3);
      logs.push({
        id: `l_${o.id}_${i}`, cardId: card.id, noteId: note.id, ts: noonIso(h.date), day: h.date, rating,
        prevState: h.wasNew || i === 0 ? 'new' : 'review', newState: 'review',
        prevInterval: null, newInterval: h.interval ?? null, prevEase: null, newEase: null, prevDue: null, newDue: null,
        elapsedMs: null, source: 'legacy', updatedAt: stamp, deleted: false,
      });
    });
    notes.push(note);
    cards.push(card);
  }
  return { decks, notes, cards, logs };
}

export interface LegacyImportReport { notes: MergeCount; cards: MergeCount; logs: MergeCount; decks: MergeCount }

export async function importLegacy(backup: LegacyBackup, uid: string, themeMap: Record<string, Theme>): Promise<LegacyImportReport> {
  const u = backup.users.find((x) => x.uid === uid);
  if (!u) throw new Error('备份里没有这个用户');
  const s = await getSettings();
  const conv = convertLegacy(u, backup.exportedAt, themeMap, s.startingEase, s.dayStartHour);
  return db.transaction('rw', [db.decks, db.notes, db.cards, db.logs, db.meta], async () => {
    // 旧版的语言设置带过来（只在本地设置从未改过时）
    if (fromIso(s.updatedAt) === 0 && u.meta.sourceLang) {
      await putSettingsRaw(SettingsSchema.parse({
        ...s, sourceLang: u.meta.sourceLang, targetLang1: u.meta.targetLang1 ?? s.targetLang1, targetLang2: u.meta.targetLang2 ?? s.targetLang2, updatedAt: toIso(1),
      }));
    }
    return {
      decks: await mergeLww(db.decks, conv.decks),
      notes: await mergeLww(db.notes, conv.notes),
      cards: await mergeLww(db.cards, conv.cards),
      logs: await mergeLww(db.logs, conv.logs),
    };
  });
}
