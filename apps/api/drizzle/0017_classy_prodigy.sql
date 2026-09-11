ALTER TABLE "strategy_rules" ADD COLUMN "leg_id" text;--> statement-breakpoint
ALTER TABLE "strategy_rules" ADD COLUMN "scope" text DEFAULT 'strategy' NOT NULL;--> statement-breakpoint
ALTER TABLE "strategy_rules" ADD CONSTRAINT "strategy_rules_leg_id_strategy_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "public"."strategy_legs"("id") ON DELETE cascade ON UPDATE no action;