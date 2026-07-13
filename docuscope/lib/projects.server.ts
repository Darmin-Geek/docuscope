import { db } from './drizzle/db';
import { eq, and, or, ilike, inArray, isNull, lt, desc, getTableColumns, sql, type SQL } from 'drizzle-orm';
import {
  projects,
  projectContributors,
  labels as labelsTable,
  folders as foldersTable,
  files as filesTable,
  fileChunks,
  fileLabels,
  informationLabels,
  fileFolders,
  information as informationTable,
  informationSelections as selectionsTable,
  ocrJobs,
  fileDrafts,
  fileFieldVersions,
  informationFieldVersions,
  type FileDraftSnapshot,
} from './drizzle/schema';
import { getUidForEmail } from './users.server';
import { htmlOrNull } from './richText';
import type { SearchField } from './searchScope';
import { getCognitoProfile } from './cognito';
import { validateDraftForSubmit } from './draftValidation';
import type {
  Project,
  Folder,
  FileDoc,
  Label,
  LabelKind,
  Information,
  InformationFields,
  Selection,
  SelectionFields,
  OcrJobStatus,
  FieldHistory,
} from './projects';

// Labels seeded into every new project. File labels apply to whole files;
// information labels apply to individual pieces of information (see issue #75).
const DEFAULT_FILE_LABELS = [
  { label: 'Done', color: '#22c55e' },
];

const DEFAULT_INFORMATION_LABELS = [
  { label: 'Fact', color: '#22c55e' },
  { label: 'Opinion', color: '#3b82f6' },
  { label: 'Misinformation', color: '#f59e0b' },
  { label: 'Disinformation', color: '#ef4444' },
];

// ── text chunking ──────────────────────────────────────────────────────────────

// Chunk size and neighbour overlap, in words. Defaults are 1000-word chunks
// sharing 100 words with each adjacent chunk; both are configurable via env.
const CHUNK_SIZE_WORDS = Math.max(1, Number(process.env.CHUNK_SIZE_WORDS) || 1000);
const CHUNK_OVERLAP_WORDS = Math.min(
  CHUNK_SIZE_WORDS - 1,
  Math.max(0, Number(process.env.CHUNK_OVERLAP_WORDS) || 100),
);

/**
 * Splits text into overlapping chunks of words. Each chunk holds up to
 * CHUNK_SIZE_WORDS words, and consecutive chunks share CHUNK_OVERLAP_WORDS
 * words (so the trailing N words of one chunk are the leading N words of the
 * next). Returns an empty array for blank input.
 */
export function chunkText(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const step = CHUNK_SIZE_WORDS - CHUNK_OVERLAP_WORDS;
  const chunks: string[] = [];
  for (let start = 0; start < words.length; start += step) {
    chunks.push(words.slice(start, start + CHUNK_SIZE_WORDS).join(' '));
    if (start + CHUNK_SIZE_WORDS >= words.length) break;
  }
  return chunks;
}

// ── helpers ──────────────────────────────────────────────────────────────────

type FileRow = typeof filesTable.$inferSelect & { folderId: string | null };

async function attachLabels(rows: FileRow[]): Promise<FileDoc[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const labelRows = await db
    .select({ fileId: fileLabels.fileId, labelId: fileLabels.labelId })
    .from(fileLabels)
    .where(inArray(fileLabels.fileId, ids));
  const map = new Map<string, string[]>();
  for (const r of labelRows) {
    const arr = map.get(r.fileId) ?? [];
    arr.push(r.labelId);
    map.set(r.fileId, arr);
  }
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    author: r.author,
    createdDate: r.createdDate ?? null,
    storageReference: r.storageReference,
    overallBias: r.overallBias,
    source: r.source,
    fileReliability: r.fileReliability,
    fileCredibility: r.fileCredibility,
    fileReliabilityCode: r.fileReliabilityCode,
    fileCredibilityCode: r.fileCredibilityCode,
    checkedOutBy: r.checkedOutBy,
    labels: map.get(r.id) ?? [],
    folderId: r.folderId,
  }));
}

export async function requireContributor(projectId: string, email: string): Promise<void> {
  const [row] = await db
    .select({ projectId: projectContributors.projectId })
    .from(projectContributors)
    .where(
      and(
        eq(projectContributors.projectId, projectId),
        eq(projectContributors.email, email.trim().toLowerCase()),
      ),
    )
    .limit(1);
  if (!row) throw new Error('Forbidden');
}

// ── projects ─────────────────────────────────────────────────────────────────

export async function getProjectsForUser(email: string): Promise<Project[]> {
  const contribRows = await db
    .select({ projectId: projectContributors.projectId })
    .from(projectContributors)
    .where(eq(projectContributors.email, email.trim().toLowerCase()));

  if (contribRows.length === 0) return [];

  const ids = contribRows.map((r) => r.projectId);
  const projectRows = await db.select().from(projects).where(inArray(projects.id, ids));

  const allContribs = await db
    .select()
    .from(projectContributors)
    .where(inArray(projectContributors.projectId, ids));

  const contribMap = new Map<string, string[]>();
  for (const r of allContribs) {
    const arr = contribMap.get(r.projectId) ?? [];
    arr.push(r.email);
    contribMap.set(r.projectId, arr);
  }

  return projectRows.map((r) => ({
    id: r.id,
    title: r.title,
    contributors: contribMap.get(r.id) ?? [],
  }));
}

