-- 019: finance F4: bank reconciliation. Statements are read in the browser (never sent anywhere), stored
-- as lines, matched to what is in the books, and anything missing is booked from the line. Account and
-- phone numbers in narrations are cut to their last 4 digits before storage.

ALTER TABLE fin_accounts ADD COLUMN bank_last4 TEXT;                  -- which statement belongs to which bank account
UPDATE fin_accounts SET bank_last4 = '2846' WHERE system_key = 'bank_baf';

CREATE TABLE fin_bank_statements (
  id            SERIAL PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES fin_accounts(id),
  period_from   DATE NOT NULL,
  period_to     DATE NOT NULL,
  opening       NUMERIC(14,2) NOT NULL,
  closing       NUMERIC(14,2) NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('pdf', 'csv', 'xlsx')),
  file_id       BIGINT REFERENCES fin_files(id),
  status        TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Reconciled')),
  reconciled_by INTEGER REFERENCES users(id),
  reconciled_at TIMESTAMPTZ,
  note          TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, period_from, period_to),
  CHECK (period_to >= period_from)
);

CREATE TABLE fin_bank_lines (
  id            SERIAL PRIMARY KEY,
  statement_id  INTEGER NOT NULL REFERENCES fin_bank_statements(id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL,
  txn_date      DATE NOT NULL,
  amount        NUMERIC(14,2) NOT NULL CHECK (amount <> 0),     -- + money in, − money out
  balance       NUMERIC(14,2),
  narration     TEXT NOT NULL,                                   -- account / phone numbers cut to last 4
  channel       TEXT NOT NULL DEFAULT 'other' CHECK (channel IN ('ibft', 'raast', 'transfer', 'charge', 'other')),
  party         TEXT,                                            -- the other side, as the bank wrote it
  party_last4   TEXT,
  reference     TEXT,                                            -- bank transaction id (TRANS.ID)
  bank_ref      TEXT,                                            -- Raast reference
  fingerprint   TEXT NOT NULL,                                   -- same line in two overlapping statements
  status        TEXT NOT NULL DEFAULT 'Unmatched' CHECK (status IN ('Unmatched', 'Matched', 'Ignored')),
  entry_id      BIGINT REFERENCES fin_entries(id),               -- the entry it is matched to
  matched_by    TEXT CHECK (matched_by IN ('auto', 'manual', 'created')),
  note          TEXT,                                            -- why ignored / what was booked
  updated_by    INTEGER REFERENCES users(id),
  updated_at    TIMESTAMPTZ,
  UNIQUE (statement_id, line_no),
  CHECK ((status = 'Matched') = (entry_id IS NOT NULL))
);
CREATE INDEX fin_bank_lines_date_idx ON fin_bank_lines (txn_date);
-- An entry is matched to one bank line at most
CREATE UNIQUE INDEX fin_bank_lines_entry_key ON fin_bank_lines (entry_id) WHERE entry_id IS NOT NULL;

-- What a counterparty usually is (learned when a line is booked, editable): used to suggest next time
CREATE TABLE fin_bank_rules (
  id           SERIAL PRIMARY KEY,
  pattern      TEXT NOT NULL,                                    -- normalised name or narration words
  direction    TEXT NOT NULL DEFAULT 'any' CHECK (direction IN ('in', 'out', 'any')),
  action       TEXT NOT NULL CHECK (action IN ('bank_charge', 'director', 'expense', 'staff', 'customer', 'other', 'ignore')),
  director     TEXT CHECK (director IN ('omer', 'usman')),
  account_id   INTEGER REFERENCES fin_accounts(id),
  supplier_id  INTEGER REFERENCES fin_suppliers(id),
  staff_id     INTEGER REFERENCES fin_staff(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fin_bank_rules_key ON fin_bank_rules (pattern, direction);

INSERT INTO fin_bank_rules (pattern, direction, action, director, account_id)
SELECT v.p, v.d, v.a, v.dir, a.id FROM (VALUES
  ('federal excise duty', 'out', 'bank_charge', NULL, 'bank_charges'),
  ('service charge', 'out', 'bank_charge', NULL, 'bank_charges'),
  ('omer farooq', 'any', 'director', 'omer', NULL),
  ('usman ahmed', 'any', 'director', 'usman', NULL)
) v(p, d, a, dir, k) LEFT JOIN fin_accounts a ON a.system_key = v.k;

-- How the studio staff appear on the October 2026 statement
UPDATE fin_staff SET aliases = array_append(aliases, 'Jahangir Majeed') WHERE name = 'Jhangir' AND NOT ('Jahangir Majeed' = ANY(aliases));
UPDATE fin_staff SET aliases = array_append(aliases, 'Sarfaraz Ahmed Baig') WHERE name = 'Master Sarfaraz' AND NOT ('Sarfaraz Ahmed Baig' = ANY(aliases));
