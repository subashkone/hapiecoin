CREATE TABLE "coupons" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"discount_type" text NOT NULL,
	"discount_value" text NOT NULL,
	"min_order_inr" text DEFAULT '0' NOT NULL,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"per_user_limit" integer DEFAULT 1 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"scope" text DEFAULT 'public' NOT NULL,
	"plan_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"intervals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text,
	"plan_name" text NOT NULL,
	"interval" text NOT NULL,
	"list_inr" text NOT NULL,
	"plan_discount_inr" text DEFAULT '0.00' NOT NULL,
	"coupon_id" text,
	"coupon_code" text,
	"coupon_discount_inr" text DEFAULT '0.00' NOT NULL,
	"tax_inr" text DEFAULT '0.00' NOT NULL,
	"amount_inr" text NOT NULL,
	"status" text NOT NULL,
	"method" text,
	"order_id" text,
	"razorpay_payment_id" text,
	"failure_reason" text,
	"invoice_no" text,
	"subscription_id" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_uq" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "payments_user_id_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_id_uq" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_rzp_payment_uq" ON "payments" USING btree ("razorpay_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_invoice_no_uq" ON "payments" USING btree ("invoice_no");