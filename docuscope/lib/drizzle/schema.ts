import {
  pgTable,
  text,
  uuid,
  bigint,
  boolean,
  integer,
  char,
  doublePrecision,
  jsonb,
  primaryKey,
  customType,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const tsvector = customType<{ data: string }>({
  dataType() { return 'tsvector'; },
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
});

export const projectContributors = pgTable(
  'project_contributors',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.email] })],
);

// Project-scoped labels. `kind` separates labels applied to whole files
// ('file') from labels applied to individual pieces of information
// ('information'); the two sets are managed separately in Project Settings and
// never mixed (see issue #75).
export const labels = pgTable('labels', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  color: char('color', { length: 7 }).notNull().default('#9ca3af'),
  kind: text('kind').notNull().default('file'),
});

export const folders = pgTable('folders', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  folderName: text('folder_name').notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => folders.id, {
    onDelete: 'cascade',
  }),
});

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  author: text('author'),
  createdDate: bigint('created_date', { mode: 'number' }),
  storageReference: text('storage_reference').notNull().default(''),
  overallBias: text('overall_bias'),
  source: text('source'),
  fileReliability: text('file_reliability'),
  fileCredibility: text('file_credibility'),
  // Admiralty-code ratings (see issue #80). Reliability is an Alpha code A-F,
  // credibility a numeric code 1-6; both are nullable (blank by default) and
  // sit alongside the free-text reliability/credibility descriptions above. Not
  // searchable — the option descriptions are static UI text, so no tsvector.
  fileReliabilityCode: text('file_reliability_code'),
  fileCredibilityCode: text('file_credibility_code'),
  checkedOutBy: text('checked_out_by'),

  // Generated stored tsvector columns — one per searchable metadata field. The
  // paragraph fields now hold sanitised HTML (issue #81), so their vectors strip
  // "<...>" tags to spaces before tokenising, keeping search on visible words
  // (a search for "biased" still matches "<strong>biased</strong>", and tag
  // names like "strong"/"li" never become search tokens). Author is single-line
  // plain text and is left untouched.
  authorTsv: tsvector('author_tsv').generatedAlwaysAs(
    sql`to_tsvector('english', coalesce(author, ''))`,
  ),
  overallBiasTsv: tsvector('overall_bias_tsv').generatedAlwaysAs(
    sql`to_tsvector('english', regexp_replace(coalesce(overall_bias, ''), '<[^>]+>', ' ', 'g'))`,
  ),
  sourceTsv: tsvector('source_tsv').generatedAlwaysAs(
    sql`to_tsvector('english', regexp_replace(coalesce(source, ''), '<[^>]+>', ' ', 'g'))`,
  ),
  fileReliabilityTsv: tsvector('file_reliability_tsv').generatedAlwaysAs(
    sql`to_tsvector('english', regexp_replace(coalesce(file_reliability, ''), '<[^>]+>', ' ', 'g'))`,
  ),
  fileCredibilityTsv: tsvector('file_credibility_tsv').generatedAlwaysAs(
    sql`to_tsvector('english', regexp_replace(coalesce(file_credibility, ''), '<[^>]+>', ' ', 'g'))`,
  ),
},
(t) => [
  // Separate GIN indexes — tsvector_ops only supports single-column GIN.
  index('files_author_tsv_idx').using('gin', t.authorTsv),
  index('files_overall_bias_tsv_idx').using('gin', t.overallBiasTsv),
  index('files_source_tsv_idx').using('gin', t.sourceTsv),
  index('files_file_reliability_tsv_idx').using('gin', t.fileReliabilityTsv),
  index('files_file_credibility_tsv_idx').using('gin', t.fileCredibilityTsv),
]);

// Chunks of a file's extracted text (e.g. PDF body). Each chunk carries a
// generated tsvector so chunk content is full-text searchable alongside file
// metadata. Chunks are produced by the server when a file record is created.
export const fileChunks = pgTable(
  'file_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    contentTsv: tsvector('content_tsv').generatedAlwaysAs(
      sql`to_tsvector('english', content)`,
    ),
  },
  (t) => [
    index('file_chunks_content_tsv_idx').using('gin', t.contentTsv),
    index('file_chunks_file_id_idx').on(t.fileId),
  ],
);

// Tracks an asynchronous "OCR this PDF" run for a file. OCR is slow (it shells
// out to ocrmypdf), so the request enqueues a job here and returns immediately;
// the work runs detached and updates this row, which the client polls.
// Timestamps are epoch milliseconds (matching `files.created_date`), set by the
// app so the stale-job reaper can compare against `Date.now()`.
export const ocrJobs = pgTable(
  'ocr_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    // pending | running | done | error
    status: text('status').notNull().default('pending'),
    error: text('error'),
    startedAt: bigint('started_at', { mode: 'number' }),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => [
    // At most one active (pending/running) job per file — guards against
    // double-OCR from a double click or concurrent requests.
    uniqueIndex('ocr_jobs_one_active_per_file')
      .on(t.fileId)
      .where(sql`status in ('pending', 'running')`),
    index('ocr_jobs_file_id_idx').on(t.fileId),
  ],
);

