import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Avoid re-initializing the app during fast-refresh / repeated imports.
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);

// In local development, talk to the Firebase Auth emulator instead of the real
// project so testing never creates accounts in production. Gated on an explicit
// env flag so the static export build always targets the live project.
if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === "true"
) {
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
}

export default app;
