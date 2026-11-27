DROP INDEX "strategies_autopilot_open_uq";--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "autopilot_mandate_id" text;--> statement-breakpoint
CREATE INDEX "strategies_autopilot_mandate_idx" ON "strategies" USING btree ("autopilot_mandate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategies_autopilot_open_uq" ON "strategies" USING btree ("user_id","autopilot_playbook_id","venue","asset","autopilot_structure") WHERE "strategies"."status" in ('paper', 'live') and "strategies"."autopilot_playbook_id" is not null;