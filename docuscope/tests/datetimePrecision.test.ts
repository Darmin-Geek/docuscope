import { test, expect } from "@playwright/test";
import {
  precisionBounds,
  deriveBounds,
  deriveBoundsFromRaw,
  partsToValue,
  valueToParts,
  humanEndpoint,
  humanDatetime,
  type DatetimeParts,
} from "../lib/datetimePrecision";

// A helper mirroring the plan's proleptic-Gregorian epoch, using Date.UTC but
// correcting the two-digit-year quirk so the expectations are trustworthy for
// modern years (the ones Date.UTC handles without remapping).
function utc(y: number, mo = 1, d = 1, h = 0, mi = 0): bigint {
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  return BigInt(ms);
}

test.describe("precisionBounds — window per level", () => {
  const p: DatetimeParts = { year: 1994, month: 7, day: 8, hour: 13, minute: 45 };

  test("minute → [t, t+1min)", () => {
    const b = precisionBounds(p, "minute");
    expect(b.lowerMs).toBe(utc(1994, 7, 8, 13, 45));
    expect(b.upperMs).toBe(utc(1994, 7, 8, 13, 46));
  });

  test("hour → [hour start, next hour)", () => {
    const b = precisionBounds(p, "hour");
    expect(b.lowerMs).toBe(utc(1994, 7, 8, 13, 0));
    expect(b.upperMs).toBe(utc(1994, 7, 8, 14, 0));
  });

  test("day → [day start, next day)", () => {
    const b = precisionBounds(p, "day");
    expect(b.lowerMs).toBe(utc(1994, 7, 8));
    expect(b.upperMs).toBe(utc(1994, 7, 9));
  });

  test("month → [month start, next month)", () => {
    const b = precisionBounds(p, "month");
    expect(b.lowerMs).toBe(utc(1994, 7, 1));
    expect(b.upperMs).toBe(utc(1994, 8, 1));
  });

  test("month wraps year at December", () => {
    const b = precisionBounds({ year: 1999, month: 12 }, "month");
    expect(b.lowerMs).toBe(utc(1999, 12, 1));
    expect(b.upperMs).toBe(utc(2000, 1, 1));
  });

  test("year → [Jan 1, next Jan 1)", () => {
    const b = precisionBounds(p, "year");
    expect(b.lowerMs).toBe(utc(1994, 1, 1));
    expect(b.upperMs).toBe(utc(1995, 1, 1));
  });

  test("decade snaps to the containing decade", () => {
    const b = precisionBounds({ year: 1994 }, "decade");
    expect(b.lowerMs).toBe(utc(1990, 1, 1));
    expect(b.upperMs).toBe(utc(2000, 1, 1));
  });

  test("century snaps to the containing century", () => {
    const b = precisionBounds({ year: 1994 }, "century");
    expect(b.lowerMs).toBe(utc(1900, 1, 1));
    expect(b.upperMs).toBe(utc(2000, 1, 1));
  });
});

test.describe("precisionBounds — ancient / BC years", () => {
  // Astronomical year 0 = 1 BC, -43 = 44 BC. Date.UTC remaps low years, so we
  // assert relationships and known day counts instead of round-tripping Date.UTC.

  test("a BC year is a positive-width window ending before AD 1", () => {
    const b = precisionBounds({ year: -43 }, "year"); // 44 BC
    expect(b.upperMs).toBeLessThan(b.lowerMs + BigInt(367 * 86_400_000));
    expect(b.upperMs).toBeGreaterThan(b.lowerMs);
    // Its upper bound (Jan 1 of 43 BC = astro year -42) is still well before epoch.
    expect(b.upperMs).toBeLessThan(BigInt(0));
  });

  test("year 0 (1 BC) sits immediately before AD 1", () => {
    const oneBc = precisionBounds({ year: 0 }, "year");
    const ad1 = precisionBounds({ year: 1 }, "year");
    // Upper of 1 BC equals lower of AD 1 (contiguous), and 1 BC is a leap year.
    expect(oneBc.upperMs).toBe(ad1.lowerMs);
    expect(oneBc.upperMs - oneBc.lowerMs).toBe(BigInt(366 * 86_400_000));
  });

  test("BC decade snaps downward on the astronomical axis", () => {
    // year -1985 → decade start astro -1990 (i.e. 1990s BC region).
    const b = precisionBounds({ year: -1985 }, "decade");
    const span = b.upperMs - b.lowerMs;
    // 10 years including 2-3 leap days → ~3652-3653 days.
    expect(Number(span / BigInt(86_400_000))).toBeGreaterThanOrEqual(3650);
    expect(Number(span / BigInt(86_400_000))).toBeLessThanOrEqual(3653);
  });
});

