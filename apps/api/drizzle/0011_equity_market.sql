ALTER TABLE "assets" ADD COLUMN "sector" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "reference_close" numeric(30, 10);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "reference_close_date" date;