---
name: run-docuscope
description: Build, launch, and drive the docuscope Next.js app — run it, start the dev server, screenshot the UI, or test the Firebase email/password sign-up / log-in / log-out flow end-to-end against the Auth emulator.
---

# Run docuscope

docuscope is a **Next.js 16 static-export** app (`output: 'export'`) whose only
backend is Firebase. Auth is **entirely client-side** (email/password). The
agent path drives a headless Chromium via Playwright
([driver.mjs](.claude/skills/run-docuscope/driver.mjs)) through the full
sign-up → welcome → log-out → log-in flow, against the **Firebase Auth
emulator** — never the live project.

All paths below are relative to the `docuscope/` unit dir. Run every `npm`
command from there (the app is in `docuscope/`, not the repo root).

## Prerequisites

Installed/verified this session: Node 22, Firebase CLI 15.x, Java 21 (the
emulator needs a JRE), Playwright + Chromium.

```bash
npm install                       # app deps (includes firebase ^12)
npm install -D playwright         # the driver's browser automation
npx playwright install chromium   # downloads headless Chromium (~112 MiB)
firebase --version                # expect 15.x — install: npm i -g firebase-tools
java -version                     # any JRE; needed by the Auth emulator
```

## Setup — `.env.local` (required, or the app 500s)

`docuscope/.env.local` must hold the Firebase web config **and** the emulator
flag. Without a valid `NEXT_PUBLIC_FIREBASE_API_KEY` the app returns HTTP 500
(see Gotchas).

```
NEXT_PUBLIC_FIREBASE_API_KEY=<from Firebase console → Project settings → Your apps>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=docuscope-investigate.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=docuscope-investigate
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=docuscope-investigate.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<sender id>
NEXT_PUBLIC_FIREBASE_APP_ID=<app id>
NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true
```

## Run (agent path)

Three terminals (or background two). Start the emulator and dev server, then
run the driver:

```bash
# 1. Firebase Auth emulator — port 9099, UI at http://127.0.0.1:4000/auth
firebase emulators:start --only auth --project docuscope-investigate

# 2. Next.js dev server — http://localhost:3000
npm run dev

# 3. Drive the full auth flow headlessly (BASE_URL defaults to :3000)
node .claude/skills/run-docuscope/driver.mjs
```

Expected output — exit 0:

```
✓ logged-out state shows Sign Up + Log In
✓ sign up created tester+<ts>@example.com and shows Welcome header
✓ log out returns to logged-out state
✓ log in with the same account shows Welcome header

ALL FLOWS PASSED
```

Screenshots land next to the driver: `screenshot-1-logged-out.png`,
`screenshot-2-signed-up.png`, `screenshot-3-logged-in.png` (gitignored). On
failure the driver also writes `screenshot-error.png`. **Open the screenshot** —
a blank frame means hydration didn't finish or Firebase failed to init.

Confirm the account went to the emulator, not production:

```bash
curl -s "http://localhost:9099/identitytoolkit.googleapis.com/v1/projects/docuscope-investigate/accounts:query" \
  -H "Authorization: Bearer owner" -H "Content-Type: application/json" -X POST -d '{}'
# -> {"recordsCount":"N","userInfo":[{"email":"tester+...@example.com",...}]}
```

## Run (human path)

`npm run dev`, open http://localhost:3000, click **Sign Up** / **Log In**.
Useless headless — the buttons only render after client hydration.

## Test

No unit-test suite. The driver above is the end-to-end smoke test.
Typecheck with `npx tsc --noEmit` (exit 0 = clean).

## Gotchas

- **`curl http://localhost:3000/` shows neither buttons nor "Welcome".** The
  page renders `null` during SSR while auth state resolves (`loading` is true);
  Sign Up / Log In and the Welcome header only appear after client hydration +
  the `onAuthStateChanged` callback. Verify the UI with the **browser driver**,
  not curl/grep-on-HTML.
- **Empty/missing `NEXT_PUBLIC_FIREBASE_API_KEY` → HTTP 500 on `/`, not a
  client error.** `getAuth()` throws `auth/invalid-api-key` at module load, and
  because client components are server-rendered for the initial HTML, that
  throw surfaces as a 500. Fill in real config before running.
- **Always use the emulator.** With `NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true`,
  `lib/firebase.ts` calls `connectAuthEmulator(auth, "http://localhost:9099")`
  (gated on that flag + `window` defined). Without it, sign-up creates **real
  accounts** in `docuscope-investigate`. The static-export production build
  leaves the flag unset, so it targets the live project.
- **Changing the emulator flag needs a browser reload.** Next hot-reloads
  `.env.local`, but the `connectAuthEmulator` call is inlined into the client
  bundle — reload the page so the new bundle loads.
- **"inferred your workspace root" warning.** Nested `package-lock.json` files
  (worktree root + `docuscope/`) confuse Next's root detection. Harmless.
- **Emulator ports:** auth 9099, UI 4000, hub 4400 — and it needs Java.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `GET / 500`, log shows `auth/invalid-api-key` | `NEXT_PUBLIC_FIREBASE_API_KEY` is empty in `.env.local`. Set it, restart `npm run dev`. |
| Driver hangs on "Welcome" then errors | Auth emulator not running, or `NEXT_PUBLIC_FIREBASE_USE_EMULATOR` not `true`. Start emulator, reload. |
| `preview/driver` can't reach `:3000` | Dev server isn't up, or another process holds 3000. Start `npm run dev` from `docuscope/`. |
| `firebase emulators:start` exits immediately | Missing JRE — install Java, re-run. |
| `Executable doesn't exist … chromium_headless_shell` | Run `npx playwright install chromium`. |
