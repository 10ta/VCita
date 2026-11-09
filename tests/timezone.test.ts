import { afterEach, describe, expect, it } from 'vitest';
import { addDaysToDay, calendarDay, dayStartMs, fmtLocalMoment, localClockOf, nextDayStartMs, setTimeZone, studyDay, toIso } from '../src/lib/time';
import { isDue } from '../src/srs/scheduler';

describe('学习日的时区', () => {
  afterEach(() => setTimeZone(null));
  // 2026-11-05 03:30 纽约（UTC-5）= 2026-11-05 16:30 上海
  const t = Date.UTC(2026, 10, 5, 8, 30);
  it('同一时刻，不同时区的学习日不同', () => {
    setTimeZone('America/New_York');
    expect(studyDay(t, 4)).toBe('2026-11-04'); // 凌晨 3:30 还没到 4 点，算前一天
    expect(calendarDay(t)).toBe('2026-11-05');
    setTimeZone('Asia/Shanghai');
    expect(studyDay(t, 4)).toBe('2026-11-05');
  });
  it('换日时刻是该时区的墙上时间，包括夏令时', () => {
    setTimeZone('America/New_York');
    expect(new Date(dayStartMs('2026-11-05', 4)).toISOString()).toBe('2026-11-05T09:00:00.000Z'); // 冬令时 UTC-5
    expect(new Date(dayStartMs('2026-07-01', 4)).toISOString()).toBe('2026-07-01T08:00:00.000Z'); // 夏令时 UTC-4
    setTimeZone('Asia/Shanghai');
    expect(new Date(dayStartMs('2026-11-05', 0)).toISOString()).toBe('2026-11-04T16:00:00.000Z');
  });
  it('无效时区名按跟随设备；加天数与时区无关', () => {
    setTimeZone('Mars/Olympus');
    expect(studyDay(t, 0)).toBe(calendarDay(t));
    expect(addDaysToDay('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDaysToDay('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('改了切换时间以后，复习卡按学习日到期', () => {
  it('旧设置（纽约 04:00）排的卡，改成 UTC 00:00 后新的一天一开始就到期，不会中途冒出来', () => {
    // 旧设置下排到 11 月 7 日：到期时刻 = 纽约 04:00 = UTC 09:00
    setTimeZone('America/New_York');
    const due = toIso(dayStartMs('2026-11-07', 4));
    expect(due).toBe(toIso(Date.UTC(2026, 10, 7, 9)));
    // 改成 UTC 00:00；现在是 UTC 06:00（纽约凌晨 1 点），已经是 11 月 7 日这个学习日
    setTimeZone('UTC');
    const now = Date.UTC(2026, 10, 7, 6);
    const card = { state: 'review' as const, due };
    expect(isDue(card, now, 0)).toBe(true);
    // 前一个学习日还没到
    expect(isDue(card, Date.UTC(2026, 10, 6, 23), 0)).toBe(false);
    // 学习中的卡仍按分钟
    expect(isDue({ state: 'learning' as const, due }, now, 0)).toBe(false);
    setTimeZone(null);
  });
});

describe('换天时刻的显示', () => {
  it('下一次换天：UTC 00:00 设置下，纽约晚上 9 点看，是明天 UTC 零点', () => {
    setTimeZone('UTC');
    const now = Date.UTC(2026, 10, 9, 2, 45); // 纽约 11-08 21:45
    expect(nextDayStartMs(now, 0)).toBe(Date.UTC(2026, 10, 10, 0));
    setTimeZone(null);
  });
  it('本地时间说法：今天 / 明天 / 日期', () => {
    const base = new Date(2026, 10, 8, 21, 45).getTime();
    expect(fmtLocalMoment(new Date(2026, 10, 9, 4, 0).getTime(), base)).toBe('明天 04:00');
    expect(fmtLocalMoment(new Date(2026, 10, 8, 23, 0).getTime(), base)).toBe('今天 23:00');
    expect(fmtLocalMoment(new Date(2026, 10, 11, 4, 0).getTime(), base)).toBe('11月11日 04:00');
  });
  it('换算成本地时间：设备时区相同时不换算', () => {
    expect(localClockOf(4, null)).toBeNull();
    expect(localClockOf(4, Intl.DateTimeFormat().resolvedOptions().timeZone)).toBeNull();
    // 容器是 UTC 时，上海 08:00 = 本地 00:00
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'UTC') expect(localClockOf(8, 'Asia/Shanghai', Date.UTC(2026, 10, 8, 12))).toBe('00:00');
  });
});
