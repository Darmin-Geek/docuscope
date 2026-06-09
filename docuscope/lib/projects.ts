import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  where,
  onSnapshot,
  runTransaction,
  arrayUnion,
  arrayRemove,
  type QueryDocumentSnapshot,
  type DocumentReference,
  type DocumentSnapshot,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "./firebase";
import { getUidForEmail } from "./users";

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
 * A label option defined on a project (see docs/dataModel.md). Files reference
 * labels by id; `color` is a hex string used to tint the label's pill.
 */
export type Label = {
  id: string;
  label: string;
  color: string;
};

/** A user-defined custom field definition on a project (see docs/dataModel.md). */
export type CustomFieldDef = {
  id: string;
  name: string;
  target: "file" | "information";
};

/**
 * The labels every new project starts with. Order is meaningful: it mirrors a
 * file's typical lifecycle from untouched to resolved.
 */
const DEFAULT_LABELS: { label: string; color: string }[] = [
  { label: "Not started", color: "#9ca3af" },
  { label: "Not Reviewed", color: "#f59e0b" },
  { label: "Done", color: "#22c55e" },
  { label: "Dead end", color: "#ef4444" },
];

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
  /** Free-text assessments of the file (see docs/dataModel.md), null until set. */
  overallBias: string | null;
  source: string | null;
  fileReliability: string | null;
  fileCredibility: string | null;
  /**
   * The uid of the user who currently has the file checked out, or null when it
   * is free (see docs/dataModel.md). While set to another user's uid, only they
   * may write to the file, so the UI greys its fields out for everyone else.
   */
  checkedOutBy: string | null;
  /** Ids of the labels applied to this file (see docs/dataModel.md). */
  labels: string[];
  /** Values for user-defined custom fields, keyed by CustomFieldDef id. */
  customData: Record<string, string>;
};

function fileFromSnapshot(snapshot: DocumentSnapshot): FileDoc {
  const data = snapshot.data() ?? {};
  // `labels` is stored as a list of document references; the UI only needs ids.
  const labelRefs = (data.labels as DocumentReference[] | undefined) ?? [];
  return {
    id: snapshot.id,
    filename: (data.filename as string) ?? "",
    author: (data.author as string | null) ?? null,
    createdDate: (data.createdDate as number | null) ?? null,
    storageReference: (data.storageReference as string) ?? "",
    overallBias: (data.overallBias as string | null) ?? null,
    source: (data.source as string | null) ?? null,
    fileReliability: (data.fileReliability as string | null) ?? null,
    fileCredibility: (data.fileCredibility as string | null) ?? null,
    checkedOutBy: (data.checkedOutBy as string | null) ?? null,
    labels: labelRefs.map((ref) => ref.id),
    customData: (data.customData as Record<string, string>) ?? {},
  };
}

/**
 * A piece of information extracted from a file, stored in the file's
 * `information` subcollection (see docs/dataModel.md). The title is always a
 * string; the remaining free-text fields are null until set, mirroring how the
 * file's own assessments are stored.
 */
export type Information = {
  id: string;
  informationTitle: string;
  informationText: string | null;
  overallBias: string | null;
  informationReliability: string | null;
  informationCredibility: string | null;
  /** Values for user-defined custom fields, keyed by CustomFieldDef id. */
  customData: Record<string, string>;
};

/** The writable fields of an information document (everything but its id). */
export type InformationFields = Omit<Information, "id">;

function informationFromSnapshot(snapshot: DocumentSnapshot): Information {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    informationTitle: (data.informationTitle as string) ?? "",
    informationText: (data.informationText as string | null) ?? null,
    overallBias: (data.overallBias as string | null) ?? null,
    informationReliability:
      (data.informationReliability as string | null) ?? null,
    informationCredibility:
      (data.informationCredibility as string | null) ?? null,
    customData: (data.customData as Record<string, string>) ?? {},
  };
}

function labelFromSnapshot(snapshot: DocumentSnapshot): Label {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    label: (data.label as string) ?? "",
    color: (data.color as string) ?? "#9ca3af",
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

  // Every project starts with a standard set of labels (see docs/dataModel.md).
  const labels = collection(db, "projects", docRef.id, "labels");
  await Promise.all(DEFAULT_LABELS.map((entry) => addDoc(labels, entry)));

  return docRef.id;
}

