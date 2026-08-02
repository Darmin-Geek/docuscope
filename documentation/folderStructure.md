# Folder Structure

A map of the DocuScope repository: what lives in each directory and why.

SIAM (formerly called docuscope) is a Next.js (App Router) application running on AWS — PostgreSQL via
Drizzle ORM, S3 for file storage, and Amazon Cognito for auth. The repository
root is a thin wrapper; almost all application code lives in `docuscope/`.

---

## Repository root

| Path | Purpose |
| --- | --- |
| `docuscope/` | The Next.js application. All app code, tests, and build config live here. |
| `documentation/` | Project documentation written for humans (this file lives here). |
| `.github/` | GitHub configuration. `workflows/claude.yml` defines the CI/automation workflow. |
| `.claude/` | Claude Code configuration for the repo — local settings plus scratch git worktrees used by background agents. Not part of the application. |
| `docker-compose.yml` | Local Postgres container (host port 5433) started automatically by `npm test`. |
| `.env` / `.env.example` | Environment variables for local development; `.env.example` documents the required keys. |
| `Set-DockerEnv.ps1` | PowerShell helper for pointing the shell at the local Docker environment. |
| `CLAUDE.md` | Instructions for AI coding agents; re-exports `docuscope/CLAUDE.md`. |

---

## `docuscope/` — the application

### `app/` — UI and API routes

Next.js App Router directory. It holds both the client-side single-page app and
the server-side API handlers.

**Shell and page components.** There are no route segments for navigation — the
entire product renders from `page.tsx`, with auth state and the selected project
held in client-side React state.

- `layout.tsx`, `providers.tsx`, `globals.css` — root document, context
  providers (OIDC/auth), and Tailwind v4 global styles.
- `page.tsx` — top-level shell: login screen vs. project list vs. `ProjectView`.
- `ProjectView.tsx` — full-screen project workspace hosting the file table,
  folder tree, sidebars, upload, and search.
- `FilesTable.tsx`, `FolderTree.tsx`, `FolderView.tsx` — file/folder browsing.
- `FileSidebar.tsx`, `InformationSidebar.tsx` — detail panels for a selected
  file and for extracted information items.
- `PdfViewerModal.tsx` — in-browser PDF viewing (backed by `public/pdfium.wasm`).
- Modals: `CreateProjectModal`, `CreateFolderModal`, `MoveFileModal`,
  `ProjectSettingsModal`, `SettingsModal`, `DeleteInformationModal`,
  `DraftConflictModal`.
- Small shared pieces: `AdmiraltyCodeSelect.tsx` (source reliability /
  information credibility dropdowns), `LabelPill.tsx`.
