-- 017: finance F2b: receipt and screenshot intake. Files go into an inbox, are read (Claude vision,
-- or typed in by hand), classified into a proposed posting, reviewed and approved. The bank reference
-- keeps the same transfer from being entered twice. Files stay in the database for now (spec v1.6 C3).

-- Sticker-note words: what a line such as "Tailor Salary 17500" or "Market 5700" means
CREATE TABLE fin_intake_labels (
  id          SERIAL PRIMARY KEY,
  label       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('salary', 'claim', 'advance', 'expense', 'owner_funding', 'ignore')),
  account_id  INTEGER REFERENCES fin_accounts(id),         -- the category for claim and expense lines
  is_active   BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX fin_intake_labels_key ON fin_intake_labels (lower(label));

INSERT INTO fin_intake_labels (label, kind, account_id)
SELECT v.label, v.kind, a.id FROM (VALUES
  ('Salary', 'salary', NULL), ('Wages', 'salary', NULL), ('Advance', 'advance', NULL),
  ('Market', 'claim', 'consumables'), ('Water', 'claim', 'utilities'), ('Electrician', 'claim', 'repairs'), ('Carpenter', 'claim', 'repairs'),
  ('Fabric', 'expense', 'cogs_materials'), ('Lace', 'expense', 'cogs_materials'), ('Dye', 'expense', 'cogs_outsourced'),
  ('Embroidery', 'expense', 'cogs_outsourced'), ('Courier', 'expense', 'courier_charges'), ('Packaging', 'expense', 'packaging'),
  ('Funds added', 'owner_funding', NULL), ('Total', 'ignore', NULL), ('Final Payment', 'ignore', NULL)
) v(label, kind, key) LEFT JOIN fin_accounts a ON a.system_key = v.key;

CREATE TABLE fin_intake_items (
  id            SERIAL PRIMARY KEY,
  file_id       BIGINT NOT NULL UNIQUE REFERENCES fin_files(id),
  status        TEXT NOT NULL DEFAULT 'New'
                CHECK (status IN ('New', 'Ready', 'Needs attention', 'Posted', 'Parked', 'Rejected', 'Duplicate')),
  extracted     JSONB,                                  -- what was read (names and last 4 digits only)
  kind          TEXT CHECK (kind IN ('owner_funding', 'staff_payment', 'expense', 'customer_receipt', 'reseller_payment', 'other')),
  proposal      JSONB,                                  -- the posting it will make, editable in review
  confidence    NUMERIC(3,2),
  issues        TEXT[] NOT NULL DEFAULT '{}',
  bank_ref      TEXT,
  txn_date      DATE,
  amount        NUMERIC(14,2),
  duplicate_of  INTEGER REFERENCES fin_intake_items(id),
  read_by       TEXT,                                   -- 'vision' or 'hand'
  read_error    TEXT,
  read_at       TIMESTAMPTZ,
  result_type   TEXT,                                   -- expense, staff_payment, entry
  result_id     BIGINT,
  entry_id      BIGINT REFERENCES fin_entries(id),
  note          TEXT,                                   -- reject / park reason
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fin_intake_bank_ref ON fin_intake_items (bank_ref) WHERE bank_ref IS NOT NULL AND status NOT IN ('Rejected', 'Duplicate');
CREATE INDEX fin_intake_status_idx ON fin_intake_items (status, created_at);