/** Rename a project. */
export async function updateProjectTitle(
  projectId: string,
  title: string,
): Promise<void> {
  await updateDoc(doc(db, "projects", projectId), { title: title.trim() });
}

/**
 * Add a contributor to a project by email. The email is normalised (trimmed and
 * lower-cased) the same way it is on project creation, so access checks line up
 * regardless of how the address was typed. Idempotent, and returns the stored
 * (normalised) form so callers can mirror it in their local list.
 */
export async function addContributor(
  projectId: string,
  email: string,
): Promise<string> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Enter an email address.");
  }
  await updateDoc(doc(db, "projects", projectId), {
    contributors: arrayUnion(normalized),
  });
  return normalized;
}

/**
 * Remove a contributor from a project. `email` must be the value as stored on
 * the project (already normalised). Before dropping them, any file locks they
 * still hold are released — otherwise those files would stay checked out (and
 * so un-editable for everyone else) with no way for the departed contributor to
 * check them back in. Idempotent.
 */
export async function removeContributor(
  projectId: string,
  email: string,
): Promise<void> {
  // Locks are keyed by uid (see `checkedOutBy` in docs/dataModel.md) while
  // contributors are tracked by email, so resolve the email to a uid first. If
  // it can't be resolved (the user has no recorded email) there are no locks we
  // can attribute to them, so just drop them from the list.
  const uid = await getUidForEmail(email);
  if (uid) {
    await releaseLocksHeldBy(projectId, uid);
  }
  await updateDoc(doc(db, "projects", projectId), {
    contributors: arrayRemove(email),
  });
}

/**
 * Clear `checkedOutBy` on every file in a project currently checked out by the
 * given uid, freeing those files for other contributors to edit.
 */
async function releaseLocksHeldBy(
  projectId: string,
  uid: string,
): Promise<void> {
  const filesSnapshot = await getDocs(
    collection(db, "projects", projectId, "files"),
  );
  await Promise.all(
    filesSnapshot.docs
      .filter((fileDoc) => (fileDoc.data().checkedOutBy ?? null) === uid)
      .map((fileDoc) => updateDoc(fileDoc.ref, { checkedOutBy: null })),
  );
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
    overallBias: null,
    source: null,
    fileReliability: null,
    fileCredibility: null,
    checkedOutBy: null,
    labels: [] as DocumentReference[],
  };
  await setDoc(fileRef, fileData);

  if (folderId) {
    await updateDoc(doc(db, "projects", projectId, "folders", folderId), {
      subfiles: arrayUnion(fileRef),
    });
  }

  return { id: fileRef.id, ...fileData, labels: [], customData: {} };
}

/**
 * Update the user-supplied metadata on a file: its `author`, `createdDate`
 * (a unix timestamp in seconds, or null when cleared), and the free-text
 * assessments (`overallBias`, `source`, `fileReliability`, `fileCredibility`,
 * each null when cleared). Other fields are left untouched.
 */
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
    customData: Record<string, string>;
  },
): Promise<void> {
  await updateDoc(doc(db, "projects", projectId, "files", fileId), {
    author: metadata.author,
    createdDate: metadata.createdDate,
    overallBias: metadata.overallBias,
    source: metadata.source,
    fileReliability: metadata.fileReliability,
    fileCredibility: metadata.fileCredibility,
    customData: metadata.customData,
  });
}

/**
 * Subscribe to a file document and receive the latest `FileDoc` whenever it
 * changes in Firestore. Used so an open sidebar reflects another contributor's
 * edits live — both who currently has it checked out and the saved field values
 * they leave behind. Returns an unsubscribe function; snapshots for a deleted
 * document are ignored.
 */
export function subscribeToFile(
  projectId: string,
  fileId: string,
  onChange: (file: FileDoc) => void,
): () => void {
  return onSnapshot(
    doc(db, "projects", projectId, "files", fileId),
    (snapshot) => {
      if (snapshot.exists()) onChange(fileFromSnapshot(snapshot));
    },
  );
}

