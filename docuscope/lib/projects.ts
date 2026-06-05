import {
  collection,
  doc,
  addDoc,
  getDocs,
  updateDoc,
  query,
  where,
  arrayUnion,
  type QueryDocumentSnapshot,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "./firebase";

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
