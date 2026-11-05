import { afterEach, describe, expect, it } from 'vitest';
import { addDaysToDay, calendarDay, dayStartMs, setTimeZone, studyDay } from '../src/lib/time';

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
