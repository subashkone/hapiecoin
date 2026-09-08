CREATE TABLE "referral_commissions" (
	"id" text PRIMARY KEY NOT NULL,
	"referrer_id" text NOT NULL,
	"referred_user_id" text NOT NULL,
	"subscription_id" text,
	"plan_name" text NOT NULL,
	"interval" text,
	"amount_inr" text DEFAULT '0' NOT NULL,
	"commission_inr" text DEFAULT '0' NOT NULL,
	"commission_pct" text DEFAULT '0' NOT NULL,
	"status" text NOT NULL,
	"paid_at" timestamp with time zone,
	"note" text,
	"proof_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_commissions" ADD CONSTRAINT "referral_commissions_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referral_commissions_referrer_idx" ON "referral_commissions" USING btree ("referrer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_commissions_subscription_uq" ON "referral_commissions" USING btree ("subscription_id");