import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { getSettings, ONBOARDED_KEY } from './actions';
import { studyDay } from '../lib/time';

export const useSettings = () => useLiveQuery(getSettings, []);
export const useDecks = () =>
  useLiveQuery(async () => (await db.decks.toArray()).filter((d) => !d.deleted).sort((a, b) => a.order - b.order), []);
export const useNotes = () => useLiveQuery(async () => (await db.notes.toArray()).filter((n) => !n.deleted), []);
export const useCards = () => useLiveQuery(async () => (await db.cards.toArray()).filter((c) => !c.deleted), []);
/** 当前学习日的日志（含墓碑，由调用方过滤） */
export const useTodayLogs = (dayStartHour: number | undefined, now: number) => {
  const day = dayStartHour === undefined ? null : studyDay(now, dayStartHour);
  // 带上查询的是哪一天：设置还没加载完、或刚跨过切换时间时，useLiveQuery 会先返回上一次的结果，
  // 不能把它当成"今天没有日志"（否则出题会忽略"同笔记当天只出一张"等规则）
  const r = useLiveQuery(async () => (day ? { day, logs: await db.logs.where('day').equals(day).toArray() } : null), [day]);
  return r && r.day === day ? r.logs : undefined;
};
export const useOnboarded = () => useLiveQuery(async () => !!(await db.meta.get(ONBOARDED_KEY))?.value || (await db.notes.count()) > 0, []);
