CREATE TABLE "file_field_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" text,
	"editor_uid" text NOT NULL,
	"editor_name" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "information_field_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"information_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" text,
	"editor_uid" text NOT NULL,
	"editor_name" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_field_versions" ADD CONSTRAINT "file_field_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_field_versions" ADD CONSTRAINT "information_field_versions_information_id_information_id_fk" FOREIGN KEY ("information_id") REFERENCES "public"."information"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_field_versions_lookup_idx" ON "file_field_versions" USING btree ("file_id","field","created_at");--> statement-breakpoint
CREATE INDEX "information_field_versions_lookup_idx" ON "information_field_versions" USING btree ("information_id","field","created_at");