export const fileLabels = pgTable(
  'file_labels',
  {
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.labelId] })],
);

// Assignments of an 'information'-kind label to a piece of information. Mirrors
// fileLabels but for information rows (see issue #75).
export const informationLabels = pgTable(
  'information_labels',
  {
    informationId: uuid('information_id')
      .notNull()
      .references(() => information.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.informationId, t.labelId] })],
);

export const fileFolders = pgTable(
  'file_folders',
  {
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => folders.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.folderId] })],
);

export const information = pgTable(
  'information',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    informationTitle: text('information_title').notNull().default(''),
    informationText: text('information_text'),
    overallBias: text('overall_bias'),
    informationReliability: text('information_reliability'),
    informationCredibility: text('information_credibility'),
    // Admiralty-code ratings (see issue #80), mirroring the file-level columns.
    informationReliabilityCode: text('information_reliability_code'),
    informationCredibilityCode: text('information_credibility_code'),

    // Title is single-line plain text; the four paragraph fields hold sanitised
    // HTML (issue #81) so their vectors strip "<...>" tags before tokenising.
    titleTsv: tsvector('title_tsv').generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(information_title, ''))`,
    ),
    textTsv: tsvector('text_tsv').generatedAlwaysAs(
      sql`to_tsvector('english', regexp_replace(coalesce(information_text, ''), '<[^>]+>', ' ', 'g'))`,
    ),
    overallBiasTsv: tsvector('overall_bias_tsv').generatedAlwaysAs(
      sql`to_tsvector('english', regexp_replace(coalesce(overall_bias, ''), '<[^>]+>', ' ', 'g'))`,
    ),
    reliabilityTsv: tsvector('reliability_tsv').generatedAlwaysAs(
      sql`to_tsvector('english', regexp_replace(coalesce(information_reliability, ''), '<[^>]+>', ' ', 'g'))`,
    ),
    credibilityTsv: tsvector('credibility_tsv').generatedAlwaysAs(
      sql`to_tsvector('english', regexp_replace(coalesce(information_credibility, ''), '<[^>]+>', ' ', 'g'))`,
    ),
  },
  (t) => [
    index('information_title_tsv_idx').using('gin', t.titleTsv),
    index('information_text_tsv_idx').using('gin', t.textTsv),
    index('information_overall_bias_tsv_idx').using('gin', t.overallBiasTsv),
    index('information_reliability_tsv_idx').using('gin', t.reliabilityTsv),
    index('information_credibility_tsv_idx').using('gin', t.credibilityTsv),
  ],
);

// A flat highlight rectangle in PDF page coordinates (points, unscaled). The
// PDF viewer scales these by the current zoom when drawing the highlight.
export type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// A passage of a file's PDF that a piece of information is "based on". A piece
// of information can have 0..N selections (see issue #64). `pageIndex` plus the
// bounding rect's top-left are stored as plain columns so selections can be
// ordered by their location in the document (page, then top-to-bottom), which
// is how the viewer's previous/next controls step through them. `rects` holds
// the per-line segment rectangles used to draw the highlight.
export const informationSelections = pgTable('information_selections', {
  id: uuid('id').primaryKey().defaultRandom(),
  informationId: uuid('information_id')
    .notNull()
    .references(() => information.id, { onDelete: 'cascade' }),
  pageIndex: integer('page_index').notNull(),
  boundingTop: doublePrecision('bounding_top').notNull(),
  boundingLeft: doublePrecision('bounding_left').notNull(),
  rects: jsonb('rects').$type<SelectionRect[]>().notNull(),
  text: text('text').notNull().default(''),
});

// The whole editable payload for a file — metadata, information rows, and their
// PDF selections — staged as one opaque jsonb snapshot. See issue #78: Save
// writes this draft instead of the main tables, and Submit applies it to the
// real tables in a transaction and deletes the draft. New information rows and
// new selections carry client-generated UUIDs so Submit can insert them with
// stable ids. Mirrors the FileDraftSnapshot type in lib/projects.ts.
export type FileDraftSnapshot = {
  metadata: {
    author: string | null;
    createdDate: number | null; // unix seconds
    overallBias: string | null;
    source: string | null;
    fileReliability: string | null;
    fileCredibility: string | null;
    fileReliabilityCode: string | null; // Admiralty Alpha code A-F (issue #80)
    fileCredibilityCode: string | null; // Admiralty numeric code 1-6 (issue #80)
  };
  information: Array<{
    id: string;
    informationTitle: string;
    informationText: string | null;
    overallBias: string | null;
    informationReliability: string | null;
    informationCredibility: string | null;
    informationReliabilityCode: string | null;
    informationCredibilityCode: string | null;
    selections: Array<{
      id: string;
      pageIndex: number;
      boundingTop: number;
      boundingLeft: number;
      rects: SelectionRect[];
      text: string;
    }>;
  }>;
};

// Per-field edit history for file metadata and information (see field version
// history feature). A row is written by Submit for each field whose value
// actually changed, plus a baseline row for a field's first non-empty value.
// `value` is the new value as text (numbers like created_date stringified;
// null means the field was cleared). `editorName` is the editor's display name
// captured at edit time (denormalised) so a later rename never rewrites old
// history. Rows cascade-delete with their parent file/information row.
export const fileFieldVersions = pgTable(
  'file_field_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    field: text('field').notNull(),
    value: text('value'),
    editorUid: text('editor_uid').notNull(),
    editorName: text('editor_name').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('file_field_versions_lookup_idx').on(t.fileId, t.field, t.createdAt),
  ],
);

export const informationFieldVersions = pgTable(
  'information_field_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    informationId: uuid('information_id')
      .notNull()
      .references(() => information.id, { onDelete: 'cascade' }),
    field: text('field').notNull(),
    value: text('value'),
    editorUid: text('editor_uid').notNull(),
    editorName: text('editor_name').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('information_field_versions_lookup_idx').on(
      t.informationId,
      t.field,
      t.createdAt,
    ),
  ],
);

// ── Timeline feature ───────────────────────────────────────────────────────────

// A datetime attached to a piece of information. Point or range; each endpoint
// carries its own precision (minute|hour|day|month|year|decade|century). The
// lower/upper bounds are derived on write (epoch ms, signed bigint, proleptic
// Gregorian) by lib/datetimePrecision.ts so the timeline can draw with pure
// integer math. There is no label column — the timeline uses the parent
// information's title. Rows cascade-delete with their information.
export const informationDatetimes = pgTable(
  'information_datetimes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    informationId: uuid('information_id')
      .notNull()
      .references(() => information.id, { onDelete: 'cascade' }),
    isRange: boolean('is_range').notNull().default(false),

    // raw input, kept for editing/display
    startValue: text('start_value').notNull(), // ISO-ish canonical string
    startPrecision: text('start_precision').notNull(), // minute|hour|day|month|year|decade|century
    endValue: text('end_value'), // null when !isRange
    endPrecision: text('end_precision'),

    // derived bounds (epoch ms, proleptic Gregorian) — what the timeline draws
    lowerMs: bigint('lower_ms', { mode: 'bigint' }).notNull(), // start.lower
    upperMs: bigint('upper_ms', { mode: 'bigint' }).notNull(), // end.upper (or start.upper for a point)
    coreLowerMs: bigint('core_lower_ms', { mode: 'bigint' }), // mid(start) (range only)
    coreUpperMs: bigint('core_upper_ms', { mode: 'bigint' }), // mid(end)   (range only)
  },
  (t) => [
    index('info_datetimes_info_idx').on(t.informationId),
    index('info_datetimes_bounds_idx').on(t.lowerMs, t.upperMs),
  ],
);

// A named timeline within a project. `defaultStartMs` is the left edge of the
// default view and `defaultSpanMs` its window width (the default zoom); both
// null ⇒ fall back to fit-all when the timeline is opened.
export const timelines = pgTable(
  'timelines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    defaultStartMs: bigint('default_start_ms', { mode: 'bigint' }),
    defaultSpanMs: bigint('default_span_ms', { mode: 'bigint' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [index('timelines_project_idx').on(t.projectId)],
);

// Which information (via a specific datetime) sits on which timeline. Pinning a
// datetime — not just an information — lets an info with several datetimes place
// each one, or the same info on several timelines. Rows cascade-delete with
// either the timeline or the datetime.
export const timelineEntries = pgTable(
  'timeline_entries',
  {
    timelineId: uuid('timeline_id')
      .notNull()
      .references(() => timelines.id, { onDelete: 'cascade' }),
    datetimeId: uuid('datetime_id')
      .notNull()
      .references(() => informationDatetimes.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.timelineId, t.datetimeId] })],
);

// One draft per (file, user). Drafts are write-and-read-by-key only — no
// tsvector / GIN indexes — and cascade-delete with the file.
export const fileDrafts = pgTable(
  'file_drafts',
  {
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(), // Cognito uid (matches files.checked_out_by)
    snapshot: jsonb('snapshot').$type<FileDraftSnapshot>().notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.userId] })],
);
