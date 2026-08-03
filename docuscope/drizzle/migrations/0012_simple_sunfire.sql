DROP INDEX "files_author_tsv_idx";--> statement-breakpoint
DROP INDEX "files_overall_bias_tsv_idx";--> statement-breakpoint
DROP INDEX "files_source_tsv_idx";--> statement-breakpoint
DROP INDEX "files_file_reliability_tsv_idx";--> statement-breakpoint
DROP INDEX "files_file_credibility_tsv_idx";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "deleted_on" bigint;--> statement-breakpoint
CREATE INDEX "files_project_not_deleted_idx" ON "files" USING btree ("project_id") WHERE deleted_on IS NULL;--> statement-breakpoint
CREATE INDEX "files_author_tsv_idx" ON "files" USING gin ("author_tsv") WHERE deleted_on IS NULL;--> statement-breakpoint
CREATE INDEX "files_overall_bias_tsv_idx" ON "files" USING gin ("overall_bias_tsv") WHERE deleted_on IS NULL;--> statement-breakpoint
CREATE INDEX "files_source_tsv_idx" ON "files" USING gin ("source_tsv") WHERE deleted_on IS NULL;--> statement-breakpoint
CREATE INDEX "files_file_reliability_tsv_idx" ON "files" USING gin ("file_reliability_tsv") WHERE deleted_on IS NULL;--> statement-breakpoint
CREATE INDEX "files_file_credibility_tsv_idx" ON "files" USING gin ("file_credibility_tsv") WHERE deleted_on IS NULL;