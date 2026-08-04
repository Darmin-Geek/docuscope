import { api } from './apiClient';
import { isPdf, extractPdfText } from './pdfText';
import { ALL_SEARCH_FIELDS, type SearchField } from './searchScope';
import type { Precision } from './datetimePrecision';

// All data access for projects goes through these functions so UI components
// never call the API directly (mirrors the old Firebase design principle).

export type Project = {
  id: string;
  title: string;
  contributors: string[];
};

export type Folder = {
  id: string;
  folderName: string;
  parentId: string | null;
};

// `kind` distinguishes labels applied to whole files ('file') from labels
// applied to individual pieces of information ('information'). The two sets are
// managed and displayed separately (see issue #75).
export type LabelKind = 'file' | 'information';

export type Label = {
  id: string;
  label: string;
  color: string;
  kind: LabelKind;
};

export type FileDoc = {
  id: string;
  filename: string;
  author: string | null;
  createdDate: number | null;
  storageReference: string;
  overallBias: string | null;
  source: string | null;
  fileReliability: string | null;
  fileCredibility: string | null;
  // Admiralty-code ratings (issue #80). Reliability is an Alpha code A-F,
  // credibility a numeric code 1-6; both null until the user picks one.
  fileReliabilityCode: string | null;
  fileCredibilityCode: string | null;
  checkedOutBy: string | null;
  // Soft-delete marker (issue #100). NULL for every file the API returns —
  // deleted files are filtered out server-side — but kept on the type so the
  // shape matches the DB row.
  deletedOn: number | null;
  labels: string[];
  folderId: string | null;
};

export type Information = {
  id: string;
  informationTitle: string;
  informationText: string | null;
  overallBias: string | null;
  informationReliability: string | null;
  informationCredibility: string | null;
  // Admiralty-code ratings (issue #80), mirroring the file-level fields.
  informationReliabilityCode: string | null;
  informationCredibilityCode: string | null;
  // Ids of the 'information'-kind labels assigned to this piece of information.
  labels: string[];
};

// The editable fields of a piece of information. Labels are assigned through
// their own endpoints (addLabelToInformation/removeLabelFromInformation), not
// through the information create/update body, so they are excluded here.
export type InformationFields = Omit<Information, 'id' | 'labels'>;

// A flat highlight rectangle in PDF page coordinates (points, unscaled). Mirrors
// the same-named type in lib/drizzle/schema.ts; kept separate so this client
// module never imports server-only schema code.
export type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// A passage of a file's PDF that a piece of information is based on. Ordered by
// location in the document (page, then top-to-bottom) when listed.
export type Selection = {
  id: string;
  pageIndex: number;
  boundingTop: number;
  boundingLeft: number;
  rects: SelectionRect[];
  text: string;
};

export type SelectionFields = Omit<Selection, 'id'>;

// The whole editable payload for a file — metadata, information rows, and their
// PDF selections — staged as one snapshot (issue #78). Save writes this to the
// draft store; Submit applies it to the main tables and clears the draft. New
// information rows and selections carry client-generated UUIDs so they can hold
// child rows before they are first persisted. Mirrors the same-named type in
// lib/drizzle/schema.ts; kept here so client code never imports server schema.
export type FileDraftSnapshot = {
  metadata: {
    author: string | null;
    createdDate: number | null; // unix seconds
    overallBias: string | null;
    source: string | null;
    fileReliability: string | null;
    fileCredibility: string | null;
    fileReliabilityCode: string | null; // Admiralty Alpha code A-F (issue #80)
    fileCredibilityCode: string | null; // Admiralty numeric code 1-6 (issue #80)
  };
  information: Array<{
    id: string;
    informationTitle: string;
    informationText: string | null;
    overallBias: string | null;
    informationReliability: string | null;
    informationCredibility: string | null;
    informationReliabilityCode: string | null;
    informationCredibilityCode: string | null;
    // Assigned 'information'-kind label ids (Option 2 — labels/dates ride in the
    // draft so they can attach to a not-yet-submitted row and persist on Submit).
    labels: string[];
    // Datetimes staged on the row. Only the RAW input is stored — bounds are
    // always re-derived server-side on Submit. `id` is the existing DB id for a
    // published datetime or a client UUID for a new one; keeping it stable lets
    // Submit upsert by id so timeline_entries pins survive.
    datetimes: Array<{
      id: string;
      isRange: boolean;
      startValue: string;
      startPrecision: Precision;
      endValue: string | null;
      endPrecision: Precision | null;
    }>;
    selections: Array<{
      id: string;
      pageIndex: number;
      boundingTop: number;
      boundingLeft: number;
      rects: SelectionRect[];
      text: string;
    }>;
  }>;
};

