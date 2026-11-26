ALTER TABLE "autopilot_saved_strategies" ADD COLUMN "approval" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "can_approve_live" boolean DEFAULT false NOT NULL;