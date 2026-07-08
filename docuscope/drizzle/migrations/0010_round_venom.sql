ALTER TABLE "files" drop column "overall_bias_tsv";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "overall_bias_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', regexp_replace(coalesce(overall_bias, ''), '<[^>]+>', ' ', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "files" drop column "source_tsv";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "source_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', regexp_replace(coalesce(source, ''), '<[^>]+>', ' ', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "files" drop column "file_reliability_tsv";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "file_reliability_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', regexp_replace(coalesce(file_reliability, ''), '<[^>]+>', ' ', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "files" drop column "file_credibility_tsv";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "file_credibility_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', regexp_replace(coalesce(file_credibility, ''), '<[^>]+>', ' ', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "information" drop column "text_tsv";--> statement-breakpoint
ALTER TABLE "information" ADD COLUMN "text_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', regexp_replace(coalesce(information_text, ''), '<[^>]+>', ' ', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "information" drop column "overall_bias_tsv";--> statement-breakpoint
ALTER TABLE "information" ADD COLUMN "overall_bias_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', regexp_replace(coalesce(overall_bias, ''), '<[^>]+>', ' ', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "information" drop column "reliability_tsv";--> statement-breakpoint
ALTER TABLE "information" ADD COLUMN "reliability_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', regexp_replace(coalesce(information_reliability, ''), '<[^>]+>', ' ', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "information" drop column "credibility_tsv";--> statement-breakpoint
ALTER TABLE "information" ADD COLUMN "credibility_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', regexp_replace(coalesce(information_credibility, ''), '<[^>]+>', ' ', 'g'))) STORED;--> statement-breakpoint
-- Recreate the GIN indexes dropped alongside their regenerated tsvector columns
-- (DROP COLUMN drops the index too; drizzle-kit does not re-emit them because the
-- index definitions are unchanged in the schema).
CREATE INDEX "files_overall_bias_tsv_idx" ON "files" USING gin ("overall_bias_tsv");--> statement-breakpoint
CREATE INDEX "files_source_tsv_idx" ON "files" USING gin ("source_tsv");--> statement-breakpoint
CREATE INDEX "files_file_reliability_tsv_idx" ON "files" USING gin ("file_reliability_tsv");--> statement-breakpoint
CREATE INDEX "files_file_credibility_tsv_idx" ON "files" USING gin ("file_credibility_tsv");--> statement-breakpoint
CREATE INDEX "information_text_tsv_idx" ON "information" USING gin ("text_tsv");--> statement-breakpoint
CREATE INDEX "information_overall_bias_tsv_idx" ON "information" USING gin ("overall_bias_tsv");--> statement-breakpoint
CREATE INDEX "information_reliability_tsv_idx" ON "information" USING gin ("reliability_tsv");--> statement-breakpoint
CREATE INDEX "information_credibility_tsv_idx" ON "information" USING gin ("credibility_tsv");