-- 009: PR / gift orders. An outfit sent to an influencer is still stitched and delivered like any order,
-- but nobody pays for it, so it never counts as revenue. Its value (the items' prices) is kept on the
-- order lines to report what PR costs. Studio pieces given away move to a new stock status, Gifted.

ALTER TABLE orders ADD COLUMN order_type TEXT NOT NULL DEFAULT 'Sale' CHECK (order_type IN ('Sale', 'PR'));
ALTER TABLE orders ADD COLUMN pr_handle  TEXT;   -- influencer's handle, e.g. @zainaarshad
ALTER TABLE orders ADD CONSTRAINT orders_pr_free_chk
  CHECK (order_type = 'Sale' OR (amount_pkr = 0 AND advance_paid_pkr = 0));
CREATE INDEX orders_type_idx ON orders (order_type) WHERE order_type <> 'Sale';

ALTER TABLE stock_pieces DROP CONSTRAINT stock_pieces_status_check;
ALTER TABLE stock_pieces ADD CONSTRAINT stock_pieces_status_check CHECK (status IN
  ('In Production', 'At Studio', 'At Shoot', 'With Reseller', 'Sold', 'Gifted', 'Archived', 'Damaged'));