export async function createProject(
  title: string,
  creatorEmail: string,
  contributorEmails: string[] = [],
): Promise<string> {
  const contributors = Array.from(
    new Set(
      [creatorEmail, ...contributorEmails]
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0),
    ),
  );

  const [project] = await db
    .insert(projects)
    .values({ title: title.trim() })
    .returning({ id: projects.id });

  await db.insert(projectContributors).values(
    contributors.map((email) => ({ projectId: project.id, email })),
  );

  await db.insert(labelsTable).values([
    ...DEFAULT_FILE_LABELS.map((l) => ({ projectId: project.id, ...l, kind: 'file' })),
    ...DEFAULT_INFORMATION_LABELS.map((l) => ({
      projectId: project.id,
      ...l,
      kind: 'information',
    })),
  ]);

  return project.id;
}

export async function updateProjectTitle(projectId: string, title: string): Promise<void> {
  await db
    .update(projects)
    .set({ title: title.trim() })
    .where(eq(projects.id, projectId));
}

export async function addContributor(projectId: string, email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error('Enter an email address.');
  await db
    .insert(projectContributors)
    .values({ projectId, email: normalized })
    .onConflictDoNothing();
  return normalized;
}

export async function removeContributor(projectId: string, email: string): Promise<void> {
  const uid = await getUidForEmail(email);

  if (uid) {
    await releaseLocksHeldBy(projectId, uid);
  }

  await db
    .delete(projectContributors)
    .where(
      and(
        eq(projectContributors.projectId, projectId),
        eq(projectContributors.email, email),
      ),
    );
}

async function releaseLocksHeldBy(projectId: string, uid: string): Promise<void> {
  await db
    .update(filesTable)
    .set({ checkedOutBy: null })
    .where(
      and(
        eq(filesTable.projectId, projectId),
        eq(filesTable.checkedOutBy, uid),
      ),
    );
}

// ── folders ──────────────────────────────────────────────────────────────────

export async function getFolders(projectId: string): Promise<Folder[]> {
  const rows = await db
    .select()
    .from(foldersTable)
    .where(eq(foldersTable.projectId, projectId));
  return rows.map((r) => ({
    id: r.id,
    folderName: r.folderName,
    parentId: r.parentId ?? null,
  }));
}

export async function createFolder(
  projectId: string,
  folderName: string,
  parentId: string | null,
): Promise<Folder> {
  const [row] = await db
    .insert(foldersTable)
    .values({ projectId, folderName: folderName.trim(), parentId })
    .returning();
  return { id: row.id, folderName: row.folderName, parentId: row.parentId ?? null };
}

export async function getFolderFileIds(
  projectId: string,
): Promise<Map<string, Set<string>>> {
  const folderRows = await db
    .select({ id: foldersTable.id })
    .from(foldersTable)
    .where(eq(foldersTable.projectId, projectId));

  const map = new Map<string, Set<string>>();
  if (folderRows.length === 0) return map;

  const folderIds = folderRows.map((r) => r.id);
  for (const fid of folderIds) map.set(fid, new Set());

  const rows = await db
    .select({ fileId: fileFolders.fileId, folderId: fileFolders.folderId })
    .from(fileFolders)
    .where(inArray(fileFolders.folderId, folderIds));

  for (const r of rows) {
    map.get(r.folderId)?.add(r.fileId);
  }
  return map;
}

export async function moveFile(
  projectId: string,
  fileId: string,
  toFolderId: string | null,
): Promise<void> {
  // Verify the file belongs to this project.
  const [fileRow] = await db
    .select({ id: filesTable.id })
    .from(filesTable)
    .where(and(eq(filesTable.id, fileId), eq(filesTable.projectId, projectId)))
    .limit(1);
  if (!fileRow) throw new Error('Not found');

  // Find folders that currently hold this file.
  const currentFolderRows = await db
    .select({ folderId: fileFolders.folderId })
    .from(fileFolders)
    .where(eq(fileFolders.fileId, fileId));

  const currentFolderIds = currentFolderRows.map((r) => r.folderId);

  // No-op when already only in the destination.
  if (
    toFolderId !== null &&
    currentFolderIds.length === 1 &&
    currentFolderIds[0] === toFolderId
  ) {
    return;
  }
  if (toFolderId === null && currentFolderIds.length === 0) return;

  // Remove from all current folders.
  if (currentFolderIds.length > 0) {
    await db
      .delete(fileFolders)
      .where(
        and(
          eq(fileFolders.fileId, fileId),
          inArray(fileFolders.folderId, currentFolderIds),
        ),
      );
  }

  // Add to destination folder.
  if (toFolderId) {
    await db
      .insert(fileFolders)
      .values({ fileId, folderId: toFolderId })
      .onConflictDoNothing();
  }
}

// ── files ────────────────────────────────────────────────────────────────────

