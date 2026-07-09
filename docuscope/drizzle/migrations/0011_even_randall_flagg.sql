CREATE TABLE "information_datetimes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"information_id" uuid NOT NULL,
	"is_range" boolean DEFAULT false NOT NULL,
	"start_value" text NOT NULL,
	"start_precision" text NOT NULL,
	"end_value" text,
	"end_precision" text,
	"lower_ms" bigint NOT NULL,
	"upper_ms" bigint NOT NULL,
	"core_lower_ms" bigint,
	"core_upper_ms" bigint
);
--> statement-breakpoint
CREATE TABLE "timeline_entries" (
	"timeline_id" uuid NOT NULL,
	"datetime_id" uuid NOT NULL,
	CONSTRAINT "timeline_entries_timeline_id_datetime_id_pk" PRIMARY KEY("timeline_id","datetime_id")
);
--> statement-breakpoint
CREATE TABLE "timelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"default_start_ms" bigint,
	"default_span_ms" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "information_datetimes" ADD CONSTRAINT "information_datetimes_information_id_information_id_fk" FOREIGN KEY ("information_id") REFERENCES "public"."information"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_entries" ADD CONSTRAINT "timeline_entries_timeline_id_timelines_id_fk" FOREIGN KEY ("timeline_id") REFERENCES "public"."timelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_entries" ADD CONSTRAINT "timeline_entries_datetime_id_information_datetimes_id_fk" FOREIGN KEY ("datetime_id") REFERENCES "public"."information_datetimes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timelines" ADD CONSTRAINT "timelines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "info_datetimes_info_idx" ON "information_datetimes" USING btree ("information_id");--> statement-breakpoint
CREATE INDEX "info_datetimes_bounds_idx" ON "information_datetimes" USING btree ("lower_ms","upper_ms");--> statement-breakpoint
CREATE INDEX "timelines_project_idx" ON "timelines" USING btree ("project_id");