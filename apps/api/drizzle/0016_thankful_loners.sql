DROP INDEX "instrument_marks_symbol_ts_idx";--> statement-breakpoint
DROP INDEX "iv_snapshots_asset_ts_idx";--> statement-breakpoint
DROP INDEX "iv_snapshots_front_idx";--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "venue" text DEFAULT 'delta_india' NOT NULL;--> statement-breakpoint
ALTER TABLE "brokers" ADD COLUMN "venue" text DEFAULT 'delta_india' NOT NULL;--> statement-breakpoint
ALTER TABLE "instrument_marks" ADD COLUMN "venue" text DEFAULT 'delta_india' NOT NULL;--> statement-breakpoint
ALTER TABLE "iv_snapshots" ADD COLUMN "venue" text DEFAULT 'delta_india' NOT NULL;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "venue" text DEFAULT 'delta_india' NOT NULL;--> statement-breakpoint
CREATE INDEX "instrument_marks_symbol_ts_idx" ON "instrument_marks" USING btree ("venue","symbol","ts");--> statement-breakpoint
CREATE INDEX "iv_snapshots_asset_ts_idx" ON "iv_snapshots" USING btree ("venue","asset","ts");--> statement-breakpoint
CREATE INDEX "iv_snapshots_front_idx" ON "iv_snapshots" USING btree ("venue","asset","front","ts");