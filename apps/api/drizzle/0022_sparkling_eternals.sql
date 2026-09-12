CREATE TABLE "chain_eod" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"venue" text DEFAULT 'delta_india' NOT NULL,
	"asset" text NOT NULL,
	"day" text NOT NULL,
	"expiry" text NOT NULL,
	"strike" text NOT NULL,
	"kind" text NOT NULL,
	"mark" text NOT NULL,
	"mark_iv" text,
	"spot" text NOT NULL,
	"ts" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chain_eod_row_uq" ON "chain_eod" USING btree ("venue","asset","day","expiry","strike","kind");--> statement-breakpoint
CREATE INDEX "chain_eod_asset_day_idx" ON "chain_eod" USING btree ("venue","asset","day");--> statement-breakpoint
CREATE INDEX "chain_eod_ts_idx" ON "chain_eod" USING btree ("ts");