import { doc, getDoc, setDoc } from "firebase/firestore";
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
