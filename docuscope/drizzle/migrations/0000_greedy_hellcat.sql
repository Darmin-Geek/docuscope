CREATE TABLE "file_folders" (
	"file_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL,
	CONSTRAINT "file_folders_file_id_folder_id_pk" PRIMARY KEY("file_id","folder_id")
);
--> statement-breakpoint
CREATE TABLE "file_labels" (
	"file_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "file_labels_file_id_label_id_pk" PRIMARY KEY("file_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"author" text,
	"created_date" bigint,
	"storage_reference" text DEFAULT '' NOT NULL,
	"overall_bias" text,
	"source" text,
	"file_reliability" text,
	"file_credibility" text,
	"checked_out_by" text,
	"author_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(author, ''))) STORED,
	"overall_bias_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(overall_bias, ''))) STORED,
	"source_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(source, ''))) STORED,
	"file_reliability_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(file_reliability, ''))) STORED,
	"file_credibility_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(file_credibility, ''))) STORED
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"folder_name" text NOT NULL,
	"parent_id" uuid
);
--> statement-breakpoint
CREATE TABLE "information" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"information_title" text DEFAULT '' NOT NULL,
	"information_text" text,
	"overall_bias" text,
	"information_reliability" text,
	"information_credibility" text
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text NOT NULL,
	"color" char(7) DEFAULT '#9ca3af' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_contributors" (
	"project_id" uuid NOT NULL,
	"email" text NOT NULL,
	CONSTRAINT "project_contributors_project_id_email_pk" PRIMARY KEY("project_id","email")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"uid" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"email" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_labels" ADD CONSTRAINT "file_labels_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_labels" ADD CONSTRAINT "file_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_checked_out_by_users_uid_fk" FOREIGN KEY ("checked_out_by") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information" ADD CONSTRAINT "information_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contributors" ADD CONSTRAINT "project_contributors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_author_tsv_idx" ON "files" USING GIN ("author_tsv");--> statement-breakpoint
CREATE INDEX "files_overall_bias_tsv_idx" ON "files" USING GIN ("overall_bias_tsv");--> statement-breakpoint
CREATE INDEX "files_source_tsv_idx" ON "files" USING GIN ("source_tsv");--> statement-breakpoint
CREATE INDEX "files_file_reliability_tsv_idx" ON "files" USING GIN ("file_reliability_tsv");--> statement-breakpoint
CREATE INDEX "files_file_credibility_tsv_idx" ON "files" USING GIN ("file_credibility_tsv");