// Maps each metadata / information field key to its generated tsvector column.
// `contents` is handled separately since it lives in the file_chunks table.
const META_TSV: Record<string, ReturnType<typeof sql>> = {
  author: sql`${filesTable.authorTsv}`,
  source: sql`${filesTable.sourceTsv}`,
  fileBias: sql`${filesTable.overallBiasTsv}`,
  fileReliability: sql`${filesTable.fileReliabilityTsv}`,
  fileCredibility: sql`${filesTable.fileCredibilityTsv}`,
};
const INFO_TSV: Record<string, ReturnType<typeof sql>> = {
  infoTitle: sql`${informationTable.titleTsv}`,
  infoText: sql`${informationTable.textTsv}`,
  infoBias: sql`${informationTable.overallBiasTsv}`,
  infoReliability: sql`${informationTable.reliabilityTsv}`,
  infoCredibility: sql`${informationTable.credibilityTsv}`,
};

const META_KEYS = ['author', 'source', 'fileBias', 'fileReliability', 'fileCredibility'] as const;
const INFO_KEYS = ['infoTitle', 'infoText', 'infoBias', 'infoReliability', 'infoCredibility'] as const;

// Builds the full-text WHERE clause. A file matches if any *enabled* metadata
// tsvector matches, if the (enabled) text chunks match, or if any enabled
// information tsvector matches. The chunk and information matches use EXISTS
// subqueries so a file is surfaced once regardless of how many rows matched.
//
// `fields` restricts the search to a subset (issue #27). When it is undefined
// or empty, every field is searched — the default, back-compatible behaviour.
function ftsCondition(q: string, fields?: SearchField[]) {
  const searchAll = !fields || fields.length === 0;
  const enabled = new Set(fields ?? []);
  const on = (f: SearchField) => searchAll || enabled.has(f);

  // Filename isn't part of the scoped SearchField model — it's always visible
  // in the table, so it should always be matchable regardless of which scope
  // toggles are on.
  const parts: SQL[] = [ilike(filesTable.filename, `%${q}%`)];

  const metaCols = META_KEYS.filter(on).map((k) => META_TSV[k]);
  if (metaCols.length > 0) {
    parts.push(
      sql`(${sql.join(metaCols, sql` || `)}) @@ plainto_tsquery('english', ${q})`,
    );
  }

  if (on('contents')) {
    parts.push(sql`EXISTS (
      SELECT 1 FROM ${fileChunks}
      WHERE ${fileChunks.fileId} = ${filesTable.id}
        AND ${fileChunks.contentTsv} @@ plainto_tsquery('english', ${q})
    )`);
  }

  const infoCols = INFO_KEYS.filter(on).map((k) => INFO_TSV[k]);
  if (infoCols.length > 0) {
    parts.push(sql`EXISTS (
      SELECT 1 FROM ${informationTable}
      WHERE ${informationTable.fileId} = ${filesTable.id}
        AND (${sql.join(infoCols, sql` || `)}) @@ plainto_tsquery('english', ${q})
    )`);
  }

  // An explicit scope that enables no known field matches nothing rather than
  // silently widening to everything. In practice the client never sends this.
  if (parts.length === 0) return sql`false`;
  return or(...parts);
}

export async function getFiles(
  projectId: string,
  folderId: string | null = null,
  search: string = '',
  fields?: SearchField[],
): Promise<FileDoc[]> {
  const q = search.trim();

  // When searching, scan all project files regardless of which folder is selected.
  if (q) {
    const rows = await db
      .select({ ...getTableColumns(filesTable), folderId: fileFolders.folderId })
      .from(filesTable)
      .leftJoin(fileFolders, eq(filesTable.id, fileFolders.fileId))
      .where(and(eq(filesTable.projectId, projectId), ftsCondition(q, fields)));

    return attachLabels(rows.map((r) => ({ ...r, folderId: r.folderId ?? null })));
  }

  if (!folderId) {
    // Root files only: files that have no entry in file_folders.
    const rows = await db
      .select(getTableColumns(filesTable))
      .from(filesTable)
      .leftJoin(fileFolders, eq(filesTable.id, fileFolders.fileId))
      .where(and(eq(filesTable.projectId, projectId), isNull(fileFolders.fileId)));

    return attachLabels(rows.map((r) => ({ ...r, folderId: null })));
  }

  // Files in a specific folder via file_folders join.
  const folderFileRows = await db
    .select({ fileId: fileFolders.fileId })
    .from(fileFolders)
    .where(eq(fileFolders.folderId, folderId));

  if (folderFileRows.length === 0) return [];

  const fileIds = folderFileRows.map((r) => r.fileId);
  const rows = await db
    .select()
    .from(filesTable)
    .where(and(eq(filesTable.projectId, projectId), inArray(filesTable.id, fileIds)));

  return attachLabels(rows.map((r) => ({ ...r, folderId })));
}

export async function getFile(projectId: string, fileId: string): Promise<FileDoc> {
  const [row] = await db
    .select()
    .from(filesTable)
    .where(and(eq(filesTable.id, fileId), eq(filesTable.projectId, projectId)))
    .limit(1);
  if (!row) throw new Error('Not found');

  const [folderRow] = await db
    .select({ folderId: fileFolders.folderId })
    .from(fileFolders)
    .where(eq(fileFolders.fileId, fileId))
    .limit(1);

  const [doc] = await attachLabels([{ ...row, folderId: folderRow?.folderId ?? null }]);
  return doc;
}

