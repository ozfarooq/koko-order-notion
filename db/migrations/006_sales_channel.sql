-- 006: every order records its sales channel. Our order number (SO-…) is the ID used everywhere;
-- Shopify orders additionally keep Shopify's order number (#1195) and internal order id.

ALTER TABLE orders ADD COLUMN channel TEXT
  CHECK (channel IN ('Studio', 'WhatsApp', 'Instagram', 'Shopify', 'Other'));
ALTER TABLE orders ADD COLUMN shopify_order_id BIGINT UNIQUE;

-- Backfill what we know: orders with a Shopify number came from the website, walk-ins from the studio.
-- Older orders without either stay NULL ("not recorded").
UPDATE orders SET channel = 'Shopify' WHERE shopify_order_number IS NOT NULL;
UPDATE orders SET channel = 'Studio'  WHERE channel IS NULL AND reference = 'Walkin';

-- Shopify identifiers belong to Shopify orders only, and each website order is in the app once
UPDATE orders SET shopify_order_number = '#' || ltrim(trim(shopify_order_number), '#') WHERE shopify_order_number IS NOT NULL;
ALTER TABLE orders ADD CONSTRAINT orders_shopify_fields_chk
  CHECK (channel = 'Shopify' OR (shopify_order_number IS NULL AND shopify_order_id IS NULL));
CREATE UNIQUE INDEX orders_shopify_order_number_key ON orders (shopify_order_number) WHERE shopify_order_number IS NOT NULL;
CREATE INDEX orders_channel_idx ON orders (channel);
