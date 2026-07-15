// Shared datetime-precision helper — the single source of truth for turning a
// human datetime value + precision into a pair of epoch-millisecond bounds.
//
// Imported by BOTH the client (live preview in the datetime editor) and the
// server (authoritative bound derivation in lib/timelines.server.ts), so the
// two can never disagree. Pure integer math on signed epoch-ms; no dependency
// on the browser's local Date quirks.
//
// Bounds are proleptic-Gregorian and support ancient / BC dates. A precision
// level defines a half-open window [lower, upper): `lower` is inclusive, `upper`
// exclusive (the first instant of the *next* unit). See §3 of the plan.

export type Precision =
  | 'minute'
  | 'hour'
  | 'day'
  | 'month'
  | 'year'
  | 'decade'
  | 'century';

export const PRECISIONS: Precision[] = [
  'minute',
  'hour',
  'day',
  'month',
  'year',
  'decade',
  'century',
];

// A single endpoint: an astronomical year (…, -1 = 2 BC, 0 = 1 BC, 1 = 1 AD, …)
// plus the finer fields, each meaningful only at or below its precision.
export type DatetimeParts = {
  year: number; // proleptic / astronomical year (0 = 1 BC, -1 = 2 BC, …)
  month?: number; // 1-12
  day?: number; // 1-31
  hour?: number; // 0-23
  minute?: number; // 0-59
};

export type Bounds = {
  lowerMs: bigint;
  upperMs: bigint;
};

// BigInt constants via BigInt() rather than `n` literals — the project's tsc
// target is ES2017, which rejects bigint literals (the Node runtime supports
// them fine; this keeps the shared tsconfig untouched).
const MS_PER_MINUTE = BigInt(60_000);
const MS_PER_HOUR = BigInt(3_600_000);
const MS_PER_DAY = BigInt(86_400_000);

// Days from the proleptic-Gregorian epoch (1970-01-01) to `year`-01-01. Uses the
// standard civil-from-days inverse so it is exact for any year, ancient or far
// future, without the two-digit-year remapping that Date.UTC(0..99, …) applies.
function daysFromCivil(year: number, month: number, day: number): number {
  // Algorithm from Howard Hinnant's "chrono-Compatible Low-Level Date Algorithms".
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400; // [0, 399]
  const doy =
    Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

// Epoch-ms for a proleptic-Gregorian instant given whole calendar fields. Month
// and day are 1-based; overflow (e.g. month 13, day 32) is normalised the same
// way arithmetic on the parts would, so callers can pass month+1 / day+1 to get
// the start of the next unit.
function epochMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): bigint {
  // Normalise month overflow/underflow into the year so daysFromCivil sees a
  // valid 1-12 month (its day-of-year table assumes that range).
  let y = year;
  let m = month;
  // month is 1-based; convert to 0-based for modular normalisation.
  const zeroM = m - 1;
  y += Math.floor(zeroM / 12);
  m = ((zeroM % 12) + 12) % 12 + 1;

  const days = daysFromCivil(y, m, 1);
  // day-1 because daysFromCivil already lands on the 1st; extra days (incl. any
  // day overflow like day=32) roll forward naturally as plain day counts.
  const totalDays = BigInt(days) + BigInt(day - 1);
  return (
    totalDays * MS_PER_DAY +
    BigInt(hour) * MS_PER_HOUR +
    BigInt(minute) * MS_PER_MINUTE
  );
}

/**
 * Compute the half-open [lower, upper) epoch-ms window for one endpoint at the
 * given precision. Mirrors the precision table in the plan:
 *   minute  → [t, t+1min)
 *   hour    → [hour start, next hour)
 *   day     → [day start, next day)
 *   month   → [month start, next month)
 *   year    → [Jan 1, next Jan 1)
 *   decade  → [decade start, +10y)
 *   century → [century start, +100y)
 */
