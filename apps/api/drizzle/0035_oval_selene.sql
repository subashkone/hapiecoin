CREATE TABLE "autopilot_saved_backtests" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"definition" jsonb NOT NULL,
	"progress" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"error" text,
	"created_by" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mark_candles" (
	"venue" text NOT NULL,
	"symbol" text NOT NULL,
	"resolution" text NOT NULL,
	"from_ms" bigint NOT NULL,
	"to_ms" bigint NOT NULL,
	"bars" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mark_candles_pk" PRIMARY KEY("venue","symbol","resolution")
);
--> statement-breakpoint
ALTER TABLE "autopilot_saved_backtests" ADD CONSTRAINT "autopilot_saved_backtests_strategy_id_autopilot_saved_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."autopilot_saved_strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_saved_backtests" ADD CONSTRAINT "autopilot_saved_backtests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autopilot_saved_backtests_strategy_id_idx" ON "autopilot_saved_backtests" USING btree ("strategy_id","created_at");