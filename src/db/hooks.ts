import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { getSettings, ONBOARDED_KEY } from './actions';
import { studyDay } from '../lib/time';
import { liveStore, useLiveStore } from './live';
import { useMemo } from 'react';
import { memoryMap, validWeights, type Memory } from '../srs/fsrs';
import type { Settings } from '../schema';

// 整表查询由所有页面共用（见 live.ts）：作答后卡片表只读一次，切换页面不用重新读
const settingsStore = liveStore(getSettings);
const decksStore = liveStore(async () => (await db.decks.toArray()).filter((d) => !d.deleted).sort((a, b) => a.order - b.order));
const notesStore = liveStore(async () => (await db.notes.toArray()).filter((n) => !n.deleted));
const cardsStore = liveStore(async () => (await db.cards.toArray()).filter((c) => !c.deleted));
export const useSettings = () => useLiveStore(settingsStore);
export const useDecks = () => useLiveStore(decksStore);
export const useNotes = () => useLiveStore(notesStore);
export const useCards = () => useLiveStore(cardsStore);
const clipsStore = liveStore(async () => (await db.clips.toArray()).filter((c) => !c.deleted).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
/** 摘句篮（不含墓碑），新的在前 */
export const useClips = () => useLiveStore(clipsStore);
const logsStore = liveStore(async () => (await db.logs.toArray()).filter((l) => !l.deleted));
/** 全部日志（不含墓碑） */
export const useAllLogs = () => useLiveStore(logsStore);
/** FSRS 记忆状态（每张卡从日志重放）；用 SM-2 时返回空表 */
export function useMemories(s: Settings | undefined): Map<string, Memory> | undefined {
  const cards = useCards();
  const logs = useAllLogs();
  const fsrs = s?.scheduler === 'fsrs';
  return useMemo(() => {
    if (!s || !cards || !logs) return undefined;
    return fsrs ? memoryMap(validWeights(s.fsrsWeights), cards, logs, s.dayStartHour) : new Map();
  }, [fsrs, s?.fsrsWeights, s?.dayStartHour, cards, logs]); // eslint-disable-line react-hooks/exhaustive-deps
}
/** 当前学习日的日志（含墓碑，由调用方过滤） */
export const useTodayLogs = (dayStartHour: number | undefined, now: number) => {
  const day = dayStartHour === undefined ? null : studyDay(now, dayStartHour);
  // 带上查询的是哪一天：设置还没加载完、或刚跨过切换时间时，useLiveQuery 会先返回上一次的结果，
  // 不能把它当成"今天没有日志"（否则出题会忽略"同笔记当天只出一张"等规则）
  const r = useLiveQuery(async () => (day ? { day, logs: await db.logs.where('day').equals(day).toArray() } : null), [day]);
  return r && r.day === day ? r.logs : undefined;
};
export const useOnboarded = () => useLiveQuery(async () => !!(await db.meta.get(ONBOARDED_KEY))?.value || (await db.notes.count()) > 0, []);
/** 某个学习日起至今的日志（不含墓碑） */
export const useLogsSince = (fromDay: string | null) =>
  useLiveQuery(async () => (fromDay ? (await db.logs.where('day').aboveOrEqual(fromDay).toArray()).filter((l) => !l.deleted) : []), [fromDay]);
/** 一条笔记的全部日志，新的在前 */
export const useNoteLogs = (noteId: string) =>
  useLiveQuery(async () => (await db.logs.where('noteId').equals(noteId).toArray()).filter((l) => !l.deleted).sort((a, b) => (a.ts < b.ts ? 1 : -1)), [noteId]);
