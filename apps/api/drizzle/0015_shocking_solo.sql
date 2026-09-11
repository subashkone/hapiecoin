CREATE TABLE "strategy_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"kind" text NOT NULL,
	"trigger" text NOT NULL,
	"value" text NOT NULL,
	"basis" text,
	"basis_usd" text,
	"threshold_usd" text NOT NULL,
	"channels" jsonb DEFAULT '["push"]'::jsonb NOT NULL,
	"state" text DEFAULT 'armed' NOT NULL,
	"fired_at" timestamp with time zone,
	"fired_pnl" text,
	"outcome" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strategy_rules" ADD CONSTRAINT "strategy_rules_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strategy_rules_strategy_id_idx" ON "strategy_rules" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "strategy_rules_state_idx" ON "strategy_rules" USING btree ("state");