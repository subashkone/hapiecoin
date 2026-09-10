ALTER TABLE "users" ADD COLUMN "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_link_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_linked_at" timestamp with time zone;