CREATE TABLE "autopilot_saved_strategies" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"definition" jsonb NOT NULL,
	"stage" text DEFAULT 'draft' NOT NULL,
	"audience" text DEFAULT 'admins' NOT NULL,
	"user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plan_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"backtest" jsonb,
	"backtest_at" timestamp with time zone,
	"created_by" text,
	"published_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "autopilot_saved_strategies" ADD CONSTRAINT "autopilot_saved_strategies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autopilot_saved_family_version_uq" ON "autopilot_saved_strategies" USING btree ("family_id","version");--> statement-breakpoint
CREATE INDEX "autopilot_saved_stage_idx" ON "autopilot_saved_strategies" USING btree ("stage");