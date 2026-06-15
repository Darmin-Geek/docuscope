When working on a task that involves the backend, first read `lib/drizzle/schema.ts`
— it is the source of truth for the database shape.

This project runs on AWS. There is a Next.js server (App Router API routes); it
is no longer a static export, and Firebase is no longer used.

Backend services:
- **Database** — PostgreSQL (Aurora in production) accessed through Drizzle ORM.
- **File storage** — S3. Files are uploaded directly from the browser via
  pre-signed PUT URLs and downloaded via pre-signed GET URLs.
- **Auth** — Amazon Cognito (OIDC). The browser holds an id_token; API routes
  verify it server-side.

Always use the local Docker Postgres for testing (started automatically by
`npm test`).

@AGENTS.md

## Project structure

Single-page app — the shell renders from `app/page.tsx`. There are no route
segments for navigation; auth state and the selected project are managed in
client-side React state. Server logic lives in `app/api/**/route.ts` handlers.

Key components (all in `app/`):
- `page.tsx` — top-level shell: shows login vs. the project list vs. `ProjectView`
- `ProjectView.tsx` — full-screen view shown when a project is selected; hosts
  the file table, folder tree, sidebars, upload, and the search box
- `FilesTable.tsx`, `FileSidebar.tsx`, `FolderTree.tsx`, `FolderView.tsx`,
  `InformationSidebar.tsx` — the project workspace pieces
- Modals: `CreateProjectModal`, `CreateFolderModal`, `MoveFileModal`,
  `ProjectSettingsModal`, `SettingsModal`, `DeleteInformationModal`

### Library layer (`lib/`)

Data access is split into client wrappers and server implementations so UI
components never talk to the database or AWS SDKs directly.

- `apiClient.ts` — `api()` fetch wrapper; attaches the Cognito id_token as a
  `Bearer` header (token obtained from the oidc-client-ts manager).
- `projects.ts` / `users.ts` — **client** API wrappers (call `/api/...`). These
  define the shared TypeScript types (`Project`, `FileDoc`, etc.).
- `projects.server.ts` / `users.server.ts` — **server** implementations using
  Drizzle. Imported only from API route handlers.
- `drizzle/schema.ts` — table definitions (Drizzle pg-core).
- `drizzle/db.ts` — lazy-initialised connection pool. Uses IAM auth tokens +
  SSL in production; a plain password connection when `TEST_AUTH_SECRET` is set
  (local Docker Postgres).
- `oidc.ts` / `auth.ts` — Cognito OIDC config and the shared `User` type.
- `verifyAuth.ts` — server-side id_token verification (`aws-jwt-verify`). When
  `TEST_AUTH_SECRET` is set it also accepts a `test:<secret>:<uid>:<email>`
  bypass token (never enabled in production).

### Database & migrations

Schema is defined in code (`lib/drizzle/schema.ts`) and managed with
drizzle-kit:
- `npm run db:generate` — generate a SQL migration into `drizzle/migrations/`
  after changing the schema.
- `npm run db:push` — apply the current schema to the database (used to set up
  the local Docker Postgres for tests).
- `npm run db:migrate` — run committed migrations.

Postgres full-text search covers both file metadata and PDF body text: `files`
has generated `tsvector` columns (author, source, bias, reliability,
credibility), and `file_chunks` stores overlapping word-chunks of extracted PDF
text with their own generated `tsvector`. All are GIN-indexed and queried via
`plainto_tsquery` in `getFiles` (`projects.server.ts`). PDF text is extracted in
the browser (`lib/pdfText.ts`) at upload time and chunked server-side in
`createFileRecord`; chunk size/overlap are configurable via `CHUNK_SIZE_WORDS`
and `CHUNK_OVERLAP_WORDS`.

## Testing

Run `npm test` — it runs `docker-compose up -d` (Postgres on host port 5433)
and then the Playwright suite. First-time setup: `npm run test:install` to
download the Chromium binary. The database schema must be present in the Docker
Postgres (apply with `npm run db:push`).

Test files live in `tests/`:
- `auth.test.ts` — sign-up and login flows
- `projects.test.ts`, `project-features.test.ts` — project/file/folder flows
- `search.test.ts` — full-text search (server-side unit tests + UI tests)
- `helpers.ts` — `createEmulatorUser()` seeds Cognito accounts via the Admin
  API; `injectOidcUser()` injects a fake OIDC session into localStorage using
  the `verifyAuth` test-bypass token so API calls succeed without the hosted UI
- `db-helpers.ts` — seed projects/files/folders directly via Drizzle
- `global-setup.ts` — verifies the database is reachable before tests run

## UI conventions

- Auth is OIDC-based via Cognito; the page shows Sign Up / Log In when logged
  out. After auth the heading "Your Projects" is the landmark that confirms a
  successful login.
- The last-opened project is persisted in `localStorage` under the key
  `docuscope:selectedProjectId` and restored on next load.
- Tailwind v4 is in use — config lives in `postcss.config.mjs`, not
  `tailwind.config.js`.
