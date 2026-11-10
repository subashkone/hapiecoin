CREATE TABLE "playbook_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"playbook_id" text NOT NULL,
	"venue" text DEFAULT 'delta_india' NOT NULL,
	"asset" text NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"first_day" text,
	"last_day" text,
	"days" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"record" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "playbook_records_uq" ON "playbook_records" USING btree ("playbook_id","venue","asset");