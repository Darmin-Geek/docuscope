import { api } from './apiClient';
import type { Precision } from './datetimePrecision';

// Client API wrappers + shared types for the timeline feature (mirrors the
// projects.ts / projects.server.ts split). UI components import from here and
// never touch the database directly.
//
// All routes are project-nested so authorization is a single requireContributor
// check on the server (matching every other endpoint in this app):
//   /api/projects/:pid/timelines[...]
//   /api/projects/:pid/files/:fileId/information/:infoId/datetimes[...]

export type { Precision } from './datetimePrecision';

// ── datetimes ───────────────────────────────────────────────────────────────

// A datetime attached to a piece of information. `*Value` are canonical strings
// (see partsToValue in datetimePrecision.ts); `*Ms` are the derived epoch-ms
// bounds the timeline draws, sent as plain numbers (JSON has no bigint, and a
// JS number holds every millisecond across human history exactly). Core bounds
// are null for a point.
export type InformationDatetime = {
  id: string;
  informationId: string;
  isRange: boolean;
  startValue: string;
  startPrecision: Precision;
  endValue: string | null;
  endPrecision: Precision | null;
  lowerMs: number;
  upperMs: number;
  coreLowerMs: number | null;
  coreUpperMs: number | null;
};

// The editor's payload: raw value strings + precisions. The server derives the
// bounds authoritatively (so the client can't persist inconsistent bounds).
export type DatetimeInputPayload = {
  isRange: boolean;
  startValue: string;
  startPrecision: Precision;
  endValue: string | null;
  endPrecision: Precision | null;
};

export async function getDatetimes(
  projectId: string,
  fileId: string,
  informationId: string,
): Promise<InformationDatetime[]> {
  return api<InformationDatetime[]>(
    `/api/projects/${projectId}/files/${fileId}/information/${informationId}/datetimes`,
  );
}

export async function addDatetime(
  projectId: string,
  fileId: string,
  informationId: string,
  payload: DatetimeInputPayload,
): Promise<InformationDatetime> {
  return api<InformationDatetime>(
    `/api/projects/${projectId}/files/${fileId}/information/${informationId}/datetimes`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function updateDatetime(
  projectId: string,
  fileId: string,
  informationId: string,
  datetimeId: string,
  payload: DatetimeInputPayload,
): Promise<InformationDatetime> {
  return api<InformationDatetime>(
    `/api/projects/${projectId}/files/${fileId}/information/${informationId}/datetimes/${datetimeId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
}

export async function deleteDatetime(
  projectId: string,
  fileId: string,
  informationId: string,
  datetimeId: string,
): Promise<void> {
  await api(
    `/api/projects/${projectId}/files/${fileId}/information/${informationId}/datetimes/${datetimeId}`,
    { method: 'DELETE' },
  );
}

// ── timelines ───────────────────────────────────────────────────────────────

// A named timeline in a project. `defaultStartMs` (left edge) + `defaultSpanMs`
// (window width / zoom) persist the view restored when the timeline is opened;
// both null ⇒ fit-all. Sent as numbers (epoch ms) for the same reason as above.
export type Timeline = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  defaultStartMs: number | null;
  defaultSpanMs: number | null;
  createdAt: number;
};

// A datetime pinned to a timeline, joined to its information so the renderer has
// everything it needs (title to label the bar, fileId/informationId to open the
// information view on click) in one call.
export type TimelineEntry = {
  datetimeId: string;
  informationId: string;
  fileId: string;
  title: string;
  isRange: boolean;
  lowerMs: number;
  upperMs: number;
  coreLowerMs: number | null;
  coreUpperMs: number | null;
};

export async function getTimelines(projectId: string): Promise<Timeline[]> {
  return api<Timeline[]>(`/api/projects/${projectId}/timelines`);
}

export async function createTimeline(
  projectId: string,
  fields: { title: string; description?: string | null },
): Promise<Timeline> {
  return api<Timeline>(`/api/projects/${projectId}/timelines`, {
    method: 'POST',
    body: JSON.stringify({
      title: fields.title,
      description: fields.description ?? null,
    }),
  });
}

// Partial update: any of title / description / default view. `defaultStartMs`
// and `defaultSpanMs` are sent together to snapshot the current pan+zoom (or
// both null to clear back to fit-all).
export type TimelineUpdate = {
  title?: string;
  description?: string | null;
  defaultStartMs?: number | null;
  defaultSpanMs?: number | null;
};

export async function updateTimeline(
  projectId: string,
  timelineId: string,
  update: TimelineUpdate,
): Promise<void> {
  await api(`/api/projects/${projectId}/timelines/${timelineId}`, {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
}

export async function deleteTimeline(
  projectId: string,
  timelineId: string,
): Promise<void> {
  await api(`/api/projects/${projectId}/timelines/${timelineId}`, {
    method: 'DELETE',
  });
}

export async function getTimelineEntries(
  projectId: string,
  timelineId: string,
): Promise<TimelineEntry[]> {
  return api<TimelineEntry[]>(
    `/api/projects/${projectId}/timelines/${timelineId}/entries`,
  );
}

export async function addTimelineEntry(
  projectId: string,
  timelineId: string,
  datetimeId: string,
): Promise<void> {
  await api(`/api/projects/${projectId}/timelines/${timelineId}/entries`, {
    method: 'POST',
    body: JSON.stringify({ datetimeId }),
  });
}

export async function removeTimelineEntry(
  projectId: string,
  timelineId: string,
  datetimeId: string,
): Promise<void> {
  await api(
    `/api/projects/${projectId}/timelines/${timelineId}/entries/${datetimeId}`,
    { method: 'DELETE' },
  );
}