export async function createFileRecord(
  projectId: string,
  filename: string,
  storageReference: string,
  author: string | null,
  folderId: string | null,
  text: string | null = null,
  editor: { uid: string; name: string } | null = null,
): Promise<FileDoc> {
  const [row] = await db
    .insert(filesTable)
    .values({
      projectId,
      filename,
      storageReference,
      author,
      createdDate: null,
      overallBias: null,
      source: null,
      fileReliability: null,
      fileCredibility: null,
      checkedOutBy: null,
    })
    .returning();

  // Seed a baseline version for any field already populated at creation (only
  // `author` can be set here) so history isn't empty for the original value.
  if (editor) {
    const now = Date.now();
    const baseline = FILE_VERSIONED_FIELDS.filter(
      (f) => toVersionText(row[f]) !== null,
    ).map((f) => ({
      fileId: row.id,
      field: f,
      value: toVersionText(row[f]),
      editorUid: editor.uid,
      editorName: editor.name,
      createdAt: now,
    }));
    if (baseline.length > 0) {
      await db.insert(fileFieldVersions).values(baseline);
    }
  }

  if (folderId) {
    await db.insert(fileFolders).values({ fileId: row.id, folderId }).onConflictDoNothing();
  }

  // Chunk the extracted text and store each chunk; the tsvector column is
  // generated by the database so search picks it up automatically.
  if (text) {
    const chunks = chunkText(text);
    if (chunks.length > 0) {
      await db.insert(fileChunks).values(
        chunks.map((content, chunkIndex) => ({ fileId: row.id, chunkIndex, content })),
      );
    }
  }

  return {
    id: row.id,
    filename: row.filename,
    author: row.author,
    createdDate: null,
    storageReference: row.storageReference,
    overallBias: null,
    source: null,
    fileReliability: null,
    fileCredibility: null,
    fileReliabilityCode: null,
    fileCredibilityCode: null,
    checkedOutBy: null,
    labels: [],
    folderId: folderId,
  };
}

export async function replaceFileChunks(fileId: string, text: string): Promise<void> {
  await db.delete(fileChunks).where(eq(fileChunks.fileId, fileId));
  const chunks = chunkText(text);
  if (chunks.length > 0) {
    await db.insert(fileChunks).values(
      chunks.map((content, chunkIndex) => ({ fileId, chunkIndex, content })),
    );
  }
}

export async function hasFileChunks(fileId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: fileChunks.id })
    .from(fileChunks)
    .where(eq(fileChunks.fileId, fileId))
    .limit(1);
  return row !== undefined;
}

// ── OCR jobs ─────────────────────────────────────────────────────────────────

// An OCR job runs detached in the request-serving process, so a container
// recycle can orphan one. Any pending/running job not touched within this
// window is presumed dead and reaped to 'error'. Keep this comfortably larger
// than the ocrmypdf subprocess timeout in the OCR route so a job that is
// legitimately still working is never reaped out from under itself.
const OCR_STALE_MS = 15 * 60 * 1000;

export interface OcrJob {
  id: string;
  fileId: string;
  status: OcrJobStatus;
  error: string | null;
  startedAt: number | null;
  updatedAt: number;
}

// Flip stale active jobs for a file to 'error'. Called before reading or
// creating a job so callers always see a self-healed view.
async function reapStaleOcrJobs(fileId: string): Promise<void> {
  await db
    .update(ocrJobs)
    .set({ status: 'error', error: 'OCR timed out', updatedAt: Date.now() })
    .where(
      and(
        eq(ocrJobs.fileId, fileId),
        inArray(ocrJobs.status, ['pending', 'running']),
        lt(ocrJobs.updatedAt, Date.now() - OCR_STALE_MS),
      ),
    );
}

// Enqueue an OCR job for a file. Throws 'Conflict' if one is already active,
// so a double click or concurrent request can't kick off a second OCR run.
export async function createOcrJob(fileId: string): Promise<OcrJob> {
  await reapStaleOcrJobs(fileId);

  const [active] = await db
    .select({ id: ocrJobs.id })
    .from(ocrJobs)
    .where(
      and(eq(ocrJobs.fileId, fileId), inArray(ocrJobs.status, ['pending', 'running'])),
    )
    .limit(1);
  if (active) throw new Error('Conflict');

  // The pre-check handles the common case; the partial unique index is the
  // hard guard against a race between two simultaneous requests (the loser's
  // insert throws, surfacing as a 500 — acceptable for that rare collision).
  const now = Date.now();
  const [row] = await db
    .insert(ocrJobs)
    .values({ fileId, status: 'pending', updatedAt: now })
    .returning();
  return row as OcrJob;
}

// Latest job for a file (most recently updated), or null if none has run.
export async function getLatestOcrJob(fileId: string): Promise<OcrJob | null> {
  await reapStaleOcrJobs(fileId);
  const [row] = await db
    .select()
    .from(ocrJobs)
    .where(eq(ocrJobs.fileId, fileId))
    .orderBy(desc(ocrJobs.updatedAt))
    .limit(1);
  return (row as OcrJob | undefined) ?? null;
}

export async function markOcrJobRunning(jobId: string): Promise<void> {
  const now = Date.now();
  await db
    .update(ocrJobs)
    .set({ status: 'running', startedAt: now, updatedAt: now })
    .where(eq(ocrJobs.id, jobId));
}

