import {
  pgTable,
  text,
  uuid,
  bigint,
  integer,
  char,
  doublePrecision,
  jsonb,
  primaryKey,
  customType,
  index,
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

export const labels = pgTable('labels', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  color: char('color', { length: 7 }).notNull().default('#9ca3af'),
  type: text('type').notNull().default('file'),
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
  checkedOutBy: text('checked_out_by'),

  // Generated stored tsvector columns — one per searchable metadata field.
  authorTsv: tsvector('author_tsv').generatedAlwaysAs(
    sql`to_tsvector('english', coalesce(author, ''))`,
  ),
  overallBiasTsv: tsvector('overall_bias_tsv').generatedAlwaysAs(
    sql`to_tsvector('english', coalesce(overall_bias, ''))`,
  ),
  sourceTsv: tsvector('source_tsv').generatedAlwaysAs(
    sql`to_tsvector('english', coalesce(source, ''))`,
  ),
  fileReliabilityTsv: tsvector('file_reliability_tsv').generatedAlwaysAs(
    sql`to_tsvector('english', coalesce(file_reliability, ''))`,
  ),
  fileCredibilityTsv: tsvector('file_credibility_tsv').generatedAlwaysAs(
    sql`to_tsvector('english', coalesce(file_credibility, ''))`,
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

export const information = pgTable('information', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  informationTitle: text('information_title').notNull().default(''),
  informationText: text('information_text'),
  overallBias: text('overall_bias'),
  informationReliability: text('information_reliability'),
  informationCredibility: text('information_credibility'),
});

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
