DROP INDEX "autopilot_saved_family_version_uq";--> statement-breakpoint
DROP INDEX "autopilot_saved_stage_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "autopilot_saved_strategies_family_version_uq" ON "autopilot_saved_strategies" USING btree ("family_id","version");--> statement-breakpoint
CREATE INDEX "autopilot_saved_strategies_stage_idx" ON "autopilot_saved_strategies" USING btree ("stage");