test.describe("deriveBounds — point vs range", () => {
  test("point exposes a single window, no core", () => {
    const d = deriveBounds({
      isRange: false,
      start: { year: 1990 },
      startPrecision: "decade",
    });
    expect(d.coreLowerMs).toBeNull();
    expect(d.coreUpperMs).toBeNull();
    expect(d.lowerMs).toBe(utc(1990, 1, 1));
    expect(d.upperMs).toBe(utc(2000, 1, 1));
  });

  test("range: independent per-endpoint precision (decade start, month end)", () => {
    // "the 1980s until March 1995": long left whisker, short right whisker.
    const d = deriveBounds({
      isRange: true,
      start: { year: 1985 },
      startPrecision: "decade",
      end: { year: 1995, month: 3 },
      endPrecision: "month",
    });
    expect(d.lowerMs).toBe(utc(1980, 1, 1)); // start.lower
    expect(d.coreLowerMs).toBe(utc(1990, 1, 1)); // start.upper
    expect(d.coreUpperMs).toBe(utc(1995, 3, 1)); // end.lower
    expect(d.upperMs).toBe(utc(1995, 4, 1)); // end.upper
  });

  test("reversed range throws", () => {
    expect(() =>
      deriveBounds({
        isRange: true,
        start: { year: 1999, month: 5 },
        startPrecision: "month",
        end: { year: 1990, month: 1 },
        endPrecision: "month",
      }),
    ).toThrow(/before its start/);
  });
});

test.describe("canonical value round-trip", () => {
  test("partsToValue / valueToParts round-trips modern datetimes", () => {
    const parts: DatetimeParts = { year: 1994, month: 7, day: 8, hour: 13, minute: 45 };
    const v = partsToValue(parts);
    expect(v).toBe("1994-07-08T13:45");
    expect(valueToParts(v)).toEqual(parts);
  });

  test("encodes BC / ancient years with a sign and zero-padding", () => {
    expect(partsToValue({ year: -43, month: 3, day: 15 })).toBe("-0043-03-15T00:00");
    expect(valueToParts("-0043-03-15T00:00").year).toBe(-43);
    expect(partsToValue({ year: 44 })).toBe("0044-01-01T00:00");
  });

  test("deriveBoundsFromRaw matches deriveBounds", () => {
    const raw = {
      isRange: true,
      startValue: "1980-01-01T00:00",
      startPrecision: "decade" as const,
      endValue: "1995-03-01T00:00",
      endPrecision: "month" as const,
    };
    const fromRaw = deriveBoundsFromRaw(raw);
    expect(fromRaw.lowerMs).toBe(utc(1980, 1, 1));
    expect(fromRaw.coreLowerMs).toBe(utc(1990, 1, 1));
    expect(fromRaw.coreUpperMs).toBe(utc(1995, 3, 1));
    expect(fromRaw.upperMs).toBe(utc(1995, 4, 1));
  });
});

test.describe("human summaries", () => {
  test("endpoint phrasing per precision", () => {
    expect(humanEndpoint({ year: 1994, month: 7, day: 8 }, "day")).toBe("8 Jul 1994");
    expect(humanEndpoint({ year: 1995, month: 3 }, "month")).toBe("Mar 1995");
    expect(humanEndpoint({ year: 1985 }, "decade")).toBe("the 1980s");
    expect(humanEndpoint({ year: 1994 }, "year")).toBe("1994");
  });

  test("BC years render with a BC suffix", () => {
    expect(humanEndpoint({ year: -43 }, "year")).toBe("44 BC");
    expect(humanEndpoint({ year: 0 }, "year")).toBe("1 BC");
  });

  test("range summary joins both endpoints", () => {
    expect(
      humanDatetime({
        isRange: true,
        start: { year: 1985 },
        startPrecision: "decade",
        end: { year: 1995, month: 3 },
        endPrecision: "month",
      }),
    ).toBe("the 1980s → Mar 1995");
  });
});