// Finish a job: pass an error message to mark it 'error', or null for 'done'.
export async function completeOcrJob(
  jobId: string,
  error: string | null,
): Promise<void> {
  await db
    .update(ocrJobs)
    .set({ status: error ? 'error' : 'done', error, updatedAt: Date.now() })
    .where(eq(ocrJobs.id, jobId));
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
  await db
    .update(filesTable)
    .set(sanitizeFileMetadata(metadata))
    .where(and(eq(filesTable.id, fileId), eq(filesTable.projectId, projectId)));
}

export async function checkOutFile(
  projectId: string,
  fileId: string,
  uid: string,
): Promise<boolean> {
  const result = await db
    .update(filesTable)
    .set({ checkedOutBy: uid })
    .where(
      and(
        eq(filesTable.id, fileId),
        eq(filesTable.projectId, projectId),
        sql`(${filesTable.checkedOutBy} IS NULL OR ${filesTable.checkedOutBy} = ${uid})`,
      ),
    )
    .returning({ id: filesTable.id });
  return result.length > 0;
}

export async function checkInFile(projectId: string, fileId: string): Promise<void> {
  await db
    .update(filesTable)
    .set({ checkedOutBy: null })
    .where(and(eq(filesTable.id, fileId), eq(filesTable.projectId, projectId)));
}

// ── information ───────────────────────────────────────────────────────────────

export async function getInformation(
  projectId: string,
  fileId: string,
): Promise<Information[]> {
  // Verify the file belongs to this project.
  const [fileRow] = await db
    .select({ id: filesTable.id })
    .from(filesTable)
    .where(and(eq(filesTable.id, fileId), eq(filesTable.projectId, projectId)))
    .limit(1);
  if (!fileRow) throw new Error('Not found');

  const rows = await db
    .select()
    .from(informationTable)
    .where(eq(informationTable.fileId, fileId));

  // Attach assigned label ids, grouped by information row (mirrors attachLabels).
  const labelMap = new Map<string, string[]>();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const labelRows = await db
      .select({
        informationId: informationLabels.informationId,
        labelId: informationLabels.labelId,
      })
      .from(informationLabels)
      .where(inArray(informationLabels.informationId, ids));
    for (const r of labelRows) {
      const arr = labelMap.get(r.informationId) ?? [];
      arr.push(r.labelId);
      labelMap.set(r.informationId, arr);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    informationTitle: r.informationTitle,
    informationText: r.informationText,
    overallBias: r.overallBias,
    informationReliability: r.informationReliability,
    informationCredibility: r.informationCredibility,
    informationReliabilityCode: r.informationReliabilityCode,
    informationCredibilityCode: r.informationCredibilityCode,
    labels: labelMap.get(r.id) ?? [],
  }));
}

export async function addInformation(
  projectId: string,
  fileId: string,
  fields: InformationFields,
  id?: string,
): Promise<string> {
  const clean = sanitizeInformationFields(fields);
  if (id) {
    await db
      .insert(informationTable)
      .values({ id, fileId, ...clean })
      .onConflictDoNothing();
    return id;
  }
  const [row] = await db
    .insert(informationTable)
    .values({ fileId, ...clean })
    .returning({ id: informationTable.id });
  return row.id;
}

export async function updateInformation(
  projectId: string,
  fileId: string,
  informationId: string,
  fields: InformationFields,
): Promise<void> {
  await db
    .update(informationTable)
    .set(sanitizeInformationFields(fields))
    .where(
      and(
        eq(informationTable.id, informationId),
        eq(informationTable.fileId, fileId),
      ),
    );
}

export async function deleteInformation(
  projectId: string,
  fileId: string,
  informationId: string,
): Promise<void> {
  await db
    .delete(informationTable)
    .where(
      and(
        eq(informationTable.id, informationId),
        eq(informationTable.fileId, fileId),
      ),
    );
}

// ── selections ─────────────────────────────────────────────────────────────────

// Confirm the information row exists, belongs to the given file, and that file
// belongs to the given project. Throws 'Not found' otherwise so callers never
// touch selections through a mismatched project/file/information path.
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

export async function getSelections(
  projectId: string,
  fileId: string,
  informationId: string,
): Promise<Selection[]> {
  await requireInformation(projectId, fileId, informationId);
  // Ordered by location in the document — page first, then top-to-bottom and
  // left-to-right — which is the order the viewer's previous/next steps through.
  const rows = await db
    .select()
    .from(selectionsTable)
    .where(eq(selectionsTable.informationId, informationId))
    .orderBy(
      selectionsTable.pageIndex,
      selectionsTable.boundingTop,
      selectionsTable.boundingLeft,
    );
  return rows.map((r) => ({
    id: r.id,
    pageIndex: r.pageIndex,
    boundingTop: r.boundingTop,
    boundingLeft: r.boundingLeft,
    rects: r.rects,
    text: r.text,
  }));
}

export async function addSelection(
  projectId: string,
  fileId: string,
  informationId: string,
  fields: SelectionFields[],
): Promise<string[]> {
  await requireInformation(projectId, fileId, informationId);
  if (fields.length === 0) return [];
  // All page-rows of one mark are inserted in a single multi-row statement so
  // the highlight is saved atomically (all pages or none).
  const rows = await db
    .insert(selectionsTable)
    .values(fields.map((f) => ({ informationId, ...f })))
    .returning({ id: selectionsTable.id });
  return rows.map((r) => r.id);
}

