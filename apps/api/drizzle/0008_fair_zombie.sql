CREATE TABLE "strategy_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"reason" text,
	"added" integer DEFAULT 0 NOT NULL,
	"trimmed" integer DEFAULT 0 NOT NULL,
	"closed" integer DEFAULT 0 NOT NULL,
	"realized_pnl" text DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strategy_adjustments" ADD CONSTRAINT "strategy_adjustments_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strategy_adjustments_strategy_id_idx" ON "strategy_adjustments" USING btree ("strategy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_adjustments_batch_uq" ON "strategy_adjustments" USING btree ("strategy_id","batch_id");