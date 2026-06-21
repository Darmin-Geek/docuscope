ALTER TABLE "information" ADD COLUMN "title_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(information_title, ''))) STORED;
--> statement-breakpoint
ALTER TABLE "information" ADD COLUMN "text_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(information_text, ''))) STORED;
--> statement-breakpoint
ALTER TABLE "information" ADD COLUMN "overall_bias_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(overall_bias, ''))) STORED;
--> statement-breakpoint
ALTER TABLE "information" ADD COLUMN "reliability_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(information_reliability, ''))) STORED;
--> statement-breakpoint
ALTER TABLE "information" ADD COLUMN "credibility_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(information_credibility, ''))) STORED;
--> statement-breakpoint
CREATE INDEX "information_title_tsv_idx" ON "information" USING gin ("title_tsv");
--> statement-breakpoint
CREATE INDEX "information_text_tsv_idx" ON "information" USING gin ("text_tsv");
--> statement-breakpoint
CREATE INDEX "information_overall_bias_tsv_idx" ON "information" USING gin ("overall_bias_tsv");
--> statement-breakpoint
CREATE INDEX "information_reliability_tsv_idx" ON "information" USING gin ("reliability_tsv");
--> statement-breakpoint
CREATE INDEX "information_credibility_tsv_idx" ON "information" USING gin ("credibility_tsv");
