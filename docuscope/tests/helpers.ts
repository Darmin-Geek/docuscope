const AUTH_EMULATOR = "http://localhost:9099";
const PROJECT_ID = "docuscope-investigate";

/**
 * Creates a user directly via the Auth emulator REST API, bypassing the UI.
 * Use this to seed an existing account for login tests.
 */
export async function createEmulatorUser(
  email: string,
  password: string
): Promise<void> {
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to create emulator user: ${await res.text()}`);
  }
}

/**
 * Deletes all accounts from the Auth emulator. Call in beforeEach / afterEach
 * when tests need a clean slate (not required when using unique emails per test).
 */
export async function clearEmulatorAccounts(): Promise<void> {
  await fetch(
    `${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: "DELETE" }
  );
}
