CREATE TABLE "file_drafts" (
	"file_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "file_drafts_file_id_user_id_pk" PRIMARY KEY("file_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "file_drafts" ADD CONSTRAINT "file_drafts_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;