import { db } from '../lib/drizzle/db';
import { projects, files, folders, fileFolders } from '../lib/drizzle/schema';
import { eq } from 'drizzle-orm';

/** Create a minimal project record and return its UUID id. */
export async function createTestProject(title = 'Test Project'): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({ title })
    .returning({ id: projects.id });
  return row.id;
}

/** Create a minimal file record without uploading to Storage. Returns the file id. */
export async function createTestFile(
  projectId: string,
  options: {
    filename?: string;
    author?: string | null;
    source?: string | null;
    overallBias?: string | null;
    fileReliability?: string | null;
    fileCredibility?: string | null;
  } = {},
): Promise<string> {
  const [row] = await db
    .insert(files)
    .values({
      projectId,
      filename: options.filename ?? 'test.pdf',
      storageReference: '',
      author: options.author ?? null,
      createdDate: null,
      overallBias: options.overallBias ?? null,
      source: options.source ?? null,
      fileReliability: options.fileReliability ?? null,
      fileCredibility: options.fileCredibility ?? null,
      checkedOutBy: null,
    })
    .returning({ id: files.id });
  return row.id;
}

/** Create a folder with the given subfile ids pre-populated. Returns the folder id. */
export async function createTestFolder(
  projectId: string,
  folderName: string,
  subfileIds: string[] = [],
): Promise<string> {
  const [row] = await db
    .insert(folders)
    .values({ projectId, folderName, parentId: null })
    .returning({ id: folders.id });

  if (subfileIds.length > 0) {
    await db
      .insert(fileFolders)
      .values(subfileIds.map((fileId) => ({ fileId, folderId: row.id })))
      .onConflictDoNothing();
  }

  return row.id;
}

/** Read the current subfile ids from a folder record. */
export async function getSubfileIds(
  _projectId: string,
  folderId: string,
): Promise<string[]> {
  const rows = await db
    .select({ fileId: fileFolders.fileId })
    .from(fileFolders)
    .where(eq(fileFolders.folderId, folderId));
  return rows.map((r) => r.fileId);
}
