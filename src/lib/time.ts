// 时间工具。存储一律用带时区偏移的 ISO 8601（毫秒精度），计算一律转毫秒时间戳。
// "学习日"在每天 dayStartHour 点切换（设置里改，默认 04:00，按设置的时区算），熬夜复习仍算前一天。

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

// ---------- 时区 ----------
// 学习日按设置里的时区算（null = 跟随设备）。设置读出来时（getSettings）调用 setTimeZone，
// 之后所有按"哪一天"计算的地方（学习日、换日时刻、日历日）都用这个时区。存储的 ISO 时间不受影响。
let zone: string | null = null;
const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** 设置时区；无效的时区名按跟随设备处理 */
export function setTimeZone(tz: string | null | undefined) {
  if (!tz) { zone = null; return; }
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); zone = tz; } catch { zone = null; }
}
export const currentTimeZone = () => zone;
/** 设备的时区名 */
export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
function partsIn(ms: number, tz: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}
/** 毫秒 → 该时区的日期 "YYYY-MM-DD" */
const ymdAt = (ms: number) => {
  if (!zone) return ymd(new Date(ms));
  const p = partsIn(ms, zone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
};
/** 该时区的墙上时间 → 毫秒（夏令时跳过的时刻取之后的那个） */
function wallToMs(y: number, m: number, d: number, h: number, tz: string | null = zone): number {
  if (!tz) return new Date(y, m - 1, d, h).getTime();
  const want = Date.UTC(y, m - 1, d, h);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = partsIn(t, tz);
    const got = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    if (got === want) break;
    t += want - got;
  }
  return t;
}

/** 毫秒 → 学习日 "YYYY-MM-DD" */
export function studyDay(ms: number, dayStartHour: number): string {
  return ymdAt(ms - dayStartHour * 3_600_000);
}

/** 学习日的开始时刻（当天 dayStartHour 点） */
export function dayStartMs(day: string, dayStartHour: number): number {
  const [y, m, d] = day.split('-').map(Number);
  return wallToMs(y, m, d, dayStartHour);
}

export function addDaysToDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** 下一次换天（本学习日结束）的时刻 */
export const nextDayStartMs = (now: number, dayStartHour: number) => dayStartMs(addDaysToDay(studyDay(now, dayStartHour), 1), dayStartHour);

/** 用设备本地时间说一个时刻：今天 19:00 / 明天 04:00 / 11月10日 04:00 */
export function fmtLocalMoment(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const n = new Date(now);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / 86_400_000);
  return diff === 0 ? `今天 ${hm}` : diff === 1 ? `明天 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/**
 * 某时区的 hour 点，现在相当于设备本地的几点（"19:00"）；时区就是设备时区（或无效）时返回 null。
 * 夏令时会让对应关系变，所以是"现在"的换算。
 */
export function localClockOf(hour: number, tz: string | null, now = Date.now()): string | null {
  if (!tz || tz === deviceTimeZone()) return null;
  try {
    const p = partsIn(now, tz);
    const d = new Date(wallToMs(p.y, p.m, p.d, hour, tz));
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return null; }
}

/** 本地日历日（不考虑切换时间）："2026-10-02" */
export const calendarDay = (ms: number) => ymdAt(ms);

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
