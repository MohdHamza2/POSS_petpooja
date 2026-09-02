export type DayStartClock = Date | string | null | undefined;

export interface BusinessDayWindow {
  start: Date;
  end: Date;
  businessDate: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function localDateIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Prisma @db.Time is a clock, not an instant — read UTC hours as local wall-clock. */
export function parseDayStartClock(dayStartTime: DayStartClock): { hours: number; minutes: number } {
  if (dayStartTime instanceof Date && !Number.isNaN(dayStartTime.getTime())) {
    return { hours: dayStartTime.getUTCHours(), minutes: dayStartTime.getUTCMinutes() };
  }
  if (typeof dayStartTime === "string" && dayStartTime.includes(":")) {
    const [h, m] = dayStartTime.split(":").map(Number);
    return { hours: Number.isFinite(h) ? h : 5, minutes: Number.isFinite(m) ? m : 0 };
  }
  return { hours: 5, minutes: 0 };
}

export function parseLocalDateParam(date: Date | string | null | undefined): Date {
  if (typeof date === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date.trim());
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
    }
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) {
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0);
    }
  }
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

export function businessDayWindow(dayStartTime: DayStartClock, date: Date | string): BusinessDayWindow {
  const clock = parseDayStartClock(dayStartTime);
  const day = parseLocalDateParam(date);
  const start = new Date(day);
  start.setHours(clock.hours, clock.minutes, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end, businessDate: localDateIso(day) };
}

export function currentBusinessDayWindow(dayStartTime: DayStartClock, now = new Date()): BusinessDayWindow {
  const clock = parseDayStartClock(dayStartTime);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), clock.hours, clock.minutes, 0, 0);
  const businessDay = now < todayStart
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return businessDayWindow(dayStartTime, businessDay);
}
