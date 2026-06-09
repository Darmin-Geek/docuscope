import {
  collection,
  doc,
  setDoc,
  getDoc,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "../lib/firebase";

/** Create a minimal file document without uploading to Storage. Returns the file id. */
export async function createTestFile(projectId: string): Promise<string> {
  const fileRef = doc(collection(db, "projects", projectId, "files"));
  await setDoc(fileRef, {
    filename: "test.pdf",
    author: null,
    storageReference: "",
    createdDate: null,
    overallBias: null,
    source: null,
    fileReliability: null,
    fileCredibility: null,
    checkedOutBy: null,
    labels: [],
  });
  return fileRef.id;
}

/**
 * Create a folder document with the given subfile ids pre-populated.
 * Accepts raw file ids and converts them to DocumentReferences so the
 * folder matches the shape that `getFolderFileIds` and `moveFile` expect.
 * Returns the folder id.
 */
export async function createTestFolder(
  projectId: string,
  folderName: string,
  subfileIds: string[] = [],
): Promise<string> {
  const folderRef = doc(collection(db, "projects", projectId, "folders"));
  const subfiles: DocumentReference[] = subfileIds.map((id) =>
    doc(db, "projects", projectId, "files", id),
  );
  await setDoc(folderRef, {
    folderName,
    parent: null,
    subfolders: [],
    subfiles,
  });
  return folderRef.id;
}

/** Read the current subfile ids from a folder document. */
export async function getSubfileIds(
  projectId: string,
  folderId: string,
): Promise<string[]> {
  const snap = await getDoc(
    doc(db, "projects", projectId, "folders", folderId),
  );
  const subfiles =
    (snap.data()?.subfiles as DocumentReference[] | undefined) ?? [];
  return subfiles.map((ref) => ref.id);
}
