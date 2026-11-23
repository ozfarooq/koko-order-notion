-- 020: finance F5a: costing and pricing (spec 7.4). Owner (23 Nov 2026): after the shoot Usman's cost
-- sheet gives the actual cost of each outfit; margins are added on top to reach the retail price.
-- * Pricing policy per collection (or the default): marketing / packaging allowance per piece, profit %
--   on cost, courier % of price, method (Koko ×(1+profit+courier), or gross-up), rounding.
-- * Fabric lots per collection (named as on the cost sheet: Brown, Zinc …) with yards bought and the rate;
--   yards used are worked out from cost cards × outfits made and ordered, so leftover is always current.
-- * Cost cards (bill of materials) per design, versioned: fabric, stitching, extras, outsourced lines.
-- * Price history: the cost behind a price, the computed price and the owner-confirmed final price.
-- Cost of sales is not posted from cost cards yet (purchases and wages already reach cost of sales when
-- paid); profit by design / collection / order is a management view at standard cost until F5b.

CREATE TABLE fin_pricing_policies (
  id             SERIAL PRIMARY KEY,
  collection_id  INTEGER UNIQUE REFERENCES collections(id),       -- NULL = the default for every collection
  allowance      NUMERIC(14,2) NOT NULL DEFAULT 3000 CHECK (allowance >= 0),   -- marketing / packaging per piece
  profit_pct     NUMERIC(6,2) NOT NULL DEFAULT 20 CHECK (profit_pct >= 0 AND profit_pct < 500),
  courier_pct    NUMERIC(6,2) NOT NULL DEFAULT 2 CHECK (courier_pct >= 0 AND courier_pct < 50),
  method         TEXT NOT NULL DEFAULT 'koko' CHECK (method IN ('koko', 'grossup')),
  round_to       INTEGER NOT NULL DEFAULT 500 CHECK (round_to BETWEEN 1 AND 10000),
  size_factors   JSONB NOT NULL DEFAULT '{"X-Small": 0.9, "Small": 0.95, "Medium": 1, "Large": 1.05, "X-Large": 1.15}',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fin_pricing_default ON fin_pricing_policies ((collection_id IS NULL)) WHERE collection_id IS NULL;

CREATE TABLE fin_fabric_lots (
  id             SERIAL PRIMARY KEY,
  collection_id  INTEGER REFERENCES collections(id),
  name           TEXT NOT NULL,                                     -- as the cost sheet names it: Brown, Ivory velvet
  unit           TEXT NOT NULL DEFAULT 'yard' CHECK (unit IN ('yard', 'metre', 'piece')),
  rate           NUMERIC(14,2) NOT NULL CHECK (rate >= 0),         -- per unit; average after more purchases
  supplier_id    INTEGER REFERENCES fin_suppliers(id),
  notes          TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collection_id, name)
);
-- Purchases and counts (yards used by outfits are worked out, not stored)
CREATE TABLE fin_fabric_moves (
  id         SERIAL PRIMARY KEY,
  lot_id     INTEGER NOT NULL REFERENCES fin_fabric_lots(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('purchase', 'adjust')),
  moved_on   DATE NOT NULL,
  quantity   NUMERIC(10,2) NOT NULL CHECK (quantity <> 0),          -- + bought / found, − lost or written off
  rate       NUMERIC(14,2),                                         -- purchases: price per unit
  note       TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind <> 'purchase' OR (quantity > 0 AND rate IS NOT NULL))
);

CREATE TABLE fin_cost_cards (
  id              SERIAL PRIMARY KEY,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  version         INTEGER NOT NULL,
  effective_from  DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Active', 'Superseded')),
  source          TEXT,                                            -- e.g. "Shoot cost sheet (Usman)"
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  UNIQUE (product_id, version)
);
CREATE UNIQUE INDEX fin_cost_cards_active ON fin_cost_cards (product_id) WHERE status = 'Active';

CREATE TABLE fin_cost_card_lines (
  id           SERIAL PRIMARY KEY,
  card_id      INTEGER NOT NULL REFERENCES fin_cost_cards(id) ON DELETE CASCADE,
  line_no      INTEGER NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('fabric', 'stitching', 'extra', 'outsourced', 'consumables', 'overhead')),
  description  TEXT NOT NULL,
  lot_id       INTEGER REFERENCES fin_fabric_lots(id),             -- fabric drawn from a lot
  quantity     NUMERIC(10,2),                                      -- yards per piece (fabric) or count
  rate         NUMERIC(14,2),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount >= 0),         -- quantity × rate, or a fixed cost
  UNIQUE (card_id, line_no)
);

