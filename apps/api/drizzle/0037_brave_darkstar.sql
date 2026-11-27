CREATE TABLE "autopilot_mandates" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"strategy_id" text NOT NULL,
	"account_id" text,
	"lots" integer NOT NULL,
	"max_capital_usd" integer NOT NULL,
	"day_loss_limit_usd" integer NOT NULL,
	"week_loss_limit_usd" integer NOT NULL,
	"max_open" integer NOT NULL,
	"statements" jsonb NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"paused_at" timestamp with time zone,
	"pause_reason" text,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "autopilot_mandates" ADD CONSTRAINT "autopilot_mandates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_mandates" ADD CONSTRAINT "autopilot_mandates_strategy_id_autopilot_saved_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."autopilot_saved_strategies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_mandates" ADD CONSTRAINT "autopilot_mandates_account_id_broker_credentials_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."broker_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autopilot_mandates_user_strategy_live_uq" ON "autopilot_mandates" USING btree ("user_id","strategy_id") WHERE "autopilot_mandates"."state" <> 'ended';--> statement-breakpoint
CREATE INDEX "autopilot_mandates_strategy_idx" ON "autopilot_mandates" USING btree ("strategy_id");