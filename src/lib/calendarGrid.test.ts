import { describe, it, expect } from "vitest";
import { buildCalendarGrid, daysInMonth, weekdayMon, sameDay } from "./calendarGrid";

describe("daysInMonth", () => {
  it("returns 28 for February in a non-leap year", () => {
    expect(daysInMonth(2025, 1)).toBe(28);
  });
  it("returns 29 for February in a leap year", () => {
    expect(daysInMonth(2024, 1)).toBe(29);
  });
  it("returns 31 for January", () => {
    expect(daysInMonth(2026, 0)).toBe(31);
  });
});

describe("weekdayMon", () => {
  it("maps Monday to 0", () => {
    // 2026-07-06 is a Monday
    expect(weekdayMon(new Date(2026, 6, 6))).toBe(0);
  });
  it("maps Sunday to 6", () => {
    // 2026-07-05 is a Sunday
    expect(weekdayMon(new Date(2026, 6, 5))).toBe(6);
  });
});

describe("buildCalendarGrid", () => {
  it("returns a length that's a multiple of 7", () => {
    const grid = buildCalendarGrid(2026, 6);
    expect(grid.length % 7).toBe(0);
  });

  it("pads leading days with null up to the month's first weekday offset", () => {
    // July 2026 starts on a Wednesday → weekdayMon = 2
    const grid = buildCalendarGrid(2026, 6);
    expect(grid[0]).toBeNull();
    expect(grid[1]).toBeNull();
    expect(grid[2]).not.toBeNull();
    expect(grid[2]?.getDate()).toBe(1);
  });

  it("includes every day of the month exactly once", () => {
    const grid = buildCalendarGrid(2026, 6); // July → 31 days
    const days = grid.filter((d): d is Date => d !== null);
    expect(days).toHaveLength(31);
    expect(days.map((d) => d.getDate())).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it("pads trailing days with null to complete the last week", () => {
    const grid = buildCalendarGrid(2026, 6);
    expect(grid[grid.length - 1] === null || grid[grid.length - 1] instanceof Date).toBe(true);
    // last non-null day should be July 31
    const lastDay = [...grid].reverse().find((d) => d !== null);
    expect(lastDay?.getDate()).toBe(31);
  });
});

describe("sameDay", () => {
  it("is true for the same calendar day at different times", () => {
    expect(sameDay(new Date(2026, 6, 4, 3, 0), new Date(2026, 6, 4, 23, 59))).toBe(true);
  });
  it("is false for different days", () => {
    expect(sameDay(new Date(2026, 6, 4), new Date(2026, 6, 5))).toBe(false);
  });
  it("is false for the same day/month but different year", () => {
    expect(sameDay(new Date(2025, 6, 4), new Date(2026, 6, 4))).toBe(false);
  });
});
