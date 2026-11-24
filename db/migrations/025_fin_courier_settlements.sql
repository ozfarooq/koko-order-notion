-- 025: Trax settlement import ("Payment Details / Sales Tax Invoice"). Each settlement pays out the cash
-- Trax collected on delivery less its charges, GST, the withholding it deducts (WHT s6A, COD sales tax)
-- and the IBFT fee. One entry per settlement: Dr bank (paid out), courier charges, deductions, bank
-- charges; Cr Trax COD clearing (the cash collected, per order). The rows are kept for the register and
-- so a shipment's charges can't be imported twice.
CREATE TABLE fin_courier_settlements (
  id           SERIAL PRIMARY KEY,
  courier      TEXT NOT NULL DEFAULT 'Trax',
  invoice_no   TEXT NOT NULL,
  settled_on   DATE NOT NULL,                       -- the day the payout reached the bank
  collection   NUMERIC(14,2) NOT NULL,              -- cash collected on delivery
  charges      NUMERIC(14,2) NOT NULL,              -- courier charges before GST
  gst          NUMERIC(14,2) NOT NULL,
  wht          NUMERIC(14,2) NOT NULL,              -- income tax withheld (s6A)
  sst          NUMERIC(14,2) NOT NULL,              -- sales tax withheld on COD
  other        NUMERIC(14,2) NOT NULL DEFAULT 0,    -- SMS and other charges
  ibft         NUMERIC(14,2) NOT NULL DEFAULT 0,
  rounding     NUMERIC(14,2) NOT NULL DEFAULT 0,
  payable      NUMERIC(14,2) NOT NULL,              -- paid to Koko (negative: Koko owes Trax)
  entry_id     BIGINT REFERENCES fin_entries(id),
  status       TEXT NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted', 'Void')),
  note         TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fin_courier_settlements_invoice ON fin_courier_settlements (courier, invoice_no) WHERE status <> 'Void';

CREATE TABLE fin_courier_settlement_lines (
  id             SERIAL PRIMARY KEY,
  settlement_id  INTEGER NOT NULL REFERENCES fin_courier_settlements(id),
  line_no        INTEGER NOT NULL,
  tracking_no    TEXT NOT NULL,
  kind           TEXT NOT NULL,                     -- Arrival (booking charges), Delivered (COD collected), Return ...
  order_number   TEXT,
  order_id       UUID REFERENCES orders(id),
  collection     NUMERIC(14,2) NOT NULL DEFAULT 0,
  charges        NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst            NUMERIC(14,2) NOT NULL DEFAULT 0,
  wht            NUMERIC(14,2) NOT NULL DEFAULT 0,
  sst            NUMERIC(14,2) NOT NULL DEFAULT 0,
  other          NUMERIC(14,2) NOT NULL DEFAULT 0,
  net            NUMERIC(14,2) NOT NULL DEFAULT 0,  -- paid out for this row (negative: charges only)
  payment_action TEXT,                              -- what the import did to the order's payments: ok, switched, added
  UNIQUE (settlement_id, line_no)
);
CREATE INDEX fin_courier_settlement_lines_tracking ON fin_courier_settlement_lines (tracking_no, kind);
