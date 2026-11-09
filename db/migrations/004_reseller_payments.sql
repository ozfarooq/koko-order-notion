-- 004: payments received from resellers, linked to the pieces they settle; reasons for returns

CREATE TABLE reseller_payments (
  id           SERIAL PRIMARY KEY,
  reseller_id  INTEGER NOT NULL REFERENCES resellers(id),
  paid_on      DATE NOT NULL,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),   -- what actually arrived (may differ from the pieces' total)
  currency     CHAR(3) NOT NULL,
  reference    TEXT,                                          -- bank / transfer reference
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reseller_payments_reseller_idx ON reseller_payments (reseller_id, paid_on DESC);

ALTER TABLE consignment_items
  ADD COLUMN payment_id    INTEGER REFERENCES reseller_payments(id) ON DELETE SET NULL,
  ADD COLUMN return_reason TEXT;
CREATE INDEX consignment_items_payment_idx ON consignment_items (payment_id);
