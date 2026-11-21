DROP INDEX "strategies_autopilot_open_uq";--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "autopilot_structure" text;--> statement-breakpoint
CREATE UNIQUE INDEX "strategies_autopilot_open_uq" ON "strategies" USING btree ("user_id","autopilot_playbook_id","venue","asset","autopilot_structure") WHERE "strategies"."status" = 'paper' and "strategies"."autopilot_playbook_id" is not null;