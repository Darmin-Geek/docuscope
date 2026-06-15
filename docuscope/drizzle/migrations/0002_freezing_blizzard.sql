CREATE TABLE "file_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
--> statement-breakpoint
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_chunks_content_tsv_idx" ON "file_chunks" USING gin ("content_tsv");--> statement-breakpoint
CREATE INDEX "file_chunks_file_id_idx" ON "file_chunks" USING btree ("file_id");