export async function deleteSelection(
  projectId: string,
  fileId: string,
  informationId: string,
  selectionId: string,
): Promise<void> {
  await requireInformation(projectId, fileId, informationId);
  await db
    .delete(selectionsTable)
    .where(
      and(
        eq(selectionsTable.id, selectionId),
        eq(selectionsTable.informationId, informationId),
      ),
    );
}

// ── drafts (manual save / submit, issue #78) ────────────────────────────────────

// Throws 'Conflict' (mapped to 409 by apiError) unless the file is either
// unheld or checked out by `uid`. Mirrors the per-route #86 guard so every
// draft/submit mutation enforces the same rule in one place.
export async function requireCheckoutHolder(
  projectId: string,
  fileId: string,
  uid: string,
): Promise<void> {
  const file = await getFile(projectId, fileId);
  if (file.checkedOutBy && file.checkedOutBy !== uid) {
    throw new Error('Conflict');
  }
}

// Return the staged snapshot for (fileId, uid), or null if none exists.
export async function getDraft(
  projectId: string,
  fileId: string,
  uid: string,
): Promise<FileDraftSnapshot | null> {
  // Verify the file belongs to this project before exposing any draft.
  await getFile(projectId, fileId);
  const [row] = await db
    .select({ snapshot: fileDrafts.snapshot })
    .from(fileDrafts)
    .where(and(eq(fileDrafts.fileId, fileId), eq(fileDrafts.userId, uid)))
    .limit(1);
  return row?.snapshot ?? null;
}

// Upsert the draft snapshot for (fileId, uid). Never touches the main tables.
// ── field version history ───────────────────────────────────────────────────────

// The file/information fields whose edits are recorded in version history. Kept
// in sync with the columns the sidebars expose; labels and PDF selections are
// intentionally excluded (labels persist outside Submit; selections aren't text).
const FILE_VERSIONED_FIELDS = [
  'author',
  'createdDate',
  'source',
  'overallBias',
  'fileReliability',
  'fileCredibility',
  'fileReliabilityCode',
  'fileCredibilityCode',
] as const;

// The paragraph fields that carry sanitised HTML (issue #81). Client sanitisation
// protects honest clients; a crafted request could still send raw markup, so the
// server re-sanitises these on every write with the same allow-list. Single-line
// fields (author/title), Admiralty codes, and created_date are never HTML.
const FILE_RICH_FIELDS = [
  'source',
  'overallBias',
  'fileReliability',
  'fileCredibility',
] as const;

const INFORMATION_RICH_FIELDS = [
  'informationText',
  'overallBias',
  'informationReliability',
  'informationCredibility',
] as const;

// Return a copy of the file metadata with its rich fields sanitised (empty
// markup collapsed to null), leaving every non-HTML field untouched.
function sanitizeFileMetadata<T extends Record<string, unknown>>(metadata: T): T {
  const next = { ...metadata };
  for (const field of FILE_RICH_FIELDS) {
    if (field in next) {
      (next as Record<string, unknown>)[field] = htmlOrNull(
        next[field] as string | null,
      );
    }
  }
  return next;
}

// As above for a piece of information's editable fields.
function sanitizeInformationFields<T extends Record<string, unknown>>(fields: T): T {
  const next = { ...fields };
  for (const field of INFORMATION_RICH_FIELDS) {
    if (field in next) {
      (next as Record<string, unknown>)[field] = htmlOrNull(
        next[field] as string | null,
      );
    }
  }
  return next;
}

const INFORMATION_VERSIONED_FIELDS = [
  'informationTitle',
  'informationText',
  'overallBias',
  'informationReliability',
  'informationCredibility',
  'informationReliabilityCode',
  'informationCredibilityCode',
] as const;

// Version values are stored as text; numbers (e.g. created_date) are
// stringified and empty/absent values collapse to null so "unset" compares
// equal across a numeric null and a missing key.
function toVersionText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return toVersionText(a) === toVersionText(b);
}

// Resolve the display name to stamp on a version row. Prefers the editor's
// Cognito `name`; falls back to the email local-part, then 'Unknown'. Never
// throws — a Cognito lookup failure just degrades to the email-based name.
export async function resolveEditorName(uid: string, email: string): Promise<string> {
  const profile = await getCognitoProfile(uid);
  const name = profile?.name?.trim();
  if (name) return name;
  const local = email.split('@')[0]?.trim();
  return local || 'Unknown';
}

// Fetch the full field history for a file, grouped by field name and ordered
// newest-first within each field.
export async function getFileHistory(
  projectId: string,
  fileId: string,
): Promise<FieldHistory> {
  await getFile(projectId, fileId); // scope check: file belongs to project
  const rows = await db
    .select({
      field: fileFieldVersions.field,
      value: fileFieldVersions.value,
      editorName: fileFieldVersions.editorName,
      createdAt: fileFieldVersions.createdAt,
    })
    .from(fileFieldVersions)
    .where(eq(fileFieldVersions.fileId, fileId))
    .orderBy(desc(fileFieldVersions.createdAt));
  return groupHistory(rows);
}

