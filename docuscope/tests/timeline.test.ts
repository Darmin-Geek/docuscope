import { test, expect } from "@playwright/test";
import {
  ticks,
  tickUnitForSpan,
  assignLanes,
  MS_DAY,
  MS_HR,
  MS_YR,
} from "../lib/timelineRender";

// ── adaptive ticks ────────────────────────────────────────────────────────────

test.describe("tickUnitForSpan — steps down with zoom", () => {
  test("years → months → days → hours → minutes", () => {
    expect(tickUnitForSpan(50 * MS_YR)).toBe("years");
    expect(tickUnitForSpan(1 * MS_YR)).toBe("months");
    expect(tickUnitForSpan(30 * MS_DAY)).toBe("days");
    expect(tickUnitForSpan(2 * MS_DAY)).toBe("hours");
    expect(tickUnitForSpan(2 * MS_HR)).toBe("minutes");
  });
});

test.describe("ticks — calendar-snapped boundaries", () => {
  test("wide span produces year ticks on Jan 1", () => {
    const lo = Date.UTC(1990, 0, 1);
    const hi = Date.UTC(2020, 0, 1);
    const t = ticks(lo, hi);
    expect(t.length).toBeGreaterThan(0);
    for (const tk of t) {
      const d = new Date(tk.ms);
      expect(d.getUTCMonth()).toBe(0);
      expect(d.getUTCDate()).toBe(1);
    }
    // A decade label like 2000 is a major tick.
    expect(t.find((tk) => tk.label === "2000")?.major).toBe(true);
  });

  test("month scale marks January as the major boundary", () => {
    const lo = Date.UTC(1994, 0, 1);
    const hi = Date.UTC(1995, 0, 1) + 60 * MS_DAY; // ~14 months
    const t = ticks(lo, hi);
    // All month ticks land on the 1st.
    for (const tk of t) expect(new Date(tk.ms).getUTCDate()).toBe(1);
    const jan = t.find((tk) => new Date(tk.ms).getUTCMonth() === 0);
    expect(jan?.major).toBe(true);
  });

  test("hour scale snaps to the top of the hour, midnight is major", () => {
    const lo = Date.UTC(1994, 6, 8, 0, 0);
    const hi = Date.UTC(1994, 6, 9, 12, 0); // ~1.5 days → hours
    const t = ticks(lo, hi);
    expect(t.length).toBeGreaterThan(0);
    for (const tk of t) {
      const d = new Date(tk.ms);
      expect(d.getUTCMinutes()).toBe(0);
    }
    const midnight = t.find((tk) => new Date(tk.ms).getUTCHours() === 0);
    expect(midnight?.major).toBe(true);
  });

  test("minute scale snaps to the minute, top-of-hour is major", () => {
    const lo = Date.UTC(1994, 6, 8, 13, 0);
    const hi = Date.UTC(1994, 6, 8, 15, 0); // 2h → minutes
    const t = ticks(lo, hi);
    for (const tk of t) expect(new Date(tk.ms).getUTCSeconds()).toBe(0);
    const topHour = t.find((tk) => new Date(tk.ms).getUTCMinutes() === 0);
    expect(topHour?.major).toBe(true);
  });
});

// ── lane packing ──────────────────────────────────────────────────────────────

test.describe("assignLanes — greedy interval packing", () => {
  test("non-overlapping bars share a single lane", () => {
    const { packed, laneCount } = assignLanes([
      { id: "a", leftPx: 0, rightPx: 40 },
      { id: "b", leftPx: 60, rightPx: 100 },
      { id: "c", leftPx: 120, rightPx: 160 },
    ]);
    expect(laneCount).toBe(1);
    expect(packed.every((e) => e.lane === 0)).toBe(true);
  });

  test("overlapping bars stack into separate lanes", () => {
    const { packed, laneCount } = assignLanes([
      { id: "a", leftPx: 0, rightPx: 100 },
      { id: "b", leftPx: 50, rightPx: 150 },
      { id: "c", leftPx: 120, rightPx: 220 },
    ]);
    expect(laneCount).toBe(2);
    const byId = Object.fromEntries(packed.map((e) => [e.id, e.lane]));
    expect(byId.a).toBe(0);
    expect(byId.b).toBe(1);
    // c starts after a ends (+gap), so it reuses lane 0.
    expect(byId.c).toBe(0);
  });

  test("label width (baked into rightPx) forces a new lane", () => {
    // Two bars that would not overlap on their bars alone, but a's long label
    // extends rightPx past b's start.
    const noLabel = assignLanes([
      { id: "a", leftPx: 0, rightPx: 30 },
      { id: "b", leftPx: 40, rightPx: 70 },
    ]);
    expect(noLabel.laneCount).toBe(1);

    const withLabel = assignLanes([
      { id: "a", leftPx: 0, rightPx: 60 }, // label pushes rightPx to 60
      { id: "b", leftPx: 40, rightPx: 100 },
    ]);
    expect(withLabel.laneCount).toBe(2);
  });

  test("entries are packed in left-to-right order regardless of input order", () => {
    const { packed } = assignLanes([
      { id: "late", leftPx: 200, rightPx: 240 },
      { id: "early", leftPx: 0, rightPx: 40 },
    ]);
    // Both fit one lane; assignment is stable on sorted order.
    expect(packed.map((e) => e.id)).toEqual(["early", "late"]);
  });
});
