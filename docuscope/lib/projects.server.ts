import { db } from './drizzle/db';
import { eq, and, or, inArray, isNull, lt, desc, getTableColumns, sql } from 'drizzle-orm';
import {
  projects,
  projectContributors,
  labels as labelsTable,
  folders as foldersTable,
  files as filesTable,
  fileChunks,
  fileLabels,
  fileFolders,
  information as informationTable,
  informationSelections as selectionsTable,
  ocrJobs,
} from './drizzle/schema';
import { getUidForEmail } from './users.server';
import type {
  Project,
  Folder,
  FileDoc,
  Label,
  Information,
  InformationFields,
  Selection,
  SelectionFields,
  OcrJobStatus,
} from './projects';

const DEFAULT_LABELS = [
  { label: 'Not started', color: '#9ca3af' },
  { label: 'Not Reviewed', color: '#f59e0b' },
  { label: 'Done', color: '#22c55e' },
  { label: 'Dead end', color: '#ef4444' },
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

  await db.insert(labelsTable).values(
    DEFAULT_LABELS.map((l) => ({ projectId: project.id, ...l })),
  );

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

function ftsCondition(q: string) {
  // A file matches if any of its metadata tsvectors match, or if any of its
  // text chunks match. The chunk match is an EXISTS subquery so a file is
  // surfaced once regardless of how many chunks matched.
  return or(
    sql`(
      ${filesTable.authorTsv} ||
      ${filesTable.overallBiasTsv} ||
      ${filesTable.sourceTsv} ||
      ${filesTable.fileReliabilityTsv} ||
      ${filesTable.fileCredibilityTsv}
    ) @@ plainto_tsquery('english', ${q})`,
    sql`EXISTS (
      SELECT 1 FROM ${fileChunks}
      WHERE ${fileChunks.fileId} = ${filesTable.id}
        AND ${fileChunks.contentTsv} @@ plainto_tsquery('english', ${q})
    )`,
  );
}

export async function getFiles(
  projectId: string,
  folderId: string | null = null,
  search: string = '',
): Promise<FileDoc[]> {
  const q = search.trim();

  // When searching, scan all project files regardless of which folder is selected.
  if (q) {
    const rows = await db
      .select({ ...getTableColumns(filesTable), folderId: fileFolders.folderId })
      .from(filesTable)
      .leftJoin(fileFolders, eq(filesTable.id, fileFolders.fileId))
      .where(and(eq(filesTable.projectId, projectId), ftsCondition(q)));

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
  },
): Promise<void> {
  await db
    .update(filesTable)
    .set(metadata)
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
  return rows.map((r) => ({
    id: r.id,
    informationTitle: r.informationTitle,
    informationText: r.informationText,
    overallBias: r.overallBias,
    informationReliability: r.informationReliability,
    informationCredibility: r.informationCredibility,
  }));
}

export async function addInformation(
  projectId: string,
  fileId: string,
  fields: InformationFields,
  id?: string,
): Promise<string> {
  if (id) {
    await db
      .insert(informationTable)
      .values({ id, fileId, ...fields })
      .onConflictDoNothing();
    return id;
  }
  const [row] = await db
    .insert(informationTable)
    .values({ fileId, ...fields })
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
    .set(fields)
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

// ── labels ────────────────────────────────────────────────────────────────────

export async function getLabels(projectId: string): Promise<Label[]> {
  const rows = await db
    .select()
    .from(labelsTable)
    .where(eq(labelsTable.projectId, projectId));
  return rows.map((r) => ({ id: r.id, label: r.label, color: r.color }));
}

export async function createLabel(
  projectId: string,
  label: string,
  color: string,
): Promise<Label> {
  const trimmed = label.trim();
  const [row] = await db
    .insert(labelsTable)
    .values({ projectId, label: trimmed, color })
    .returning();
  return { id: row.id, label: row.label, color: row.color };
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
