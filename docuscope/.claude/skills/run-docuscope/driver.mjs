// Drives the running docuscope app through the full email/password auth flow
// against the Firebase Auth emulator, and screenshots each state.
//
// Prerequisites (started separately — see SKILL.md):
//   - Next.js dev server on http://localhost:3000  (npm run dev)
//   - Firebase Auth emulator on :9099              (firebase emulators:start --only auth)
//   - docuscope/.env.local has NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true
//
// Usage:
//   node .claude/skills/run-docuscope/driver.mjs
//   BASE_URL=http://localhost:3001 node .claude/skills/run-docuscope/driver.mjs
//
// Exit code 0 = every step passed. Screenshots land next to this script.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const OUT_DIR = dirname(fileURLToPath(import.meta.url));
// Unique email per run so re-running never collides with an existing account.
const EMAIL = `tester+${Date.now()}@example.com`;
const PASSWORD = "testpass123";

const shot = (page, name) =>
  page.screenshot({ path: join(OUT_DIR, `screenshot-${name}.png`) });

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // 1. Logged-out state: Sign Up + Log In buttons (rendered after hydration).
  await page.getByRole("button", { name: "Sign Up" }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Log In" }).waitFor();
  await shot(page, "1-logged-out");
  console.log("✓ logged-out state shows Sign Up + Log In");

  // 2. Sign Up -> account created in the emulator -> Welcome header.
  await page.getByRole("button", { name: "Sign Up" }).click();
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.getByRole("heading", { name: `Welcome ${EMAIL}` }).waitFor({ timeout: 15000 });
  await shot(page, "2-signed-up");
  console.log(`✓ sign up created ${EMAIL} and shows Welcome header`);

  // 3. Log Out -> back to the buttons.
  await page.getByRole("button", { name: "Log Out" }).click();
  await page.getByRole("button", { name: "Sign Up" }).waitFor({ timeout: 10000 });
  console.log("✓ log out returns to logged-out state");

  // 4. Log In with the same credentials -> Welcome header again.
  await page.getByRole("button", { name: "Log In" }).click();
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.getByRole("heading", { name: `Welcome ${EMAIL}` }).waitFor({ timeout: 15000 });
  await shot(page, "3-logged-in");
  console.log("✓ log in with the same account shows Welcome header");

  if (errors.length) fail(`page errors: ${errors.join("; ")}`);
} catch (err) {
  await shot(page, "error").catch(() => {});
  fail(err.message);
} finally {
  await browser.close();
}

if (process.exitCode) console.error("\nDRIVER FAILED — see screenshots in skill dir");
else console.log("\nALL FLOWS PASSED");
