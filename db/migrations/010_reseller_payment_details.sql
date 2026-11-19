-- 010: reseller payments record which month's sales they settle, what actually reached the
-- Pakistan bank in PKR, why the amount differs from the statement (if it does), and the proof:
-- the reseller's statement and the payment email, stored with the payment.

ALTER TABLE reseller_payments ADD COLUMN period DATE;               -- first day of the statement month, e.g. 2026-09-01
ALTER TABLE reseller_payments ADD COLUMN amount_pkr NUMERIC(14,2) CHECK (amount_pkr >= 0);  -- credited in Pakistan
ALTER TABLE reseller_payments ADD COLUMN difference_reason TEXT;    -- e.g. bank charges, deduction for a return

CREATE TABLE reseller_payment_files (
  id          SERIAL PRIMARY KEY,
  payment_id  INTEGER NOT NULL REFERENCES reseller_payments(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size        INTEGER NOT NULL CHECK (size > 0 AND size <= 2621440),   -- 2.5 MB
  data        BYTEA NOT NULL,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reseller_payment_files_payment_idx ON reseller_payment_files (payment_id);
