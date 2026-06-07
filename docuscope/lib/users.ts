import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

// All Firestore access for the `users` collection is funneled through these
// functions so the UI never talks to Firebase directly (see
// docs/designPrinciples.md). The document id is the user's Firebase auth uid
// (see docs/dataModel.md).

export type UserProfile = {
  /** The user's full name. */
  name: string;
};

/**
 * Fetch a user's profile. Returns null when the user has no profile document
 * yet (e.g. they have never set their name).
 */
export async function getUserProfile(
  uid: string,
): Promise<UserProfile | null> {
  const snapshot = await getDoc(doc(db, "users", uid));
  if (!snapshot.exists()) {
    return null;
  }
  const data = snapshot.data();
  return { name: typeof data.name === "string" ? data.name : "" };
}

/** Set (or update) the display name on a user's profile. */
export async function setUserName(uid: string, name: string): Promise<void> {
  await setDoc(doc(db, "users", uid), { name }, { merge: true });
}

/**
 * Record the user's (lower-cased) auth email on their profile document, so a
 * contributor email can later be mapped back to their uid (see
 * docs/dataModel.md). Idempotent and merged, so it's safe to call on every
 * sign-in without disturbing the name.
 */
export async function recordUserEmail(
  uid: string,
  email: string,
): Promise<void> {
  await setDoc(
    doc(db, "users", uid),
    { email: email.trim().toLowerCase() },
    { merge: true },
  );
}

/**
 * Resolve an email address to the uid of the user who owns it, using the email
 * recorded by recordUserEmail. Returns null when no user has that email on
 * record (e.g. they have never signed in since emails were tracked).
 */
export async function getUidForEmail(email: string): Promise<string | null> {
  const matching = query(
    collection(db, "users"),
    where("email", "==", email.trim().toLowerCase()),
  );
  const snapshot = await getDocs(matching);
  return snapshot.empty ? null : snapshot.docs[0].id;
}
