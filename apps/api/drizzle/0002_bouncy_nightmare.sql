CREATE TABLE "strategy_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"leg_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"purpose" text NOT NULL,
	"client_order_id" text NOT NULL,
	"venue_order_id" text,
	"product_id" integer NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"size" integer NOT NULL,
	"state" text NOT NULL,
	"fill_price" text,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trading_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "strategy_orders" ADD CONSTRAINT "strategy_orders_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_orders" ADD CONSTRAINT "strategy_orders_leg_id_strategy_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "public"."strategy_legs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strategy_orders_strategy_id_idx" ON "strategy_orders" USING btree ("strategy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_orders_client_uq" ON "strategy_orders" USING btree ("client_order_id");