/**
 * Try to check a file out to a user by recording their uid in `checkedOutBy`
 * (see docs/dataModel.md). Runs in a transaction so a simultaneous claim by two
 * users has exactly one winner: the claim only succeeds when the file is free
 * or already held by `uid`. Returns true when the caller now holds the lock and
 * false when someone else got there first. While checked out, other users'
 * clients grey the file's fields out and refuse edits.
 */
export async function checkOutFile(
  projectId: string,
  fileId: string,
  uid: string,
): Promise<boolean> {
  const fileRef = doc(db, "projects", projectId, "files", fileId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(fileRef);
    const current = (snapshot.data()?.checkedOutBy as string | null) ?? null;
    if (current != null && current !== uid) {
      return false;
    }
    transaction.update(fileRef, { checkedOutBy: uid });
    return true;
  });
}

/** Release a file's check-out so other users may edit it again. */
export async function checkInFile(
  projectId: string,
  fileId: string,
): Promise<void> {
  await updateDoc(doc(db, "projects", projectId, "files", fileId), {
    checkedOutBy: null,
  });
}

/**
 * Subscribe to a file's `information` subcollection (see docs/dataModel.md),
 * receiving the full list whenever any entry is added, edited, or removed. Used
 * to keep the information sidebar's title list live across contributors. Returns
 * an unsubscribe function.
 */
export function subscribeToInformation(
  projectId: string,
  fileId: string,
  onChange: (information: Information[]) => void,
): () => void {
  return onSnapshot(
    collection(db, "projects", projectId, "files", fileId, "information"),
    (snapshot) => {
      onChange(snapshot.docs.map(informationFromSnapshot));
    },
  );
}

/**
 * Mint an id for a new information entry without writing anything. Lets the UI
 * show a new entry immediately (and open it for editing) before the create has
 * been acknowledged by Firebase.
 */
export function newInformationId(projectId: string, fileId: string): string {
  return doc(collection(db, "projects", projectId, "files", fileId, "information"))
    .id;
}

/**
 * Create a new information entry in a file's `information` subcollection. Only
 * the user holding the file's check-out may write here (enforced in the UI; see
 * docs/dataModel.md). Pass an `id` (e.g. from `newInformationId`) to create the
 * entry at a known id; otherwise one is generated. Returns the entry's id.
 */
export async function addInformation(
  projectId: string,
  fileId: string,
  fields: InformationFields,
  id?: string,
): Promise<string> {
  const information = collection(
    db,
    "projects",
    projectId,
    "files",
    fileId,
    "information",
  );
  if (id) {
    await setDoc(doc(information, id), fields);
    return id;
  }
  const docRef = await addDoc(information, fields);
  return docRef.id;
}

/** Update an existing information entry's fields. */
export async function updateInformation(
  projectId: string,
  fileId: string,
  informationId: string,
  fields: InformationFields,
): Promise<void> {
  await updateDoc(
    doc(db, "projects", projectId, "files", fileId, "information", informationId),
    fields,
  );
}

/** Delete an information entry from a file's `information` subcollection. */
export async function deleteInformation(
  projectId: string,
  fileId: string,
  informationId: string,
): Promise<void> {
  await deleteDoc(
    doc(db, "projects", projectId, "files", fileId, "information", informationId),
  );
}

/**
 * Resolve a file's Firebase Storage reference to a download URL the browser can
 * load directly (used for previewing images and PDFs).
 */
export async function getFileDownloadUrl(
  storageReference: string,
): Promise<string> {
  return getDownloadURL(ref(storage, storageReference));
}

/** List every label option defined on a project. */
export async function getLabels(projectId: string): Promise<Label[]> {
  const snapshot = await getDocs(
    collection(db, "projects", projectId, "labels"),
  );
  return snapshot.docs.map(labelFromSnapshot);
}

/** Create a new label option on a project. Returns the new label. */
export async function createLabel(
  projectId: string,
  label: string,
  color: string,
): Promise<Label> {
  const trimmed = label.trim();
  const docRef = await addDoc(collection(db, "projects", projectId, "labels"), {
    label: trimmed,
    color,
  });
  return { id: docRef.id, label: trimmed, color };
}

/** Rename a label and/or change its color. */
export async function updateLabel(
  projectId: string,
  labelId: string,
  fields: { label: string; color: string },
): Promise<void> {
  await updateDoc(doc(db, "projects", projectId, "labels", labelId), {
    label: fields.label.trim(),
    color: fields.color,
  });
}

