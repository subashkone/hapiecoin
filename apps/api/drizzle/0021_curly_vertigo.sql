CREATE TABLE "trader_pages" (
	"user_id" text PRIMARY KEY NOT NULL,
	"handle" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"show_days" boolean DEFAULT false NOT NULL,
	"show_accounts" boolean DEFAULT false NOT NULL,
	"show_months" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_pages" ADD CONSTRAINT "trader_pages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trader_pages_handle_uq" ON "trader_pages" USING btree ("handle");