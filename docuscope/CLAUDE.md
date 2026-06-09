When working on a task that involves the backend, first read docs/dataModel.md

This project is deployed via static export. Firebase is the only backend.

Always use the firebase emulator for testing.

@AGENTS.md

## Project structure

Single-page app — everything renders from `app/page.tsx`. There are no route
segments; auth state and selected project are managed in client-side React state.

Key components (all in `app/`):
- `AuthModal.tsx` — handles both sign-up and login via a `mode` prop
- `CreateProjectModal.tsx` — creates a project and calls back to reload the list
- `ProjectView.tsx` — full-screen view shown when a project is selected
- `ResetPasswordModal.tsx`, `SettingsModal.tsx` — standalone modals

Library layer (`lib/`):
- `firebase.ts` — initialises Firebase; connects to emulators when
  `NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true` (set in `.env.local` for local dev)
- `auth.ts` — wraps Firebase Auth (`signUp`, `logIn`, `logOut`, `onAuthChange`,
  `resetPassword`); normalises emails to lowercase before every call
- `projects.ts` — Firestore project CRUD (`getProjectsForUser`, `createProject`)
- `users.ts` — user profile reads/writes (`getUserProfile`, `recordUserEmail`)

Firebase emulators: auth on `:9099`, Firestore on `:8080`, Storage on `:9199`.
The emulator flag is already `true` in `.env.local`; no extra setup needed.

## Testing

Run `npm test` — this uses `firebase emulators:exec` to start/stop emulators
around the Playwright suite automatically.

Test files live in `tests/`:
- `auth.test.ts` — sign-up and login flows
- `projects.test.ts` — create-project flow
- `helpers.ts` — `createEmulatorUser()` seeds accounts via the Auth emulator
  REST API without going through the UI
- `global-setup.ts` — verifies the Auth emulator is reachable before tests run

First-time setup: run `npm run test:install` to download the Chromium binary.

## UI conventions

- Auth is modal-based, not route-based. The page shows Sign Up / Log In buttons
  when logged out; after auth the heading "Your Projects" is the landmark that
  confirms a successful login.
- The last-opened project is persisted in `localStorage` under the key
  `docuscope:selectedProjectId` and restored on next load.
- Tailwind v4 is in use — config lives in `postcss.config.mjs`, not
  `tailwind.config.js`.
