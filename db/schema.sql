-- Koko Atelier — normalized schema (Neon Postgres)
--
--   collections ──< products ──< order_items >── orders >── customers        (retail, PKR)
--                          └───< consignment_items >── consignments >── resellers   (B2B, e.g. Fashion Collage, AED)
--
-- Retail and B2B consignment are deliberately separate: a consignment is stock handed to a
-- reseller in advance at a price we set, paid out later minus the reseller's commission.
--
-- This file is the BASELINE. Later changes live in db/migrations/ and are applied with
-- `node scripts/migrate.js` (production) — never edit this file to change the live database.
--   002: discounts, alteration/laundry, reseller invoice no. & product codes (reseller_products)

-- ── Catalog (mirrors Shopify) ──────────────────────────────────────────
CREATE TABLE collections (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,            -- exact Shopify collection title
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id              SERIAL PRIMARY KEY,
  collection_id   INTEGER REFERENCES collections(id) ON DELETE SET NULL,  -- NULL = sold separately (e.g. bottoms)
  name            TEXT NOT NULL UNIQUE,        -- exact Shopify product title
  shopify_handle  TEXT UNIQUE,
  price_pkr       NUMERIC(12,2),               -- Shopify retail price
  compare_at_pkr  NUMERIC(12,2),
  image_url       TEXT,                        -- Shopify main product image
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Retail ─────────────────────────────────────────────────────────────
CREATE TABLE customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,                            -- default address (latest known)
  city        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customers_phone_idx ON customers (phone);
CREATE INDEX customers_name_idx  ON customers (lower(name));

CREATE SEQUENCE order_number_seq;

CREATE TABLE orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number          TEXT NOT NULL UNIQUE,  -- SO-000123
  shopify_order_number  TEXT,                  -- e.g. #1151 when the order came from the website
  customer_id           UUID NOT NULL REFERENCES customers(id),
  reference             TEXT,                  -- how the sale came in, e.g. Walkin, Outstation, Usman Ahmed
  status                TEXT NOT NULL DEFAULT 'New' CHECK (status IN
                          ('New','In Tailoring','Ready','Payment Pending','Paid',
                           'Out for Delivery','Returned','Cancelled')),
  order_date            DATE,
  delivery_date         DATE,
  amount_pkr            NUMERIC(12,2) NOT NULL DEFAULT 0,
  advance_paid_pkr      NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_due_pkr       NUMERIC(12,2) GENERATED ALWAYS AS (CASE WHEN status IN ('Cancelled','Returned') THEN 0 ELSE amount_pkr - advance_paid_pkr END) STORED,  -- see 005
  delivery_address      TEXT,                  -- where this order shipped (snapshot)
  delivery_city         TEXT,
  measurements          JSONB NOT NULL DEFAULT '{}',
  payment_notes         TEXT,
  special_instructions  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_idx ON orders (customer_id);
CREATE INDEX orders_status_idx   ON orders (status);

CREATE TABLE order_items (
  id              SERIAL PRIMARY KEY,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      INTEGER REFERENCES products(id),   -- NULL only if the product couldn't be identified
  description     TEXT,                              -- original wording, e.g. "[Customized size]"
  size            TEXT,
  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_pkr  NUMERIC(12,2)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

-- ── B2B consignment (resellers such as Fashion Collage Dubai) ──────────
CREATE TABLE resellers (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  address         TEXT,
  city            TEXT,
  country         TEXT,
  currency        CHAR(3) NOT NULL DEFAULT 'AED',
  commission_pct  NUMERIC(5,2) NOT NULL CHECK (commission_pct >= 0 AND commission_pct < 100),  -- current rate
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per handover of stock. The commission rate is copied in at handover so a later
-- rate change never alters what was agreed for stock already sent.
CREATE TABLE consignments (
  id              SERIAL PRIMARY KEY,
  reseller_id     INTEGER NOT NULL REFERENCES resellers(id),
  handover_date   DATE NOT NULL,
  commission_pct  NUMERIC(5,2) NOT NULL CHECK (commission_pct >= 0 AND commission_pct < 100),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per physical piece handed over; each piece moves through its own status.
CREATE TABLE consignment_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_id  INTEGER NOT NULL REFERENCES consignments(id) ON DELETE CASCADE,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  size            TEXT,
  price           NUMERIC(12,2),               -- set by Koko before handover, in the reseller's currency
  status          TEXT NOT NULL DEFAULT 'At Store' CHECK (status IN ('At Store','Sold','Paid','Returned')),
  sold_on         DATE,
  paid_on         DATE,
  returned_on     DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX consignment_items_consignment_idx ON consignment_items (consignment_id);
CREATE INDEX consignment_items_status_idx      ON consignment_items (status);

-- Per-piece money view: what the reseller keeps and what Koko receives.
CREATE VIEW consignment_items_detail AS
SELECT ci.*,
       c.handover_date,
       c.commission_pct,
       r.id        AS reseller_id,
       r.name      AS reseller_name,
       r.currency,
       p.name      AS product_name,
       round(ci.price * c.commission_pct / 100, 2)       AS commission_amount,
       round(ci.price * (1 - c.commission_pct / 100), 2) AS net_to_koko
FROM consignment_items ci
JOIN consignments c ON c.id = ci.consignment_id
JOIN resellers    r ON r.id = c.reseller_id
JOIN products     p ON p.id = ci.product_id;

-- Keep updated_at current on edits
CREATE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER customers_touch         BEFORE UPDATE ON customers         FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER orders_touch            BEFORE UPDATE ON orders            FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER consignment_items_touch BEFORE UPDATE ON consignment_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