export async function getInformationHistory(
  projectId: string,
  fileId: string,
  informationId: string,
): Promise<FieldHistory> {
  await getFile(projectId, fileId); // scope check
  const rows = await db
    .select({
      field: informationFieldVersions.field,
      value: informationFieldVersions.value,
      editorName: informationFieldVersions.editorName,
      createdAt: informationFieldVersions.createdAt,
    })
    .from(informationFieldVersions)
    .innerJoin(
      informationTable,
      eq(informationFieldVersions.informationId, informationTable.id),
    )
    .where(
      and(
        eq(informationFieldVersions.informationId, informationId),
        eq(informationTable.fileId, fileId),
      ),
    )
    .orderBy(desc(informationFieldVersions.createdAt));
  return groupHistory(rows);
}

function groupHistory(
  rows: { field: string; value: string | null; editorName: string; createdAt: number }[],
): FieldHistory {
  const history: FieldHistory = {};
  for (const row of rows) {
    (history[row.field] ??= []).push({
      value: row.value,
      editorName: row.editorName,
      createdAt: row.createdAt,
    });
  }
  return history;
}

export async function saveDraft(
  projectId: string,
  fileId: string,
  uid: string,
  snapshot: FileDraftSnapshot,
): Promise<void> {
  await getFile(projectId, fileId);
  await db
    .insert(fileDrafts)
    .values({ fileId, userId: uid, snapshot, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: [fileDrafts.fileId, fileDrafts.userId],
      set: { snapshot, updatedAt: Date.now() },
    });
}

// Delete the draft row for (fileId, uid) — a no-op if none exists.
export async function discardDraft(
  projectId: string,
  fileId: string,
  uid: string,
): Promise<void> {
  await db
    .delete(fileDrafts)
    .where(and(eq(fileDrafts.fileId, fileId), eq(fileDrafts.userId, uid)));
}

// Promote the snapshot into the main tables and clear the draft, all in one
// transaction so a failure leaves no half-published state. The snapshot comes
// from the request body (the freshest client state), so a user can submit work
// they typed but never explicitly Saved.
//
// Reconciliation per file:
//   - files: overwrite the editable metadata columns.
//   - information: upsert rows present in the snapshot; delete rows that exist
//     for the file but are absent from the snapshot.
//   - information_selections: per surviving information row, upsert the
//     snapshot's selections and delete any stored selection not in it.
//
// Version history: for every in-scope field whose value actually changes, a row
// is appended to the *_field_versions tables (a brand-new information row seeds
// a baseline for each of its non-empty fields), attributed to `editorName`.
export async function submitDraft(
  projectId: string,
  fileId: string,
  uid: string,
  snapshot: FileDraftSnapshot,
  editorName: string,
): Promise<void> {
  // Confirm the file belongs to this project before mutating anything.
  await getFile(projectId, fileId);

  // Admiralty-code gate (issue #80): a Reliability/Credibility code set without
  // its matching free-text description blocks Submit (Save is never gated).
  // Authoritative check — the client disables Submit too, but never trust it.
  const invalid = validateDraftForSubmit(snapshot);
  if (invalid) throw new Error('Invalid');

  // Sanitise the rich-text fields (issue #81) once, up front, so the field diff,
  // the persisted rows, and the recorded version history all use clean HTML.
  const cleanMetadata = sanitizeFileMetadata(snapshot.metadata);
  const cleanInformation = snapshot.information.map((info) => ({
    ...info,
    ...sanitizeInformationFields({
      informationText: info.informationText,
      overallBias: info.overallBias,
      informationReliability: info.informationReliability,
      informationCredibility: info.informationCredibility,
    }),
  }));

  // One timestamp for the whole submit; every version row it writes shares it.
  const now = Date.now();

  await db.transaction(async (tx) => {
    // (1) file metadata — diff against current values before overwriting so we
    // record a version only for fields that actually changed.
    const [currentFile] = await tx
      .select()
      .from(filesTable)
      .where(and(eq(filesTable.id, fileId), eq(filesTable.projectId, projectId)));
    if (currentFile) {
      const fileVersions = FILE_VERSIONED_FIELDS.filter(
        (f) => !valuesEqual(currentFile[f], cleanMetadata[f]),
      ).map((f) => ({
        fileId,
        field: f,
        value: toVersionText(cleanMetadata[f]),
        editorUid: uid,
        editorName,
        createdAt: now,
      }));
      if (fileVersions.length > 0) {
        await tx.insert(fileFieldVersions).values(fileVersions);
      }
    }
    await tx
      .update(filesTable)
      .set(cleanMetadata)
      .where(and(eq(filesTable.id, fileId), eq(filesTable.projectId, projectId)));

    // (2) information — delete rows no longer in the snapshot, then upsert.
    const keepInfoIds = cleanInformation.map((i) => i.id);
    // Full current rows (not just ids) so we can diff each field for history.
    const existingInfo = await tx
      .select()
      .from(informationTable)
      .where(eq(informationTable.fileId, fileId));
    const existingInfoById = new Map(existingInfo.map((r) => [r.id, r]));
    const infoToDelete = existingInfo
      .map((r) => r.id)
      .filter((id) => !keepInfoIds.includes(id));
    if (infoToDelete.length > 0) {
      // information_selections and information_field_versions cascade-delete
      // with their information row.
      await tx
        .delete(informationTable)
        .where(
          and(
            eq(informationTable.fileId, fileId),
            inArray(informationTable.id, infoToDelete),
          ),
        );
    }

    for (const info of cleanInformation) {
      const fields = {
        informationTitle: info.informationTitle,
        informationText: info.informationText,
        overallBias: info.overallBias,
        informationReliability: info.informationReliability,
        informationCredibility: info.informationCredibility,
        informationReliabilityCode: info.informationReliabilityCode,
        informationCredibilityCode: info.informationCredibilityCode,
      };

      // Version diff: for an existing row, record fields that changed; for a
      // brand-new row, seed a baseline version for each non-empty field.
      const prev = existingInfoById.get(info.id);
      const infoVersions = INFORMATION_VERSIONED_FIELDS.filter((f) =>
        prev ? !valuesEqual(prev[f], info[f]) : toVersionText(info[f]) !== null,
      ).map((f) => ({
        informationId: info.id,
        field: f,
        value: toVersionText(info[f]),
        editorUid: uid,
        editorName,
        createdAt: now,
      }));

      await tx
        .insert(informationTable)
        .values({ id: info.id, fileId, ...fields })
        .onConflictDoUpdate({ target: informationTable.id, set: fields });

      // Insert version rows only after the information row exists (the FK
      // requires it) — matters for a brand-new row's baseline.
      if (infoVersions.length > 0) {
        await tx.insert(informationFieldVersions).values(infoVersions);
      }

      // (3) selections for this information row — delete absent, upsert present.
      const keepSelIds = info.selections.map((s) => s.id);
      const existingSel = await tx
        .select({ id: selectionsTable.id })
        .from(selectionsTable)
        .where(eq(selectionsTable.informationId, info.id));
      const selToDelete = existingSel
        .map((r) => r.id)
        .filter((id) => !keepSelIds.includes(id));
      if (selToDelete.length > 0) {
        await tx
          .delete(selectionsTable)
          .where(
            and(
              eq(selectionsTable.informationId, info.id),
              inArray(selectionsTable.id, selToDelete),
            ),
          );
      }
      for (const sel of info.selections) {
        const selFields = {
          pageIndex: sel.pageIndex,
          boundingTop: sel.boundingTop,
          boundingLeft: sel.boundingLeft,
          rects: sel.rects,
          text: sel.text,
        };
        await tx
          .insert(selectionsTable)
          .values({ id: sel.id, informationId: info.id, ...selFields })
          .onConflictDoUpdate({ target: selectionsTable.id, set: selFields });
      }
    }

    // (4) clear the stored draft.
    await tx
      .delete(fileDrafts)
      .where(and(eq(fileDrafts.fileId, fileId), eq(fileDrafts.userId, uid)));
  });
}

