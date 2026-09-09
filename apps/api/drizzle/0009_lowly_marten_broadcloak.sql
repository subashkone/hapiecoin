ALTER TABLE "strategy_orders" ADD COLUMN "order_type" text DEFAULT 'market' NOT NULL;--> statement-breakpoint
ALTER TABLE "strategy_orders" ADD COLUMN "limit_price" text;