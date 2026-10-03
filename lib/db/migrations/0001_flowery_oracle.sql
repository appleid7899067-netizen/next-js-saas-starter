ALTER TABLE "users" ADD COLUMN "puter_uuid" varchar(128);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "puter_username" varchar(128);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_puter_uuid_unique" UNIQUE("puter_uuid");