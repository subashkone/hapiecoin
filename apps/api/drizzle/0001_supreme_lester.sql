CREATE TABLE "strategies" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"asset" text NOT NULL,
	"status" text NOT NULL,
	"trading_mode" text,
	"template_name" text DEFAULT 'Custom' NOT NULL,
	"broker_id" text,
	"realized_pnl" text DEFAULT '0' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"order_batch_id" text,
	"started_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_legs" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"kind" text NOT NULL,
	"side" text NOT NULL,
	"strike" text DEFAULT '' NOT NULL,
	"expiry" text NOT NULL,
	"symbol" text NOT NULL,
	"lots" integer NOT NULL,
	"price" text NOT NULL,
	"entry_price" text,
	"exit_price" text,
	"iv" text,
	"status" text DEFAULT 'open' NOT NULL,
	"is_adjustment" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_pnl" (
	"strategy_id" text NOT NULL,
	"day" text NOT NULL,
	"pnl" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_broker_id_brokers_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."brokers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_legs" ADD CONSTRAINT "strategy_legs_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_pnl" ADD CONSTRAINT "strategy_pnl_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strategies_user_id_idx" ON "strategies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "strategies_user_status_idx" ON "strategies" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "strategy_legs_strategy_id_idx" ON "strategy_legs" USING btree ("strategy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_pnl_strategy_day_uq" ON "strategy_pnl" USING btree ("strategy_id","day");