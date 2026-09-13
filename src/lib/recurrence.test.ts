import { describe, it, expect, beforeEach } from "vitest";
import { describeRecurrence, weekdayName, formatNextRun } from "./recurrence";
import { setI18nLanguage } from "./i18n";

describe("weekdayName", () => {
  it("maps ISO numbering onto the right day names", () => {
    expect(weekdayName(1, "en")).toBe("Monday");
    expect(weekdayName(2, "ru")).toBe("вторник");
    expect(weekdayName(7, "en")).toBe("Sunday");
  });

  it("clamps out-of-range values instead of producing Invalid Date", () => {
    expect(weekdayName(0, "en")).toBe("Monday");
    expect(weekdayName(99, "en")).toBe("Sunday");
  });
});

describe("describeRecurrence", () => {
  beforeEach(() => setI18nLanguage("ru"));

  it("describes a daily rule with its time", () => {
    expect(
      describeRecurrence({ frequency: "daily", weekday: 1, dayOfMonth: 1, timeOfDay: "09:00" }, "ru"),
    ).toBe("Каждый день в 09:00");
  });

  it("names the weekday for weekly rules", () => {
    expect(
      describeRecurrence({ frequency: "weekly", weekday: 2, dayOfMonth: 1, timeOfDay: "18:30" }, "ru"),
    ).toBe("Каждый вторник в 18:30");
  });

  it("uses the day of month for monthly rules", () => {
    expect(
      describeRecurrence({ frequency: "monthly", weekday: 1, dayOfMonth: 15, timeOfDay: "12:00" }, "ru"),
    ).toBe("Каждое 15 число в 12:00");
  });
});

describe("formatNextRun", () => {
  it("returns null when there is nothing to show", () => {
    expect(formatNextRun(null, "ru")).toBeNull();
    expect(formatNextRun("nonsense", "ru")).toBeNull();
  });

  // No year on purpose: a recurring rule fires within the coming month, so
  // "13 сентября в 09:00" says everything and stays short enough for the card.
  it("formats a valid instant as a local day and time", () => {
    const out = formatNextRun("2026-09-13T06:00:00.000Z", "ru");
    expect(out).not.toBeNull();
    expect(out).toContain("13");
    expect(out).toMatch(/\d{2}:\d{2}/);
  });
});
