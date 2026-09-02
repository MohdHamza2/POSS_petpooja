import { describe, it, expect } from "vitest";
import {
  parseDayStartClock,
  businessDayWindow,
  currentBusinessDayWindow,
  localDateIso,
} from "../src/business-day";

describe("businessDayWindow", () => {
  const prismaTime = new Date("1970-01-01T05:00:00.000Z");

  it("reads TIME-without-TZ via UTC clock, not local getHours", () => {
    const clock = parseDayStartClock(prismaTime);
    expect(clock).toEqual({ hours: 5, minutes: 0 });
  });

  it("opens the window at 05:00 local on the picked calendar date", () => {
    const { start, end, businessDate } = businessDayWindow(prismaTime, "2026-09-01");
    expect(businessDate).toBe("2026-09-01");
    expect(start.getHours()).toBe(5);
    expect(start.getMinutes()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("rolls current business date back before day start", () => {
    const now = new Date(2026, 8, 1, 3, 46, 0, 0);
    const { businessDate, start } = currentBusinessDayWindow(prismaTime, now);
    expect(businessDate).toBe("2026-08-31");
    expect(start.getHours()).toBe(5);
    expect(localDateIso(start)).toBe("2026-08-31");
  });
});
