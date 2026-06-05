import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "./firebase";

// All Firestore access for projects is funneled through these functions so the
// UI never talks to Firebase directly (see docs/designPrinciples.md).

export type Project = {
  id: string;
  title: string;
  contributors: string[];
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
