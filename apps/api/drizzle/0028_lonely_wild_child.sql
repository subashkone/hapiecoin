CREATE TABLE "autopilot_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"playbook_id" text NOT NULL,
	"venue" text NOT NULL,
	"asset" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"strategy_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autopilot_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"strategies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "autopilot_playbook_id" text;--> statement-breakpoint
ALTER TABLE "autopilot_runs" ADD CONSTRAINT "autopilot_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_runs" ADD CONSTRAINT "autopilot_runs_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_settings" ADD CONSTRAINT "autopilot_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autopilot_runs_user_at_idx" ON "autopilot_runs" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "autopilot_runs_key_idx" ON "autopilot_runs" USING btree ("user_id","playbook_id","venue","asset","at");--> statement-breakpoint
CREATE INDEX "strategies_autopilot_idx" ON "strategies" USING btree ("user_id","autopilot_playbook_id","venue","asset");--> statement-breakpoint
CREATE UNIQUE INDEX "strategies_autopilot_open_uq" ON "strategies" USING btree ("user_id","autopilot_playbook_id","venue","asset") WHERE "strategies"."status" = 'paper' and "strategies"."autopilot_playbook_id" is not null;