import { db } from './drizzle/db';
import { eq, and, asc, isNull } from 'drizzle-orm';
import {
  informationDatetimes,
  timelines as timelinesTable,
  timelineEntries,
  information as informationTable,
  files as filesTable,
} from './drizzle/schema';
import {
  deriveBoundsFromRaw,
  isPrecision,
  type Precision,
} from './datetimePrecision';
import type {
  InformationDatetime,
  DatetimeInputPayload,
  Timeline,
  TimelineEntry,
  TimelineUpdate,
} from './timelines';

// Server-side (Drizzle) implementations for the timeline feature. Imported only
// from API route handlers. Bounds are always recomputed here from the raw
// value+precision (deriveBoundsFromRaw) so a client can never persist
// inconsistent bounds. bigint columns are surfaced to callers as plain numbers
// (JSON has no bigint; a JS number holds every ms across human history exactly).

// ── shared guards ────────────────────────────────────────────────────────────

// Confirm the information row exists, belongs to the given file, and that file
// belongs to the given project. Mirrors requireInformation in projects.server.ts
// (kept local so this module has no cross-import). Throws 'Not found' otherwise.
async function requireInformation(
  projectId: string,
  fileId: string,
  informationId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: informationTable.id })
    .from(informationTable)
    .innerJoin(filesTable, eq(informationTable.fileId, filesTable.id))
    .where(
      and(
        eq(informationTable.id, informationId),
        eq(informationTable.fileId, fileId),
        eq(filesTable.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) throw new Error('Not found');
}

// Confirm a timeline exists and belongs to the given project.
async function requireTimeline(
  projectId: string,
  timelineId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: timelinesTable.id })
    .from(timelinesTable)
    .where(
      and(
        eq(timelinesTable.id, timelineId),
        eq(timelinesTable.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) throw new Error('Not found');
}

// ── datetimes ────────────────────────────────────────────────────────────────

type DatetimeRow = typeof informationDatetimes.$inferSelect;

function toDatetime(row: DatetimeRow): InformationDatetime {
  return {
    id: row.id,
    informationId: row.informationId,
    isRange: row.isRange,
    startValue: row.startValue,
    startPrecision: row.startPrecision as Precision,
    endValue: row.endValue,
    endPrecision: (row.endPrecision as Precision | null) ?? null,
    lowerMs: Number(row.lowerMs),
    upperMs: Number(row.upperMs),
    coreLowerMs: row.coreLowerMs == null ? null : Number(row.coreLowerMs),
    coreUpperMs: row.coreUpperMs == null ? null : Number(row.coreUpperMs),
  };
}

// Validate a raw editor payload and compute its derived bounds. Throws 'Invalid'
// for a bad precision / missing range endpoint / reversed range (surfaced as
// HTTP 400 by apiError). Exported so submitDraft (lib/projects.server.ts) can
// re-derive bounds server-side for datetimes staged in a draft snapshot — the
// client never sends bounds, so this stays the single derivation path.
export function validateAndDerive(payload: DatetimeInputPayload) {
  if (!isPrecision(payload.startPrecision)) throw new Error('Invalid');
  if (typeof payload.startValue !== 'string' || payload.startValue.trim() === '') {
    throw new Error('Invalid');
  }
  if (payload.isRange) {
    if (!payload.endValue || !isPrecision(payload.endPrecision)) {
      throw new Error('Invalid');
    }
  }
  try {
    const bounds = deriveBoundsFromRaw({
      isRange: payload.isRange,
      startValue: payload.startValue,
      startPrecision: payload.startPrecision,
      endValue: payload.isRange ? payload.endValue : null,
      endPrecision: payload.isRange ? payload.endPrecision : null,
    });
    return bounds;
  } catch {
    // Bad value string or reversed range → 400.
    throw new Error('Invalid');
  }
}

export async function getDatetimes(
  projectId: string,
  fileId: string,
  informationId: string,
): Promise<InformationDatetime[]> {
  await requireInformation(projectId, fileId, informationId);
  const rows = await db
    .select()
    .from(informationDatetimes)
    .where(eq(informationDatetimes.informationId, informationId))
    .orderBy(asc(informationDatetimes.lowerMs));
  return rows.map(toDatetime);
}

// Datetimes are created/updated/deleted through the file draft snapshot and
// reconciled inside submitDraft (Option 2), which re-derives bounds via the
// exported validateAndDerive above. There is no immediate datetime-write path.

// ── timelines ────────────────────────────────────────────────────────────────

type TimelineRow = typeof timelinesTable.$inferSelect;

function toTimeline(row: TimelineRow): Timeline {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    defaultStartMs: row.defaultStartMs == null ? null : Number(row.defaultStartMs),
    defaultSpanMs: row.defaultSpanMs == null ? null : Number(row.defaultSpanMs),
    createdAt: row.createdAt,
  };
}

export async function getTimelines(projectId: string): Promise<Timeline[]> {
  const rows = await db
    .select()
    .from(timelinesTable)
    .where(eq(timelinesTable.projectId, projectId))
    .orderBy(asc(timelinesTable.createdAt));
  return rows.map(toTimeline);
}

