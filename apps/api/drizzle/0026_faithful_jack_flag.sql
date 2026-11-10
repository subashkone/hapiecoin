CREATE TABLE "playbook_proposal_marks" (
	"user_id" text NOT NULL,
	"proposal_id" bigserial NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"telegram_sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbook_proposals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"playbook_id" text NOT NULL,
	"venue" text DEFAULT 'delta_india' NOT NULL,
	"asset" text NOT NULL,
	"day" text NOT NULL,
	"expiry" text NOT NULL,
	"spot" text NOT NULL,
	"legs" jsonb NOT NULL,
	"entry_cost" text NOT NULL,
	"max_profit" text,
	"max_loss" text,
	"record_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "proposals_telegram" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "playbook_proposal_marks" ADD CONSTRAINT "playbook_proposal_marks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_proposal_marks" ADD CONSTRAINT "playbook_proposal_marks_proposal_id_playbook_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."playbook_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "playbook_proposal_marks_uq" ON "playbook_proposal_marks" USING btree ("user_id","proposal_id");--> statement-breakpoint
CREATE INDEX "playbook_proposal_marks_sent_idx" ON "playbook_proposal_marks" USING btree ("user_id","telegram_sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "playbook_proposals_uq" ON "playbook_proposals" USING btree ("playbook_id","venue","asset","day");--> statement-breakpoint
CREATE INDEX "playbook_proposals_day_idx" ON "playbook_proposals" USING btree ("venue","day");