- Hooks: `useFileDraft.ts` (draft editing state) and `useFileLock.ts`
  (checkout/locking so two users don't edit the same file).

#### `app/api/` — server route handlers

Every `route.ts` is a server-side endpoint. Handlers verify the Cognito
`id_token` and then delegate to the `*.server.ts` modules in `lib/`; they are
the only place the database and AWS SDKs are touched.

The tree mirrors the resource hierarchy:

```
api/
  users/[uid]                                  user profile
  projects/                                    list + create projects
    [id]/                                      read/update/delete a project
      contributors/[contributorEmail]          project membership
      folders/                                 folder tree
      labels/[labelId]                         project-wide labels
      files/                                   list + create file records
        upload-url/                            pre-signed S3 PUT for uploads
        folder-file-ids/                       ids of files under a folder
        [fileId]/                              file metadata
          download-url/                        pre-signed S3 GET
          checkout/                            acquire/release the edit lock
          draft/                               save an in-progress edit
          submit/                              submit a completed file
          move/                                move between folders
          ocr/                                 OCR job for scanned PDFs
          labels/                              labels on a file
          information/[infoId]/                extracted information items
            labels/[labelId]                   labels on an information item
            selections/[selectionId]           PDF region/text selections
```

### `lib/` — data access and shared logic

Split deliberately into **client wrappers** and **server implementations** so UI
components never import the database or AWS SDKs.

- `apiClient.ts` — the `api()` fetch wrapper; attaches the Cognito id_token as a
  `Bearer` header. `apiError.ts` holds the shared error shape.
- `projects.ts`, `users.ts` — client API wrappers (call `/api/...`) and the home
  of the shared TypeScript types (`Project`, `FileDoc`, …).
- `projects.server.ts`, `users.server.ts` — server implementations using
  Drizzle; imported only from API route handlers. Full-text search
  (`getFiles`) and chunking of extracted PDF text live here.
- `auth.ts`, `oidc.ts`, `cognito.ts` — the shared `User` type and Cognito/OIDC
  configuration.
- `verifyAuth.ts` — server-side id_token verification via `aws-jwt-verify`. When
  `TEST_AUTH_SECRET` is set it also accepts a `test:<secret>:<uid>:<email>`
  bypass token (never enabled in production).
- `pdfText.ts` / `pdfTextServer.ts` — PDF text extraction (browser-side at
  upload time, and the server-side counterpart).
- `admiralty.ts` — the Admiralty Code rating scales.
- `draftValidation.ts`, `folderTree.ts` — draft-submission rules and folder tree
  construction shared by client and server.

#### `lib/drizzle/`

- `schema.ts` — **the source of truth for the database shape.** Table
  definitions in Drizzle pg-core, including the generated `tsvector` columns
  that back full-text search.
- `db.ts` — lazily-initialised connection pool. IAM auth tokens + SSL in
  production; plain password auth against local Docker Postgres when
  `TEST_AUTH_SECRET` is set.

### `drizzle/` — generated migrations

`drizzle/migrations/` holds the numbered SQL migrations produced by
`npm run db:generate` after a schema change, plus drizzle-kit's `meta/`
snapshots. Apply them with `npm run db:migrate`, or push the current schema
straight to a database with `npm run db:push`. Configuration is in
`drizzle.config.ts`.

### `tests/` — Playwright suite

Run with `npm test`, which brings up the Docker Postgres first.

- Feature specs: `auth`, `projects`, `project-features`, `folders`, `search`,
  `admiralty`, `checkout`, `draft`, `ocr`, `pdf-viewer`, `selections`,
  `folderTree`.
- `helpers.ts` — `createEmulatorUser()` seeds Cognito accounts;
  `injectOidcUser()` injects a fake OIDC session into localStorage using the
  `verifyAuth` test-bypass token.
- `db-helpers.ts` — seed projects/files/folders directly via Drizzle.
- `global-setup.ts` — verifies the database is reachable before tests run.
- `fixtures/` — sample assets (e.g. `sample.pdf`) used by the specs.

`test-results/` is Playwright's generated output (traces, screenshots) — not
source, safe to delete.

### `public/` — static assets

Served at the site root: icons/SVGs and `pdfium.wasm`, the PDF rendering engine
copied in at build time by `scripts/copy-pdfium.mjs`.

### `scripts/`

Build-time helper scripts. Currently `copy-pdfium.mjs`, which copies the pdfium
WebAssembly binary out of `node_modules` into `public/`.

### Configuration files

| File | Purpose |
| --- | --- |
| `next.config.ts` | Next.js configuration (server app, not a static export). |
| `postcss.config.mjs` | Tailwind v4 config — there is no `tailwind.config.js`. |
| `tsconfig.json` | TypeScript compiler settings. |
| `eslint.config.mjs` | Lint rules. |
| `playwright.config.ts` | Test runner setup. |
| `drizzle.config.ts` | Migration generation settings. |
| `Dockerfile`, `Dockerfile.dev` | Production and development container images. |
| `CLAUDE.md`, `AGENTS.md` | Instructions for AI coding agents working in this repo. |
| `README.md` | Getting-started notes. |