export async function createTimeline(
  projectId: string,
  fields: { title: string; description: string | null },
): Promise<Timeline> {
  const title = fields.title?.trim();
  if (!title) throw new Error('Invalid');
  const [row] = await db
    .insert(timelinesTable)
    .values({
      projectId,
      title,
      description: fields.description ?? null,
      createdAt: Date.now(),
    })
    .returning();
  return toTimeline(row);
}

export async function updateTimeline(
  projectId: string,
  timelineId: string,
  update: TimelineUpdate,
): Promise<void> {
  await requireTimeline(projectId, timelineId);

  const set: Partial<TimelineRow> = {};
  if (update.title !== undefined) {
    const t = update.title.trim();
    if (!t) throw new Error('Invalid');
    set.title = t;
  }
  if (update.description !== undefined) set.description = update.description;
  // defaultStartMs / defaultSpanMs travel together (both provided, or both
  // cleared to null). A number is stored as bigint.
  if (update.defaultStartMs !== undefined) {
    set.defaultStartMs =
      update.defaultStartMs == null ? null : BigInt(Math.round(update.defaultStartMs));
  }
  if (update.defaultSpanMs !== undefined) {
    set.defaultSpanMs =
      update.defaultSpanMs == null ? null : BigInt(Math.round(update.defaultSpanMs));
  }
  if (Object.keys(set).length === 0) return;

  await db
    .update(timelinesTable)
    .set(set)
    .where(
      and(
        eq(timelinesTable.id, timelineId),
        eq(timelinesTable.projectId, projectId),
      ),
    );
}

export async function deleteTimeline(
  projectId: string,
  timelineId: string,
): Promise<void> {
  await db
    .delete(timelinesTable)
    .where(
      and(
        eq(timelinesTable.id, timelineId),
        eq(timelinesTable.projectId, projectId),
      ),
    );
}

// ── timeline entries ───────────────────────────────────────────────────────────

export async function getTimelineEntries(
  projectId: string,
  timelineId: string,
): Promise<TimelineEntry[]> {
  await requireTimeline(projectId, timelineId);
  const rows = await db
    .select({
      datetimeId: informationDatetimes.id,
      informationId: informationDatetimes.informationId,
      fileId: informationTable.fileId,
      title: informationTable.informationTitle,
      isRange: informationDatetimes.isRange,
      lowerMs: informationDatetimes.lowerMs,
      upperMs: informationDatetimes.upperMs,
      coreLowerMs: informationDatetimes.coreLowerMs,
      coreUpperMs: informationDatetimes.coreUpperMs,
    })
    .from(timelineEntries)
    .innerJoin(
      informationDatetimes,
      eq(timelineEntries.datetimeId, informationDatetimes.id),
    )
    .innerJoin(
      informationTable,
      eq(informationDatetimes.informationId, informationTable.id),
    )
    // Join the owning file so a soft-deleted file's datetimes (issue #100) drop
    // off the timeline. Recovering the file (deleted_on → NULL) restores them.
    .innerJoin(filesTable, eq(informationTable.fileId, filesTable.id))
    .where(
      and(
        eq(timelineEntries.timelineId, timelineId),
        isNull(filesTable.deletedOn),
      ),
    )
    .orderBy(asc(informationDatetimes.lowerMs));

  return rows.map((r) => ({
    datetimeId: r.datetimeId,
    informationId: r.informationId,
    fileId: r.fileId,
    title: r.title,
    isRange: r.isRange,
    lowerMs: Number(r.lowerMs),
    upperMs: Number(r.upperMs),
    coreLowerMs: r.coreLowerMs == null ? null : Number(r.coreLowerMs),
    coreUpperMs: r.coreUpperMs == null ? null : Number(r.coreUpperMs),
  }));
}

// Pin a datetime to a timeline. The datetime's information must live in the same
// project as the timeline — otherwise a caller with access to project A could
// attach information from project B. Throws 'Not found' if the datetime is
// missing or cross-project. Idempotent (re-pinning is a no-op).
export async function addTimelineEntry(
  projectId: string,
  timelineId: string,
  datetimeId: string,
): Promise<void> {
  await requireTimeline(projectId, timelineId);

  const [row] = await db
    .select({ id: informationDatetimes.id })
    .from(informationDatetimes)
    .innerJoin(
      informationTable,
      eq(informationDatetimes.informationId, informationTable.id),
    )
    .innerJoin(filesTable, eq(informationTable.fileId, filesTable.id))
    .where(
      and(
        eq(informationDatetimes.id, datetimeId),
        eq(filesTable.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) throw new Error('Not found');

  await db
    .insert(timelineEntries)
    .values({ timelineId, datetimeId })
    .onConflictDoNothing();
}

export async function removeTimelineEntry(
  projectId: string,
  timelineId: string,
  datetimeId: string,
): Promise<void> {
  await requireTimeline(projectId, timelineId);
  await db
    .delete(timelineEntries)
    .where(
      and(
        eq(timelineEntries.timelineId, timelineId),
        eq(timelineEntries.datetimeId, datetimeId),
      ),
    );
}
