CREATE TABLE "information_labels" (
	"information_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "information_labels_information_id_label_id_pk" PRIMARY KEY("information_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "labels" ADD COLUMN "kind" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "information_labels" ADD CONSTRAINT "information_labels_information_id_information_id_fk" FOREIGN KEY ("information_id") REFERENCES "public"."information"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_labels" ADD CONSTRAINT "information_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill the default information labels (issue #75) into every existing
-- project so the new information-labelling feature is usable on old projects.
-- Existing file labels are left untouched. New projects get these defaults at
-- creation time (see DEFAULT_INFORMATION_LABELS in lib/projects.server.ts).
INSERT INTO "labels" ("project_id", "label", "color", "kind")
SELECT p."id", v."label", v."color", 'information'
FROM "projects" p
CROSS JOIN (VALUES
  ('Fact', '#22c55e'),
  ('Opinion', '#3b82f6'),
  ('Misinformation', '#f59e0b'),
  ('Disinformation', '#ef4444')
) AS v("label", "color");