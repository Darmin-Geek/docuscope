CREATE TABLE "ocr_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"started_at" bigint,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ocr_jobs" ADD CONSTRAINT "ocr_jobs_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_jobs_one_active_per_file" ON "ocr_jobs" USING btree ("file_id") WHERE status in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "ocr_jobs_file_id_idx" ON "ocr_jobs" USING btree ("file_id");