CREATE TABLE fin_price_history (
  id               SERIAL PRIMARY KEY,
  product_id       INTEGER NOT NULL REFERENCES products(id),
  card_id          INTEGER REFERENCES fin_cost_cards(id),
  production_cost  NUMERIC(14,2) NOT NULL,
  allowance        NUMERIC(14,2) NOT NULL,
  unit_cost        NUMERIC(14,2) NOT NULL,
  method           TEXT NOT NULL,
  profit_pct       NUMERIC(6,2) NOT NULL,
  courier_pct      NUMERIC(6,2) NOT NULL,
  computed_price   NUMERIC(14,2) NOT NULL,
  final_price      NUMERIC(14,2) NOT NULL CHECK (final_price > 0),
  note             TEXT,
  approved_by      INTEGER REFERENCES users(id),
  approved_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fin_price_history_product_idx ON fin_price_history (product_id, approved_at DESC);

-- ── Seed: the default policy, and VÉLORA (KO26-WC1) from the shoot cost sheet (spec 7.4) ──
INSERT INTO fin_pricing_policies (collection_id) VALUES (NULL);
INSERT INTO fin_pricing_policies (collection_id, allowance, profit_pct, courier_pct)
SELECT id, 3000, 20, 2 FROM collections WHERE name = 'VÉLORA';

INSERT INTO fin_fabric_lots (collection_id, name, rate, notes)
SELECT c.id, v.name, v.rate, 'From the VÉLORA shoot cost sheet; enter the yards bought'
FROM collections c, (VALUES ('Brown', 450), ('Zinc', 750), ('Red', 780), ('Black velvet', 450), ('Blue velvet', 450), ('Ivory velvet', 450)) v(name, rate)
WHERE c.name = 'VÉLORA';

INSERT INTO fin_cost_cards (product_id, version, effective_from, status, source, approved_at)
SELECT p.id, 1, '2026-11-01', 'Active', 'VÉLORA shoot cost sheet (KO26-WC1)', now()
FROM products p JOIN collections c ON c.id = p.collection_id
WHERE c.name = 'VÉLORA' AND p.name IN ('MOKA', 'ONDINE', 'VELOURS', 'OPHÉRA', 'MINUIT', 'DUNE');

INSERT INTO fin_cost_card_lines (card_id, line_no, kind, description, lot_id, quantity, rate, amount)
SELECT cc.id, v.line_no, v.kind, v.description, l.id, v.qty, v.rate, v.amount
FROM (VALUES
  ('MOKA', 1, 'fabric', 'Fabric (Brown)', 'Brown', 5.0, 450, 2250),
  ('MOKA', 2, 'stitching', 'Stitching', NULL, NULL, NULL, 3000),
  ('ONDINE', 1, 'fabric', 'Fabric (Zinc)', 'Zinc', 8.0, 750, 6000),
  ('ONDINE', 2, 'stitching', 'Stitching', NULL, NULL, NULL, 4000),
  ('VELOURS', 1, 'fabric', 'Fabric (Red)', 'Red', 5.0, 780, 3900),
  ('VELOURS', 2, 'stitching', 'Stitching', NULL, NULL, NULL, 2000),
  ('VELOURS', 3, 'extra', 'Lace', NULL, NULL, NULL, 400),
  ('VELOURS', 4, 'outsourced', 'Dye', NULL, NULL, NULL, 500),
  ('OPHÉRA', 1, 'fabric', 'Fabric (Black velvet)', 'Black velvet', 4.0, 450, 1800),
  ('OPHÉRA', 2, 'extra', 'Scarf fabric', NULL, NULL, NULL, 750),
  ('OPHÉRA', 3, 'stitching', 'Stitching', NULL, NULL, NULL, 3000),
  ('OPHÉRA', 4, 'extra', 'Tassels', NULL, NULL, NULL, 1120),
  ('OPHÉRA', 5, 'extra', 'Buttons', NULL, NULL, NULL, 1120),
  ('MINUIT', 1, 'fabric', 'Fabric (Blue velvet)', 'Blue velvet', 5.5, 450, 2475),
  ('MINUIT', 2, 'stitching', 'Stitching', NULL, NULL, NULL, 3500),
  ('DUNE', 1, 'fabric', 'Fabric (Ivory velvet)', 'Ivory velvet', 8.0, 450, 3600),
  ('DUNE', 2, 'stitching', 'Stitching', NULL, NULL, NULL, 3000),
  ('DUNE', 3, 'extra', 'Lace', NULL, NULL, NULL, 400),
  ('DUNE', 4, 'outsourced', 'Dye', NULL, NULL, NULL, 500)
) v(product, line_no, kind, description, lot, qty, rate, amount)
JOIN products p ON p.name = v.product
JOIN collections c ON c.id = p.collection_id AND c.name = 'VÉLORA'
JOIN fin_cost_cards cc ON cc.product_id = p.id AND cc.version = 1
LEFT JOIN fin_fabric_lots l ON l.collection_id = c.id AND l.name = v.lot;

-- The final prices confirmed for VÉLORA (spec 7.4.4), at unit cost = production cost + 3,000 allowance
INSERT INTO fin_price_history (product_id, card_id, production_cost, allowance, unit_cost, method, profit_pct, courier_pct, computed_price, final_price, note)
SELECT cc.product_id, cc.id, t.cost, 3000, t.cost + 3000, 'koko', 20, 2, round((t.cost + 3000) * 1.22), v.final, 'VÉLORA launch price (shoot cost sheet)'
FROM fin_cost_cards cc
JOIN products p ON p.id = cc.product_id
JOIN (SELECT card_id, sum(amount) AS cost FROM fin_cost_card_lines GROUP BY card_id) t ON t.card_id = cc.id
JOIN (VALUES ('MOKA', 10500), ('ONDINE', 16000), ('VELOURS', 12000), ('OPHÉRA', 14500), ('MINUIT', 12000), ('DUNE', 13500)) v(name, final) ON v.name = p.name
WHERE cc.version = 1;
