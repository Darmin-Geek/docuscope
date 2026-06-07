import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";

// All Firebase auth access is funneled through these functions so the UI never
// talks to Firebase directly (see docs/designPrinciples.md). This makes it
// possible to swap providers later without touching the components.

export type { User };

// Email addresses are case-insensitive, but Firebase auth stores them verbatim.
// We normalise every address to lower case before it reaches Firebase so a
// user's auth token email always matches the lower-cased emails stored in
// project contributor lists (see lib/projects.ts), keeping the security rules
// and project queries reliable regardless of how the address was typed.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Create a new account with an email + password and sign the user in. */
export async function signUp(email: string, password: string): Promise<User> {
  const credential = await createUserWithEmailAndPassword(
    auth,
    normalizeEmail(email),
    password,
  );
  return credential.user;
}

/** Sign an existing user in with their email + password. */
export async function logIn(email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(
    auth,
    normalizeEmail(email),
    password,
  );
  return credential.user;
}

/** Send a password reset email to the given address. */
export function resetPassword(email: string): Promise<void> {
  return sendPasswordResetEmail(auth, normalizeEmail(email));
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