// ── projects ──────────────────────────────────────────────────────────────────

export async function getProjectsForUser(_email: string): Promise<Project[]> {
  return api<Project[]>('/api/projects');
}

export async function createProject(
  title: string,
  _creatorEmail: string,
  contributorEmails: string[] = [],
): Promise<string> {
  const { id } = await api<{ id: string }>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ title, contributorEmails }),
  });
  return id;
}

export async function updateProjectTitle(projectId: string, title: string): Promise<void> {
  await api(`/api/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function addContributor(projectId: string, email: string): Promise<string> {
  const { email: normalized } = await api<{ email: string }>(
    `/api/projects/${projectId}/contributors`,
    { method: 'POST', body: JSON.stringify({ email }) },
  );
  return normalized;
}

export async function removeContributor(projectId: string, email: string): Promise<void> {
  await api(`/api/projects/${projectId}/contributors/${encodeURIComponent(email)}`, {
    method: 'DELETE',
  });
}

// ── folders ───────────────────────────────────────────────────────────────────

export async function getFolders(projectId: string): Promise<Folder[]> {
  return api<Folder[]>(`/api/projects/${projectId}/folders`);
}

export async function createFolder(
  projectId: string,
  folderName: string,
  parentId: string | null,
): Promise<Folder> {
  return api<Folder>(`/api/projects/${projectId}/folders`, {
    method: 'POST',
    body: JSON.stringify({ folderName, parentId }),
  });
}

export async function getFolderFileIds(
  projectId: string,
): Promise<Map<string, Set<string>>> {
  const obj = await api<Record<string, string[]>>(
    `/api/projects/${projectId}/files/folder-file-ids`,
  );
  const map = new Map<string, Set<string>>();
  for (const [folderId, fileIds] of Object.entries(obj)) {
    map.set(folderId, new Set(fileIds));
  }
  return map;
}

export async function moveFile(
  projectId: string,
  fileId: string,
  toFolderId: string | null,
): Promise<void> {
  await api(`/api/projects/${projectId}/files/${fileId}/move`, {
    method: 'PATCH',
    body: JSON.stringify({ toFolderId }),
  });
}

// Soft-delete a file (issue #100). The server requires the caller to currently
// hold the file's checkout and rejects with 409 otherwise.
export async function deleteFile(projectId: string, fileId: string): Promise<void> {
  await api(`/api/projects/${projectId}/files/${fileId}`, {
    method: 'DELETE',
  });
}

// ── files ─────────────────────────────────────────────────────────────────────

export async function getFiles(
  projectId: string,
  folderId: string | null = null,
  search: string = '',
  fields?: SearchField[],
): Promise<FileDoc[]> {
  const params = new URLSearchParams();
  if (folderId) params.set('folderId', folderId);
  if (search.trim()) params.set('q', search.trim());
  // The `fields` scope only affects a search, and only when it actually narrows
  // things (a full scope is the server default, so we omit it to keep URLs and
  // caching identical to the unscoped case).
  if (
    search.trim() &&
    fields &&
    fields.length > 0 &&
    fields.length < ALL_SEARCH_FIELDS.length
  ) {
    params.set('fields', fields.join(','));
  }
  const qs = params.size ? `?${params}` : '';
  return api<FileDoc[]>(`/api/projects/${projectId}/files${qs}`);
}

export async function getFile(projectId: string, fileId: string): Promise<FileDoc> {
  return api<FileDoc>(`/api/projects/${projectId}/files/${fileId}`);
}

/**
 * Upload flow:
 * 1. Request a pre-signed S3 PUT URL from the server.
 * 2. In parallel: PUT the file bytes to S3, and (for PDFs) extract the text in
 *    the browser. The S3 upload and text extraction run concurrently since
 *    neither depends on the other.
 * 3. Create the DB record via POST /files, sending the extracted text so the
 *    server can chunk and index it.
 */
export async function uploadFile(
  projectId: string,
  file: File,
  author: string | null,
  folderId: string | null = null,
): Promise<FileDoc> {
  const { url, key } = await api<{ url: string; key: string }>(
    `/api/projects/${projectId}/files/upload-url`,
    {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, contentType: file.type }),
    },
  );

  const upload = fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  }).then((res) => {
    if (!res.ok) throw new Error('Failed to upload file to storage.');
  });

  // Text extraction failure (e.g. a corrupt or image-only PDF) must not block
  // the upload — the file is still stored, just without searchable chunks.
  const extract = isPdf(file)
    ? extractPdfText(file).catch(() => null)
    : Promise.resolve(null);

  const [, text] = await Promise.all([upload, extract]);

  return api<FileDoc>(`/api/projects/${projectId}/files`, {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, storageReference: key, author, folderId, text }),
  });
}

export async function updateFileMetadata(
  projectId: string,
  fileId: string,
  metadata: {
    author: string | null;
    createdDate: number | null;
    overallBias: string | null;
    source: string | null;
    fileReliability: string | null;
    fileCredibility: string | null;
    fileReliabilityCode: string | null;
    fileCredibilityCode: string | null;
  },
): Promise<void> {
  await api(`/api/projects/${projectId}/files/${fileId}`, {
    method: 'PATCH',
    body: JSON.stringify(metadata),
  });
}

export async function checkOutFile(
  projectId: string,
  fileId: string,
  _uid: string,
): Promise<boolean> {
  const { claimed } = await api<{ claimed: boolean }>(
    `/api/projects/${projectId}/files/${fileId}/checkout`,
    { method: 'POST' },
  );
  return claimed;
}

export async function checkInFile(projectId: string, fileId: string): Promise<void> {
  await api(`/api/projects/${projectId}/files/${fileId}/checkout`, {
    method: 'DELETE',
  });
}

export async function getFileDownloadUrl(projectId: string, fileId: string): Promise<string> {
  const { url } = await api<{ url: string }>(
    `/api/projects/${projectId}/files/${fileId}/download-url`,
  );
  return url;
}

// Status of an asynchronous OCR job. `null` status means no job has ever run
// for the file. OCR runs in the background, so the UI starts a job and polls.
export type OcrJobStatus = 'pending' | 'running' | 'done' | 'error';

export interface OcrStatus {
  hasChunks: boolean;
  status: OcrJobStatus | null;
  error: string | null;
}

export async function checkOcrStatus(
  projectId: string,
  fileId: string,
): Promise<OcrStatus> {
  return api<OcrStatus>(`/api/projects/${projectId}/files/${fileId}/ocr`);
}

// Enqueues an OCR job and returns immediately; the work runs in the background.
// Poll checkOcrStatus to observe progress. A 409 ("Conflict") means a job is
// already in progress for this file.
export async function ocrFile(
  projectId: string,
  fileId: string,
): Promise<{ jobId: string; status: OcrJobStatus }> {
  return api<{ jobId: string; status: OcrJobStatus }>(
    `/api/projects/${projectId}/files/${fileId}/ocr`,
    { method: 'POST' },
  );
}

// ── information ───────────────────────────────────────────────────────────────

export async function getInformation(
  projectId: string,
  fileId: string,
): Promise<Information[]> {
  return api<Information[]>(`/api/projects/${projectId}/files/${fileId}/information`);
}

export function newInformationId(_projectId: string, _fileId: string): string {
  return crypto.randomUUID();
}

export async function addInformation(
  projectId: string,
  fileId: string,
  fields: InformationFields,
  id?: string,
): Promise<string> {
  const { id: newId } = await api<{ id: string }>(
    `/api/projects/${projectId}/files/${fileId}/information`,
    { method: 'POST', body: JSON.stringify({ ...fields, id }) },
  );
  return newId;
}

export async function updateInformation(
  projectId: string,
  fileId: string,
  informationId: string,
  fields: InformationFields,
): Promise<void> {
  await api(`/api/projects/${projectId}/files/${fileId}/information/${informationId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export async function deleteInformation(
  projectId: string,
  fileId: string,
  informationId: string,
): Promise<void> {
  await api(
    `/api/projects/${projectId}/files/${fileId}/information/${informationId}`,
    { method: 'DELETE' },
  );
}

// ── selections ────────────────────────────────────────────────────────────────

export async function getSelections(
  projectId: string,
  fileId: string,
  informationId: string,
): Promise<Selection[]> {
  return api<Selection[]>(
    `/api/projects/${projectId}/files/${fileId}/information/${informationId}/selections`,
  );
}

export async function addSelection(
  projectId: string,
  fileId: string,
  informationId: string,
  fields: SelectionFields[],
): Promise<string[]> {
  const { ids } = await api<{ ids: string[] }>(
    `/api/projects/${projectId}/files/${fileId}/information/${informationId}/selections`,
    { method: 'POST', body: JSON.stringify(fields) },
  );
  return ids;
}

export async function deleteSelection(
  projectId: string,
  fileId: string,
  informationId: string,
  selectionId: string,
): Promise<void> {
  await api(
    `/api/projects/${projectId}/files/${fileId}/information/${informationId}/selections/${selectionId}`,
    { method: 'DELETE' },
  );
}

// ── drafts (manual save / submit, issue #78) ────────────────────────────────────

// Returns the staged draft snapshot for the current user on this file, or null.
export async function getDraft(
  projectId: string,
  fileId: string,
): Promise<FileDraftSnapshot | null> {
  return api<FileDraftSnapshot | null>(
    `/api/projects/${projectId}/files/${fileId}/draft`,
  );
}

// Save: stage the snapshot to the draft store (PUT). Does not touch main tables.
export async function saveDraft(
  projectId: string,
  fileId: string,
  snapshot: FileDraftSnapshot,
): Promise<void> {
  await api(`/api/projects/${projectId}/files/${fileId}/draft`, {
    method: 'PUT',
    body: JSON.stringify(snapshot),
  });
}

// Submit: publish the snapshot into the main tables and clear the draft (POST).
export async function submitDraft(
  projectId: string,
  fileId: string,
  snapshot: FileDraftSnapshot,
): Promise<void> {
  await api(`/api/projects/${projectId}/files/${fileId}/submit`, {
    method: 'POST',
    body: JSON.stringify(snapshot),
  });
}

// Discard: delete the stored draft (DELETE).
export async function discardDraft(
  projectId: string,
  fileId: string,
): Promise<void> {
  await api(`/api/projects/${projectId}/files/${fileId}/draft`, {
    method: 'DELETE',
  });
}

// ── field version history ───────────────────────────────────────────────────────

// One recorded value of a field, newest-first within its field's timeline.
// `value` is the value as text (null = the field was cleared / empty);
// `editorName` is the display name captured when the edit was published.
export type FieldVersion = {
  value: string | null;
  editorName: string;
  createdAt: number; // epoch ms
};

// All versions for an entity, keyed by field name (e.g. 'author'), each list
// ordered newest-first.
export type FieldHistory = Record<string, FieldVersion[]>;

export async function getFileHistory(
  projectId: string,
  fileId: string,
): Promise<FieldHistory> {
  return api<FieldHistory>(`/api/projects/${projectId}/files/${fileId}/history`);
}

export async function getInformationHistory(
  projectId: string,
  fileId: string,
  informationId: string,
): Promise<FieldHistory> {
  return api<FieldHistory>(
    `/api/projects/${projectId}/files/${fileId}/information/${informationId}/history`,
  );
}

// ── labels ────────────────────────────────────────────────────────────────────

export async function getLabels(projectId: string): Promise<Label[]> {
  return api<Label[]>(`/api/projects/${projectId}/labels`);
}

export async function createLabel(
  projectId: string,
  label: string,
  color: string,
  kind: LabelKind = 'file',
): Promise<Label> {
  return api<Label>(`/api/projects/${projectId}/labels`, {
    method: 'POST',
    body: JSON.stringify({ label, color, kind }),
  });
}

export async function updateLabel(
  projectId: string,
  labelId: string,
  fields: { label: string; color: string },
): Promise<void> {
  await api(`/api/projects/${projectId}/labels/${labelId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export async function deleteLabel(projectId: string, labelId: string): Promise<void> {
  await api(`/api/projects/${projectId}/labels/${labelId}`, { method: 'DELETE' });
}

export async function addLabelToFile(
  projectId: string,
  fileId: string,
  labelId: string,
): Promise<void> {
  await api(`/api/projects/${projectId}/files/${fileId}/labels`, {
    method: 'POST',
    body: JSON.stringify({ labelId }),
  });
}

export async function removeLabelFromFile(
  projectId: string,
  fileId: string,
  labelId: string,
): Promise<void> {
  await api(`/api/projects/${projectId}/files/${fileId}/labels/${labelId}`, {
    method: 'DELETE',
  });
}

export async function addLabelToInformation(
  projectId: string,
  fileId: string,
  informationId: string,
  labelId: string,
): Promise<void> {
  await api(
    `/api/projects/${projectId}/files/${fileId}/information/${informationId}/labels`,
    { method: 'POST', body: JSON.stringify({ labelId }) },
  );
}

export async function removeLabelFromInformation(
  projectId: string,
  fileId: string,
  informationId: string,
  labelId: string,
): Promise<void> {
  await api(
    `/api/projects/${projectId}/files/${fileId}/information/${informationId}/labels/${labelId}`,
    { method: 'DELETE' },
  );
}
