ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "users" CASCADE;--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_checked_out_by_users_uid_fk";
--> statement-breakpoint
CREATE INDEX "files_author_tsv_idx" ON "files" USING gin ("author_tsv");--> statement-breakpoint
CREATE INDEX "files_overall_bias_tsv_idx" ON "files" USING gin ("overall_bias_tsv");--> statement-breakpoint
CREATE INDEX "files_source_tsv_idx" ON "files" USING gin ("source_tsv");--> statement-breakpoint
CREATE INDEX "files_file_reliability_tsv_idx" ON "files" USING gin ("file_reliability_tsv");--> statement-breakpoint
CREATE INDEX "files_file_credibility_tsv_idx" ON "files" USING gin ("file_credibility_tsv");