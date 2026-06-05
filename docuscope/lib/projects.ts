import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  arrayUnion,
  type QueryDocumentSnapshot,
  type DocumentReference,
  type DocumentSnapshot,
} from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import { db, storage } from "./firebase";

// All Firestore access for projects is funneled through these functions so the
// UI never talks to Firebase directly (see docs/designPrinciples.md).

export type Project = {
  id: string;
  title: string;
  contributors: string[];
};

/** A folder inside a project. `parentId` is null for root-level folders. */
export type Folder = {
  id: string;
  folderName: string;
  parentId: string | null;
};

/**
 * A file inside a project. `author` and `createdDate` are null until they are
 * filled in (see docs/dataModel.md), and the UI renders them blank when null.
 */
export type FileDoc = {
  id: string;
  filename: string;
  author: string | null;
  /** Unix timestamp the user entered, or null when unset. */
  createdDate: number | null;
  /** Path to the file's binary data in Firebase Storage. */
  storageReference: string;
};

function fileFromSnapshot(snapshot: DocumentSnapshot): FileDoc {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    filename: (data.filename as string) ?? "",
    author: (data.author as string | null) ?? null,
    createdDate: (data.createdDate as number | null) ?? null,
    storageReference: (data.storageReference as string) ?? "",
  };
}

/**
 * List every project the given user (identified by email) is a contributor on.
 */
export async function getProjectsForUser(email: string): Promise<Project[]> {
  const projects = collection(db, "projects");
  const matching = query(projects, where("contributors", "array-contains", email));
  const snapshot = await getDocs(matching);
  return snapshot.docs.map((doc: QueryDocumentSnapshot) => {
    const data = doc.data();
    return {
      id: doc.id,
      title: (data.title as string) ?? "",
      contributors: (data.contributors as string[]) ?? [],
    };
  });
}

/**
 * Create a new project. The creator is always added as a contributor, alongside
 * any additional contributor emails supplied. Returns the new project's id.
 */
export async function createProject(
  title: string,
  creatorEmail: string,
  contributorEmails: string[] = [],
): Promise<string> {
  // De-duplicate and drop blanks so the creator isn't listed twice.
  const contributors = Array.from(
    new Set(
      [creatorEmail, ...contributorEmails]
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.length > 0),
    ),
  );

  const docRef = await addDoc(collection(db, "projects"), {
    title: title.trim(),
    contributors,
  });
  return docRef.id;
}

/** Fetch every folder in a project, flattened (the tree is built in the UI). */
export async function getFolders(projectId: string): Promise<Folder[]> {
  const snapshot = await getDocs(
    collection(db, "projects", projectId, "folders"),
  );
  return snapshot.docs.map((folderDoc: QueryDocumentSnapshot) => {
    const data = folderDoc.data();
    const parent = data.parent as DocumentReference | null | undefined;
    return {
      id: folderDoc.id,
      folderName: (data.folderName as string) ?? "",
      parentId: parent ? parent.id : null,
    };
  });
}

/**
 * Create a folder in a project. When `parentId` is null the folder is created at
 * the project root; otherwise it becomes a subfolder of `parentId` and is added
 * to that parent's `subfolders` list. Returns the new folder.
 */
export async function createFolder(
  projectId: string,
  folderName: string,
  parentId: string | null,
): Promise<Folder> {
  const folders = collection(db, "projects", projectId, "folders");
  const parentRef = parentId ? doc(folders, parentId) : null;

  const docRef = await addDoc(folders, {
    folderName: folderName.trim(),
    parent: parentRef,
    subfolders: [],
    subfiles: [],
  });

  if (parentRef) {
    await updateDoc(parentRef, { subfolders: arrayUnion(docRef) });
  }

  return { id: docRef.id, folderName: folderName.trim(), parentId };
}

/**
 * List files in a project. With `folderId` null, every file in the project is
 * returned. With a specific `folderId`, only that folder's direct files (its
 * `subfiles` references) are returned.
 */
export async function getFiles(
  projectId: string,
  folderId: string | null = null,
): Promise<FileDoc[]> {
  const files = collection(db, "projects", projectId, "files");

  if (!folderId) {
    const snapshot = await getDocs(files);
    return snapshot.docs.map(fileFromSnapshot);
  }

  // A folder records its files as document references in `subfiles`; fetch each
  // one. References that no longer resolve to a document are skipped.
  const folderSnapshot = await getDoc(doc(db, "projects", projectId, "folders", folderId));
  const subfiles = (folderSnapshot.data()?.subfiles ?? []) as DocumentReference[];
  const snapshots = await Promise.all(subfiles.map((fileRef) => getDoc(fileRef)));
  return snapshots
    .filter((snapshot) => snapshot.exists())
    .map(fileFromSnapshot);
}

/**
 * Upload a file's binary data to Firebase Storage and create the matching
 * Firestore document in the project's `files` subcollection. The document's
 * `filename` is the uploaded file's name and `storageReference` points at the
 * stored bytes. When `folderId` is set, the new file is also added to that
 * folder's `subfiles`. Returns the new file.
 */
export async function uploadFile(
  projectId: string,
  file: File,
  author: string | null,
  folderId: string | null = null,
): Promise<FileDoc> {
  const files = collection(db, "projects", projectId, "files");
  // Reserve the document id up front so the storage path can reference it,
  // keeping each upload's bytes isolated even when filenames collide.
  const fileRef = doc(files);
  const storageReference = `projects/${projectId}/files/${fileRef.id}/${file.name}`;

  await uploadBytes(ref(storage, storageReference), file);

  const fileData = {
    filename: file.name,
    author: author ?? null,
    storageReference,
    createdDate: null,
  };
  await setDoc(fileRef, fileData);

  if (folderId) {
    await updateDoc(doc(db, "projects", projectId, "folders", folderId), {
      subfiles: arrayUnion(fileRef),
    });
  }

  return { id: fileRef.id, ...fileData };
}
