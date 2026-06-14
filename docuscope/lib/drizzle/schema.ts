import {
  pgTable,
  text,
  uuid,
  bigint,
  char,
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