export function precisionBounds(
  parts: DatetimeParts,
  precision: Precision,
): Bounds {
  const y = parts.year;
  const mo = parts.month ?? 1;
  const d = parts.day ?? 1;
  const h = parts.hour ?? 0;
  const mi = parts.minute ?? 0;

  switch (precision) {
    case 'minute': {
      const lower = epochMs(y, mo, d, h, mi);
      return { lowerMs: lower, upperMs: lower + MS_PER_MINUTE };
    }
    case 'hour': {
      const lower = epochMs(y, mo, d, h, 0);
      return { lowerMs: lower, upperMs: lower + MS_PER_HOUR };
    }
    case 'day': {
      const lower = epochMs(y, mo, d, 0, 0);
      const upper = epochMs(y, mo, d + 1, 0, 0);
      return { lowerMs: lower, upperMs: upper };
    }
    case 'month': {
      const lower = epochMs(y, mo, 1, 0, 0);
      const upper = epochMs(y, mo + 1, 1, 0, 0);
      return { lowerMs: lower, upperMs: upper };
    }
    case 'year': {
      const lower = epochMs(y, 1, 1, 0, 0);
      const upper = epochMs(y + 1, 1, 1, 0, 0);
      return { lowerMs: lower, upperMs: upper };
    }
    case 'decade': {
      const start = Math.floor(y / 10) * 10;
      const lower = epochMs(start, 1, 1, 0, 0);
      const upper = epochMs(start + 10, 1, 1, 0, 0);
      return { lowerMs: lower, upperMs: upper };
    }
    case 'century': {
      const start = Math.floor(y / 100) * 100;
      const lower = epochMs(start, 1, 1, 0, 0);
      const upper = epochMs(start + 100, 1, 1, 0, 0);
      return { lowerMs: lower, upperMs: upper };
    }
  }
}

// The best-guess instant of an endpoint: the middle of its half-open precision
// window. For day precision this is noon; for a year, ~1 Jul. Integer bigint
// division truncates by ≤1ms, which is immaterial at any drawn scale.
function midpoint(b: Bounds): bigint {
  return (b.lowerMs + b.upperMs) / BigInt(2);
}

// A datetime as captured by the editor: a point (one endpoint) or a range (two
// endpoints, each with its own precision). Mirrors the API payload.
export type DatetimeInput = {
  isRange: boolean;
  start: DatetimeParts;
  startPrecision: Precision;
  end?: DatetimeParts;
  endPrecision?: Precision;
};

// The four derived bounds a timeline entry needs. For a point, core bounds are
// null and [lowerMs, upperMs] is the single faded band. For a range the solid
// bar spans each endpoint's *best-guess* moment — the midpoint of its precision
// window (noon for a day, mid-year for a year, …) — and the faded whiskers run
// from there out to the window edges:
//   lowerMs     = start.lower    (outer edge of the left whisker)
//   coreLowerMs = mid(start)     (left edge of the solid bar — the start's best guess)
//   coreUpperMs = mid(end)       (right edge of the solid bar — the end's best guess)
//   upperMs     = end.upper      (outer edge of the right whisker)
export type DerivedBounds = {
  lowerMs: bigint;
  upperMs: bigint;
  coreLowerMs: bigint | null;
  coreUpperMs: bigint | null;
};

// ── canonical value strings ──────────────────────────────────────────────────
//
// The raw `startValue` / `endValue` columns store one endpoint as a canonical
// string so the editor can round-trip it. Format is a fixed, precision-agnostic
// encoding: `YYYY-MM-DDTHH:MM` with a leading sign for BC/ancient years, e.g.
// "1994-07-08T13:45", "0044-03-15T00:00" (44 AD), "-0043-12-07T00:00" (44 BC).
// The year is zero-padded to at least 4 digits after the sign. Fields below the
// endpoint's precision are still written (defaulted) but ignored on read.

function padYear(year: number): string {
  const sign = year < 0 ? '-' : '';
  const abs = Math.abs(year).toString().padStart(4, '0');
  return sign + abs;
}

function pad2(n: number): string {
  return Math.abs(n).toString().padStart(2, '0');
}

export function partsToValue(parts: DatetimeParts): string {
  return (
    `${padYear(parts.year)}-${pad2(parts.month ?? 1)}-${pad2(parts.day ?? 1)}` +
    `T${pad2(parts.hour ?? 0)}:${pad2(parts.minute ?? 0)}`
  );
}

