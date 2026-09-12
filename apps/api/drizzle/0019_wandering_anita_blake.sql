CREATE TABLE "fill_watermarks" (
	"account_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL,
	"last_fill_at" timestamp with time zone,
	"fills" integer DEFAULT 0 NOT NULL,
	"resume_after" text,
	"partial_products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_fills" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"venue_fill_id" text NOT NULL,
	"order_id" text,
	"product_id" integer NOT NULL,
	"symbol" text,
	"side" text NOT NULL,
	"size" integer NOT NULL,
	"price" text NOT NULL,
	"commission" text DEFAULT '0' NOT NULL,
	"role" text,
	"contract_value" text,
	"filled_at" timestamp with time zone NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fill_watermarks" ADD CONSTRAINT "fill_watermarks_account_id_broker_credentials_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."broker_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fill_watermarks" ADD CONSTRAINT "fill_watermarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_fills" ADD CONSTRAINT "venue_fills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_fills" ADD CONSTRAINT "venue_fills_account_id_broker_credentials_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."broker_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "venue_fills_account_fill_uq" ON "venue_fills" USING btree ("account_id","venue_fill_id");--> statement-breakpoint
CREATE INDEX "venue_fills_user_filled_idx" ON "venue_fills" USING btree ("user_id","filled_at");