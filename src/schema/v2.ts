// schemaVersion 2：笔记（内容）→ 卡片（调度状态）→ 复习日志。
// 规则（沿用 TimeEncre）：
//  - looseObject：未知字段原样保留，旧客户端不会删掉新版本加的字段
//  - 每个对象都有 updatedAt 和 deleted：删除是一次"更新"（墓碑），多设备合并时不会被旧数据复活
//  - 复习日志只增不改，撤销时打墓碑
import { z } from 'zod';

const IsoTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), '无效的 ISO 时间');
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const base = {
  id: z.string().min(1),
  updatedAt: IsoTime,
  deleted: z.boolean().default(false),
};

export const THEMES = ['TRAVAIL', 'SOCIÉTÉ', 'TECHNOLOGIE', 'ENVIRONNEMENT', 'MÉDIAS', 'ÉDUCATION', 'SANTÉ', 'GÉNÉRAL'] as const;
export const ThemeV2 = z.enum(THEMES);
export const CARD_TYPES = ['recognition', 'production', 'cloze'] as const;
export const CARD_STATES = ['new', 'learning', 'review', 'relearning'] as const;

export const DeckV2 = z.looseObject({
  ...base,
  name: z.string(),
  order: z.number(),
});

export const NoteV2 = z.looseObject({
  ...base,
  deckId: z.string(),
  createdAt: IsoTime,
  lemma: z.string().default(''),
  /** 真实句子，{{…}} 标出考查部分；旧卡为空 */
  sentence: z.string().default(''),
  meaningZh: z.string().default(''),
  meaningEn: z.string().default(''),
  cueFamily: z.string().nullable().default(null),
  intentZh: z.string().nullable().default(null),
  hint: z.string().nullable().default(null),
  answerFr: z.string().nullable().default(null),
  extra: z.string().nullable().default(null),
  source: z.string().nullable().default(null),
  layer: z.enum(['core', 'mid']).default('mid'),
  cardTypes: z.array(z.enum(CARD_TYPES)).default(['recognition']),
  tags: z.array(ThemeV2).default([]),
  usedCount: z.number().int().min(0).default(0),
  /** 卡片旋转：题面在 法语 / 翻译1 / 翻译2 之间轮换 */
  rot: z.number().int().min(0).max(2).default(0),
  /** 迁移时原样保存的旧卡对象 */
  legacy: z.unknown().nullable().default(null),
});

export const CardV2 = z.looseObject({
  ...base,
  noteId: z.string(),
  /** 冗余自笔记，用于按牌组出题、按月份分文件 */
  deckId: z.string(),
  createdAt: IsoTime,
  type: z.enum(CARD_TYPES),
  state: z.enum(CARD_STATES),
  due: IsoTime,
  /** 天；重学中时是重学结束后要用的间隔 */
  interval: z.number().int().min(0),
  ease: z.number(),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  /** 学习 / 重学步骤的序号 */
  step: z.number().int().min(0).default(0),
  lastReviewedAt: IsoTime.nullable().default(null),
  isLeech: z.boolean().default(false),
  suspended: z.boolean().default(false),
});

export const ReviewLogV2 = z.looseObject({
  ...base,
  cardId: z.string(),
  noteId: z.string(),
  ts: IsoTime,
  /** 学习日（按切换时间计） */
  day: Day,
  rating: z.number().int().min(1).max(4),
  prevState: z.enum(CARD_STATES),
  newState: z.enum(CARD_STATES),
  prevInterval: z.number().nullable(),
  newInterval: z.number().nullable(),
  prevEase: z.number().nullable(),
  newEase: z.number().nullable(),
  prevDue: IsoTime.nullable(),
  newDue: IsoTime.nullable(),
  elapsedMs: z.number().nullable().default(null),
  source: z.enum(['app', 'legacy']).default('app'),
});

export const SettingsV2 = z.looseObject({
  updatedAt: IsoTime,
  sourceLang: z.string().default('fr'),
  targetLang1: z.string().default('zh-CN'),
  targetLang2: z.string().default('en'),
  newPerDay: z.number().int().min(0).default(20),
  /** 0 = 不限 */
  reviewsPerDay: z.number().int().min(0).default(0),
  /** 分钟 */
  learningSteps: z.array(z.number().positive()).default([10, 1440]),
  relearnSteps: z.array(z.number().positive()).default([10]),
  graduatingInterval: z.number().int().min(1).default(3),
  easyInterval: z.number().int().min(1).default(4),
  startingEase: z.number().min(1.3).default(2.5),
  minEase: z.number().min(1).default(1.3),
  hardFactor: z.number().positive().default(1.2),
  easyBonus: z.number().positive().default(1.3),
  lapseFactor: z.number().min(0).max(1).default(0.5),
  maxInterval: z.number().int().positive().default(36500),
  /** 0 = 不自动暂停 */
  leechThreshold: z.number().int().min(0).default(8),
  dayStartHour: z.number().int().min(0).max(23).default(4),
  fuzz: z.boolean().default(true),
});

const file = <K extends string, S extends z.ZodRawShape>(kind: K, shape: S) =>
  z.looseObject({ schemaVersion: z.literal(2), kind: z.literal(kind), ...shape });

export const ProfileFileV2 = file('profile', { decks: z.array(DeckV2), settings: SettingsV2 });
export const NotesFileV2 = file('notes', { month: z.string(), notes: z.array(NoteV2) });
export const CardsFileV2 = file('cards', { month: z.string(), cards: z.array(CardV2) });
export const LogsFileV2 = file('logs', { day: Day, logs: z.array(ReviewLogV2) });
export const BundleFileV2 = file('bundle', {
  app: z.literal('VocabForge'),
  exportedAt: IsoTime,
  decks: z.array(DeckV2),
  settings: SettingsV2,
  notes: z.array(NoteV2),
  cards: z.array(CardV2),
  logs: z.array(ReviewLogV2),
});