export function valueToParts(value: string): DatetimeParts {
  // Split off a leading sign so the year can be negative or > 4 digits.
  const m = /^(-?)(\d+)-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Invalid datetime value: ${value}`);
  const sign = m[1] === '-' ? -1 : 1;
  return {
    year: sign * Number(m[2]),
    month: Number(m[3]),
    day: Number(m[4]),
    hour: Number(m[5]),
    minute: Number(m[6]),
  };
}

export function isPrecision(value: unknown): value is Precision {
  return typeof value === 'string' && (PRECISIONS as string[]).includes(value);
}

/**
 * Derive the timeline bounds for a datetime input. Throws on a reversed range
 * (end strictly before start) so callers can surface / offer to swap it.
 */
export function deriveBounds(input: DatetimeInput): DerivedBounds {
  const start = precisionBounds(input.start, input.startPrecision);

  if (!input.isRange) {
    return {
      lowerMs: start.lowerMs,
      upperMs: start.upperMs,
      coreLowerMs: null,
      coreUpperMs: null,
    };
  }

  if (!input.end || !input.endPrecision) {
    throw new Error('Range datetime requires an end endpoint and precision.');
  }
  const end = precisionBounds(input.end, input.endPrecision);

  // Reversed range: the end's window lies entirely before the start's.
  if (end.upperMs <= start.lowerMs) {
    throw new Error('Range end is before its start.');
  }

  return {
    lowerMs: start.lowerMs,
    upperMs: end.upperMs,
    coreLowerMs: midpoint(start),
    coreUpperMs: midpoint(end),
  };
}

// The stored/raw shape of a datetime as it lives on the API and in the DB
// (canonical value strings + precision names), used by the server to recompute
// bounds authoritatively.
export type RawDatetime = {
  isRange: boolean;
  startValue: string;
  startPrecision: Precision;
  endValue: string | null;
  endPrecision: Precision | null;
};

// Recompute bounds from the raw stored fields (the server's authoritative path).
export function deriveBoundsFromRaw(raw: RawDatetime): DerivedBounds {
  return deriveBounds({
    isRange: raw.isRange,
    start: valueToParts(raw.startValue),
    startPrecision: raw.startPrecision,
    end:
      raw.isRange && raw.endValue ? valueToParts(raw.endValue) : undefined,
    endPrecision: raw.isRange ? raw.endPrecision ?? undefined : undefined,
  });
}

// ── human-readable summaries ─────────────────────────────────────────────────

export const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Render one endpoint as a short human phrase, e.g. "8 Jul 1994", "Mar 1995",
// "the 1980s", "44 BC". Astronomical years ≤ 0 are shown as BC (year 0 = 1 BC).
export function humanEndpoint(
  parts: DatetimeParts,
  precision: Precision,
): string {
  const y = parts.year;
  const era = y <= 0 ? 'BC' : 'AD';
  const displayYear = y <= 0 ? 1 - y : y;
  const mo = MONTH_NAMES[(parts.month ?? 1) - 1] ?? '?';
  const d = parts.day ?? 1;
  const h = pad2(parts.hour ?? 0);
  const mi = pad2(parts.minute ?? 0);
  const yr = era === 'BC' ? `${displayYear} BC` : `${displayYear}`;

  switch (precision) {
    case 'minute':
      return `${d} ${mo} ${yr} ${h}:${mi}`;
    case 'hour':
      return `${d} ${mo} ${yr}, ${h}:00`;
    case 'day':
      return `${d} ${mo} ${yr}`;
    case 'month':
      return `${mo} ${yr}`;
    case 'year':
      return yr;
    case 'decade': {
      const start = Math.floor(y / 10) * 10;
      return era === 'BC'
        ? `the ${Math.abs(start) + 0}s BC`
        : `the ${start}s`;
    }
    case 'century': {
      const start = Math.floor(y / 100) * 100;
      return era === 'BC'
        ? `the ${Math.abs(start)}s BC`
        : `the ${start}s`;
    }
  }
}

// A one-line summary of a whole datetime (point or range), e.g.
// "the 1980s → Mar 1995" or "8 Jul 1994 13:45".
export function humanDatetime(input: DatetimeInput): string {
  const start = humanEndpoint(input.start, input.startPrecision);
  if (!input.isRange || !input.end || !input.endPrecision) return start;
  return `${start} → ${humanEndpoint(input.end, input.endPrecision)}`;
}
