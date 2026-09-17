ALTER TABLE "positions" DROP CONSTRAINT "positions_quantity_non_negative";--> statement-breakpoint
ALTER TABLE "virtual_orders" ADD COLUMN "request_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_quantity_positive" CHECK ("positions"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_avg_cost_non_negative" CHECK ("positions"."avg_cost" >= 0);--> statement-breakpoint
ALTER TABLE "virtual_orders" ADD CONSTRAINT "virtual_orders_quantity_positive" CHECK ("virtual_orders"."quantity" > 0);