-- 002: reseller sales statements — discounts, alteration/laundry charges, invoice numbers, reseller codes
--
-- Matches the reseller's statement (e.g. Fashion Collage):
--   net price   = gross price − designer discount − reseller discount
--   commission  = net price × commission %
--   net payable = net price − commission − alteration/laundry

-- The reseller's own code for each of our products (Fashion Collage: KOATLR-010 = Zard Chandni)
CREATE TABLE reseller_products (
  reseller_id    INTEGER NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  reseller_code  TEXT NOT NULL,
  PRIMARY KEY (reseller_id, product_id),
  UNIQUE (reseller_id, reseller_code)
);

ALTER TABLE consignment_items
  ADD COLUMN designer_discount   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (designer_discount >= 0),  -- discount Koko offers
  ADD COLUMN reseller_discount   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (reseller_discount >= 0),  -- discount the reseller offers
  ADD COLUMN alteration_charge   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (alteration_charge >= 0),  -- alteration/laundry deducted after commission
  ADD COLUMN reseller_invoice_no TEXT,                                                              -- e.g. "Order 00843-003-0002"
  ADD CONSTRAINT consignment_items_discounts_within_price
    CHECK (price IS NULL OR designer_discount + reseller_discount <= price);

DROP VIEW consignment_items_detail;
CREATE VIEW consignment_items_detail AS
SELECT ci.*,
       c.handover_date,
       c.commission_pct,
       r.id        AS reseller_id,
       r.name      AS reseller_name,
       r.currency,
       p.name      AS product_name,
       rp.reseller_code,
       n.net_price,
       round(n.net_price * c.commission_pct / 100, 2)                                   AS commission_amount,
       round(n.net_price - n.net_price * c.commission_pct / 100 - ci.alteration_charge, 2) AS net_to_koko
FROM consignment_items ci
JOIN consignments c ON c.id = ci.consignment_id
JOIN resellers    r ON r.id = c.reseller_id
JOIN products     p ON p.id = ci.product_id
LEFT JOIN reseller_products rp ON rp.reseller_id = r.id AND rp.product_id = ci.product_id
CROSS JOIN LATERAL (SELECT ci.price - ci.designer_discount - ci.reseller_discount AS net_price) n;

