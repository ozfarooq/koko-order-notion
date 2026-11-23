-- 022: finance F5b: actual cost. Koko books fabric, wages and outsourced work to cost of sales when they
-- are paid (5100 / 5200 / 5300 / 5410). Stock is therefore valued at each month end (periodic method,
-- IAS 2): fabric left in the lots, orders being stitched (WIP), finished pieces at the studio and pieces
-- at resellers, each from its cost card, and one entry moves the stock accounts to that value against
-- 5050 Change in inventories. Cost of sales = what was spent − the increase in stock.
INSERT INTO fin_accounts (code, name, type, system_key, fs_line, cash_flow_class, description)
VALUES ('5050', 'Change in inventories (opening less closing)', 'cogs', 'inv_change', 'Cost of sales', 'operating',
        'Month-end stock valuation: the stock accounts are moved to the counted / costed value against this account');

-- One valuation per month (the latest run is posted; re-running replaces it)
CREATE TABLE fin_stock_valuations (
  id          SERIAL PRIMARY KEY,
  month       TEXT NOT NULL UNIQUE CHECK (month ~ '^\d{4}-\d{2}$'),
  as_of       DATE NOT NULL,
  totals      JSONB NOT NULL,                          -- value per stock account
  missing     JSONB NOT NULL DEFAULT '[]',             -- designs counted without a cost card
  pieces      INTEGER NOT NULL DEFAULT 0,
  entry_id    BIGINT REFERENCES fin_entries(id),
  created_by  INTEGER REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A fabric purchase can carry its payment (the expense it was booked as)
ALTER TABLE fin_fabric_moves ADD COLUMN expense_id INTEGER REFERENCES fin_expenses(id);
