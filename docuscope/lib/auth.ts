import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";

// All Firebase auth access is funneled through these functions so the UI never
// talks to Firebase directly (see docs/designPrinciples.md). This makes it
// possible to swap providers later without touching the components.

export type { User };

/** Create a new account with an email + password and sign the user in. */
export async function signUp(email: string, password: string): Promise<User> {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/** Sign an existing user in with their email + password. */
export async function logIn(email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/** Sign the current user out. */
export function logOut(): Promise<void> {
  return signOut(auth);
}

/**
 * Subscribe to authentication state changes. The callback receives the current
 * user (or null when signed out). Returns an unsubscribe function.
 */
export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}
