-- 021: country for the customer's saved address and for each order's delivery address (owner, Nov 2026:
-- City and Country boxes, country chosen from a list). Existing rows stay empty; the order form shows
-- Pakistan for an empty country, so nothing has to be backfilled.
ALTER TABLE customers ADD COLUMN country TEXT;
ALTER TABLE orders ADD COLUMN delivery_country TEXT;
