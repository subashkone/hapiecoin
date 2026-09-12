DROP INDEX "broker_credentials_user_broker_uq";--> statement-breakpoint
ALTER TABLE "broker_credentials" ADD COLUMN "label" text DEFAULT 'Main' NOT NULL;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_account_id_broker_credentials_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."broker_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "broker_credentials_user_broker_label_uq" ON "broker_credentials" USING btree ("user_id","broker_id","label");