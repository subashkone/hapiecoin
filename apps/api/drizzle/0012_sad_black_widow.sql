CREATE TABLE "instrument_marks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"asset" text NOT NULL,
	"symbol" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"mark" text NOT NULL,
	"mark_iv" text
);
--> statement-breakpoint
CREATE TABLE "iv_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"asset" text NOT NULL,
	"expiry" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"atm_iv" text NOT NULL,
	"spot" text NOT NULL,
	"atm_strike" text NOT NULL,
	"front" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "instrument_marks_symbol_ts_idx" ON "instrument_marks" USING btree ("symbol","ts");--> statement-breakpoint
CREATE INDEX "instrument_marks_ts_idx" ON "instrument_marks" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "iv_snapshots_asset_ts_idx" ON "iv_snapshots" USING btree ("asset","ts");--> statement-breakpoint
CREATE INDEX "iv_snapshots_front_idx" ON "iv_snapshots" USING btree ("asset","front","ts");