// Runs once before all tests. Verifies the Firebase Auth emulator is reachable
// so failures give a clear error instead of a cryptic network timeout.
export default async function globalSetup() {
  const url = "http://localhost:9099";
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(
    `Firebase Auth emulator is not reachable at ${url}.\n` +
      "Run tests via `npm test` which starts the emulators automatically,\n" +
      "or start them manually with: firebase emulators:start --only auth,firestore,storage"
  );
}
