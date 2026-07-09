// Pure rendering helpers for the timeline canvas — adaptive multi-scale ticks
// and greedy lane packing. Kept free of React/DOM so they are unit-testable in
// isolation (see tests/timeline.test.ts). Ported from the reference logic in
// docs/timeline-feature-plan.html §6.3.2 / §7.
//
// All times are epoch-milliseconds as plain numbers. Bounds are stored as signed
// bigint but converted to number for drawing; JS Number represents every
// millisecond across human history exactly, so this is lossless in practice.

export const MS_DAY = 86_400_000;
export const MS_HR = 3_600_000;
export const MS_MIN = 60_000;
export const MS_YR = 365.25 * MS_DAY;

const MON = [
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

export type Tick = {
  ms: number;
  label: string;
  // Major ticks are emphasised (taller/darker) and mark a parent-unit boundary
  // (January when showing months, midnight when showing hours, etc.).
  major: boolean;
};

// The tick unit chosen for a visible span — also drives the "scale: …" readout.
export type TickUnit = 'years' | 'months' | 'days' | 'hours' | 'minutes';

export function tickUnitForSpan(span: number): TickUnit {
  if (span > 3 * MS_YR) return 'years';
  if (span > 110 * MS_DAY) return 'months';
  if (span > 4 * MS_DAY) return 'days';
  if (span > 4 * MS_HR) return 'hours';
  return 'minutes';
}

const yy = (ms: number) => String(new Date(ms).getUTCFullYear());

/**
 * Adaptive calendar ticks for the visible window [lo, hi]. As the window
 * shrinks the unit steps down years → months → days → hours → minutes, each
 * snapped to real calendar boundaries, with major boundaries flagged. Aims for
 * ~6-10 readable ticks.
 */
export function ticks(lo: number, hi: number): Tick[] {
  const span = hi - lo;
  const out: Tick[] = [];
  const push = (ms: number, label: string, major: boolean) => {
    if (ms >= lo - 1 && ms <= hi + 1) out.push({ ms, label, major });
  };

  if (span > 3 * MS_YR) {
    // YEARS — pick a "nice" step so ~8 ticks show.
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
    const step = steps.find((s) => s >= span / MS_YR / 8) ?? 1000;
    const y0 = Math.ceil(new Date(lo).getUTCFullYear() / step) * step;
    for (let y = y0; Date.UTC(y, 0, 1) <= hi; y += step) {
      push(Date.UTC(y, 0, 1), String(y), y % (step * 5) === 0);
    }
  } else if (span > 110 * MS_DAY) {
    // MONTHS
    const step = span > 430 * MS_DAY ? 3 : 1;
    const d = new Date(lo);
    const y = d.getUTCFullYear();
    let m = Math.floor(d.getUTCMonth() / step) * step;
    for (let ms = Date.UTC(y, m, 1); ms <= hi; m += step, ms = Date.UTC(y, m, 1)) {
      const dd = new Date(ms);
      const M = dd.getUTCMonth();
      push(ms, M === 0 ? `${MON[M]} '${yy(ms).slice(2)}` : MON[M], M === 0);
    }
  } else if (span > 4 * MS_DAY) {
    // DAYS
    const step = span > 18 * MS_DAY ? 7 : span > 9 * MS_DAY ? 2 : 1;
    for (let ms = Math.floor(lo / MS_DAY) * MS_DAY; ms <= hi; ms += step * MS_DAY) {
      const dd = new Date(ms);
      const first = dd.getUTCDate() === 1;
      push(
        ms,
        first ? `${MON[dd.getUTCMonth()]}` : `${dd.getUTCDate()} ${MON[dd.getUTCMonth()]}`,
        first,
      );
    }
  } else if (span > 4 * MS_HR) {
    // HOURS
    const step = span > 36 * MS_HR ? 6 : span > 12 * MS_HR ? 3 : 1;
    for (let ms = Math.floor(lo / MS_HR) * MS_HR; ms <= hi; ms += step * MS_HR) {
      const dd = new Date(ms);
      const h = dd.getUTCHours();
      const mid = h === 0;
      push(
        ms,
        mid
          ? `${dd.getUTCDate()} ${MON[dd.getUTCMonth()]}`
          : `${String(h).padStart(2, '0')}:00`,
        mid,
      );
    }
  } else {
    // MINUTES
    const step = span > 28 * MS_MIN ? 15 : span > 9 * MS_MIN ? 5 : 1;
    for (let ms = Math.floor(lo / MS_MIN) * MS_MIN; ms <= hi; ms += step * MS_MIN) {
      const dd = new Date(ms);
      push(
        ms,
        `${String(dd.getUTCHours()).padStart(2, '0')}:${String(
          dd.getUTCMinutes(),
        ).padStart(2, '0')}`,
        dd.getUTCMinutes() === 0,
      );
    }
  }
  return out;
}

// An entry positioned in pixel space, ready for lane assignment. leftPx is the
// bar's left edge; rightPx already includes the label width (and whiskers) so
// touching bars/labels don't collide.
export type Packable = {
  leftPx: number;
  rightPx: number;
};

export type Packed<T extends Packable> = T & { lane: number };

// Horizontal gap (px) required between two bars sharing a lane.
export const LANE_GAP = 6;

/**
 * Greedy lane packing (interval-partition / greedy colouring). Entries are
 * sorted by leftPx, then each is assigned to the lowest lane whose last bar ends
 * (+GAP) before this bar's left edge; otherwise a new lane is opened. Returns
 * the entries with a `lane` field and the total lane count.
 */
export function assignLanes<T extends Packable>(
  entries: T[],
  gap: number = LANE_GAP,
): { packed: Packed<T>[]; laneCount: number } {
  const sorted = [...entries].sort((a, b) => a.leftPx - b.leftPx);
  const laneEnds: number[] = []; // rightmost px used per lane
  const packed: Packed<T>[] = [];
  for (const e of sorted) {
    let lane = laneEnds.findIndex((end) => end < e.leftPx - gap);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = e.rightPx;
    packed.push({ ...e, lane });
  }
  return { packed, laneCount: laneEnds.length };
}