/**
 * Delete a label option from a project, also removing it from every file that
 * still references it so no dangling references are left behind.
 */
export async function deleteLabel(
  projectId: string,
  labelId: string,
): Promise<void> {
  const labelRef = doc(db, "projects", projectId, "labels", labelId);
  const filesSnapshot = await getDocs(
    collection(db, "projects", projectId, "files"),
  );
  await Promise.all(
    filesSnapshot.docs
      .filter((fileDoc) => {
        const refs = (fileDoc.data().labels as DocumentReference[] | undefined) ?? [];
        return refs.some((ref) => ref.id === labelId);
      })
      .map((fileDoc) =>
        updateDoc(fileDoc.ref, { labels: arrayRemove(labelRef) }),
      ),
  );
  await deleteDoc(labelRef);
}

/** Apply a label to a file (idempotent). */
export async function addLabelToFile(
  projectId: string,
  fileId: string,
  labelId: string,
): Promise<void> {
  const labelRef = doc(db, "projects", projectId, "labels", labelId);
  await updateDoc(doc(db, "projects", projectId, "files", fileId), {
    labels: arrayUnion(labelRef),
  });
}

/** Remove a label from a file (idempotent). */
export async function removeLabelFromFile(
  projectId: string,
  fileId: string,
  labelId: string,
): Promise<void> {
  const labelRef = doc(db, "projects", projectId, "labels", labelId);
  await updateDoc(doc(db, "projects", projectId, "files", fileId), {
    labels: arrayRemove(labelRef),
  });
}

function customFieldDefFromSnapshot(snapshot: DocumentSnapshot): CustomFieldDef {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    name: (data.name as string) ?? "",
    target: (data.target as "file" | "information") ?? "file",
  };
}

/** List every custom field definition on a project. */
export async function getCustomFieldDefs(projectId: string): Promise<CustomFieldDef[]> {
  const snapshot = await getDocs(
    collection(db, "projects", projectId, "customFieldDefs"),
  );
  return snapshot.docs.map(customFieldDefFromSnapshot);
}

/** Create a custom field definition. Returns the new def. */
export async function createCustomFieldDef(
  projectId: string,
  name: string,
  target: "file" | "information",
): Promise<CustomFieldDef> {
  const trimmed = name.trim();
  const docRef = await addDoc(
    collection(db, "projects", projectId, "customFieldDefs"),
    { name: trimmed, target },
  );
  return { id: docRef.id, name: trimmed, target };
}

/** Rename a custom field definition. */
export async function updateCustomFieldDef(
  projectId: string,
  defId: string,
  name: string,
): Promise<void> {
  await updateDoc(
    doc(db, "projects", projectId, "customFieldDefs", defId),
    { name: name.trim() },
  );
}

/**
 * Delete a custom field definition and remove its key from every file or
 * information document that carries it (mirrors deleteLabel).
 */
export async function deleteCustomFieldDef(
  projectId: string,
  defId: string,
  target: "file" | "information",
): Promise<void> {
  const filesSnapshot = await getDocs(
    collection(db, "projects", projectId, "files"),
  );

  if (target === "file") {
    await Promise.all(
      filesSnapshot.docs
        .filter((fileDoc) => {
          const cd = (fileDoc.data().customData as Record<string, string> | undefined) ?? {};
          return defId in cd;
        })
        .map((fileDoc) =>
          updateDoc(fileDoc.ref, { [`customData.${defId}`]: deleteField() }),
        ),
    );
  } else {
    await Promise.all(
      filesSnapshot.docs.map(async (fileDoc) => {
        const infoSnapshot = await getDocs(
          collection(db, "projects", projectId, "files", fileDoc.id, "information"),
        );
        await Promise.all(
          infoSnapshot.docs
            .filter((infoDoc) => {
              const cd = (infoDoc.data().customData as Record<string, string> | undefined) ?? {};
              return defId in cd;
            })
            .map((infoDoc) =>
              updateDoc(infoDoc.ref, { [`customData.${defId}`]: deleteField() }),
            ),
        );
      }),
    );
  }

  await deleteDoc(doc(db, "projects", projectId, "customFieldDefs", defId));
}
