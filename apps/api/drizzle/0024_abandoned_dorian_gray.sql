CREATE TABLE "chain_eod_backfill" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"venue" text DEFAULT 'delta_india' NOT NULL,
	"asset" text NOT NULL,
	"expiry" text NOT NULL,
	"strikes" integer NOT NULL,
	"rows" integer NOT NULL,
	"requests" integer NOT NULL,
	"done_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chain_eod" ADD COLUMN "source" text DEFAULT 'snapshot' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "chain_eod_backfill_uq" ON "chain_eod_backfill" USING btree ("venue","asset","expiry");