// ── labels ────────────────────────────────────────────────────────────────────

export async function getLabels(projectId: string): Promise<Label[]> {
  const rows = await db
    .select()
    .from(labelsTable)
    .where(eq(labelsTable.projectId, projectId));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    color: r.color,
    kind: r.kind as LabelKind,
  }));
}

export async function createLabel(
  projectId: string,
  label: string,
  color: string,
  kind: LabelKind = 'file',
): Promise<Label> {
  const trimmed = label.trim();
  const [row] = await db
    .insert(labelsTable)
    .values({ projectId, label: trimmed, color, kind })
    .returning();
  return { id: row.id, label: row.label, color: row.color, kind: row.kind as LabelKind };
}

export async function updateLabel(
  projectId: string,
  labelId: string,
  fields: { label: string; color: string },
): Promise<void> {
  await db
    .update(labelsTable)
    .set({ label: fields.label.trim(), color: fields.color })
    .where(and(eq(labelsTable.id, labelId), eq(labelsTable.projectId, projectId)));
}

export async function deleteLabel(projectId: string, labelId: string): Promise<void> {
  // fileLabels rows are deleted by CASCADE on the label FK.
  await db
    .delete(labelsTable)
    .where(and(eq(labelsTable.id, labelId), eq(labelsTable.projectId, projectId)));
}

export async function addLabelToFile(
  projectId: string,
  fileId: string,
  labelId: string,
): Promise<void> {
  await db
    .insert(fileLabels)
    .values({ fileId, labelId })
    .onConflictDoNothing();
}

export async function removeLabelFromFile(
  projectId: string,
  fileId: string,
  labelId: string,
): Promise<void> {
  await db
    .delete(fileLabels)
    .where(and(eq(fileLabels.fileId, fileId), eq(fileLabels.labelId, labelId)));
}

export async function addLabelToInformation(
  projectId: string,
  fileId: string,
  informationId: string,
  labelId: string,
): Promise<void> {
  await requireInformation(projectId, fileId, informationId);
  await db
    .insert(informationLabels)
    .values({ informationId, labelId })
    .onConflictDoNothing();
}

export async function removeLabelFromInformation(
  projectId: string,
  fileId: string,
  informationId: string,
  labelId: string,
): Promise<void> {
  await requireInformation(projectId, fileId, informationId);
  await db
    .delete(informationLabels)
    .where(
      and(
        eq(informationLabels.informationId, informationId),
        eq(informationLabels.labelId, labelId),
      ),
    );
}
