CREATE TABLE "information_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"information_id" uuid NOT NULL,
	"page_index" integer NOT NULL,
	"bounding_top" double precision NOT NULL,
	"bounding_left" double precision NOT NULL,
	"rects" jsonb NOT NULL,
	"text" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "information_selections" ADD CONSTRAINT "information_selections_information_id_information_id_fk" FOREIGN KEY ("information_id") REFERENCES "public"."information"("id") ON DELETE cascade ON UPDATE no action;