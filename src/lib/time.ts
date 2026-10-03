// 时间工具。存储一律用带时区偏移的 ISO 8601（毫秒精度），计算一律转毫秒时间戳。
// "学习日"在每天 dayStartHour 点切换（默认凌晨 4 点），熬夜复习仍算前一天。

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** 毫秒 → "2026-10-02T16:49:27.123+08:00" */
export function toIso(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function fromIso(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`无效的时间：${iso}`);
  return t;
}

/** 比 prev 严格更新的时间戳：保证同一毫秒内的两次修改也能按顺序胜出 */
export function bumpIso(prev: string | undefined, now = Date.now()): string {
  const p = prev ? Date.parse(prev) : NaN;
  return toIso(Number.isNaN(p) ? now : Math.max(now, p + 1));
}

const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 毫秒 → 学习日 "YYYY-MM-DD" */
export function studyDay(ms: number, dayStartHour: number): string {
  return ymd(new Date(ms - dayStartHour * 3_600_000));
}

/** 学习日的开始时刻（当天 dayStartHour 点） */
export function dayStartMs(day: string, dayStartHour: number): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, dayStartHour).getTime();
}

export function addDaysToDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** 本地日历日（不考虑切换时间）："2026-10-02" */
export const calendarDay = (ms: number) => ymd(new Date(ms));

/** "2026-10-02" → 当天中午的 ISO（用于只有日期的旧数据） */
export const noonIso = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return toIso(new Date(y, m - 1, d, 12).getTime());
};

export const monthOf = (isoOrDay: string) => isoOrDay.slice(0, 7);

export function fileStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** 间隔的中文显示：10分钟 / 3天 / 2.5月 / 1.2年 */
export function fmtMinutes(min: number): string {
  if (min < 60) return `${Math.max(1, Math.round(min))}分钟`;
  if (min < 1440) return `${+(min / 60).toFixed(1)}小时`;
  return fmtDays(Math.round(min / 1440));
}
export function fmtDays(d: number): string {
  if (d < 30) return `${d}天`;
  if (d < 365) return `${+(d / 30).toFixed(1)}月`;
  return `${+(d / 365).toFixed(1)}年`;
}
