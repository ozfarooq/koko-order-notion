-- 023: finance F6: month-end and year-end close.
--   * fixed asset register (IAS 16): straight-line depreciation posted monthly, disposals with gain or loss;
--   * provisions and contingencies (IAS 37), each movement a journal;
--   * recurring and accrual journals (an accrual reverses itself on the 1st of the next month);
--   * month-end jobs: exchange revaluation of foreign-currency reseller balances (IAS 21) and the
--     allowance for expected credit losses on receivables (IFRS 9, provision matrix);
--   * one close record per month (the checklist as it stood when the month was closed).
-- Journal lines can carry the fixed asset they belong to.

INSERT INTO fin_accounts (code, name, type, system_key, is_current, fs_line, cash_flow_class, description) VALUES
('2700', 'Provisions', 'liability', 'provisions', true, 'Provisions', 'operating', 'IAS 37: present obligations of uncertain timing or amount'),
('4910', 'Gain on disposal of fixed assets', 'income', 'disposal_gain', NULL, 'Other income', 'investing', 'Sale price above the carrying amount'),
('4920', 'Exchange gain: unrealised (month-end revaluation)', 'income', 'fx_gain_unrealised', NULL, 'Other income', 'operating', 'IAS 21: foreign-currency balances retranslated at the closing rate; reversed on the 1st'),
('6980', 'Loss on disposal of fixed assets', 'expense', 'disposal_loss', NULL, 'Other expenses', 'investing', 'Sale price below the carrying amount'),
('6991', 'Exchange loss: unrealised (month-end revaluation)', 'expense', 'fx_loss_unrealised', NULL, 'Other expenses', 'operating', 'IAS 21: foreign-currency balances retranslated at the closing rate; reversed on the 1st');

-- Provision matrix (IFRS 9 simplified approach): loss rate % per age bucket of receivables
ALTER TABLE fin_settings ADD COLUMN ecl_rates JSONB NOT NULL DEFAULT '{"b30": 0, "b60": 1, "b90": 5, "b90p": 20}';

-- ── Fixed assets ───────────────────────────────────────────────────────
CREATE TABLE fin_assets (
  id                   SERIAL PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,                       -- FA-0001
  name                 TEXT NOT NULL,
  category             TEXT NOT NULL CHECK (category IN ('machinery', 'furniture', 'computers')),
  acquired_on          DATE NOT NULL,
  available_on         DATE NOT NULL,                              -- depreciation starts from here
  cost                 NUMERIC(14,2) NOT NULL CHECK (cost > 0),
  residual             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (residual >= 0),
  life_months          INTEGER NOT NULL CHECK (life_months BETWEEN 1 AND 600),
  -- 'purchase' (bought and paid through the register), 'expense' (an expense moved here),
  -- 'opening' (owned before go-live: cost and depreciation so far are in the opening balances)
  source               TEXT NOT NULL CHECK (source IN ('purchase', 'expense', 'opening')),
  opening_depreciation NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (opening_depreciation >= 0),
  expense_id           INTEGER UNIQUE REFERENCES fin_expenses(id),
  entry_id             BIGINT REFERENCES fin_entries(id),          -- moving an expense to the asset account
  supplier_id          INTEGER REFERENCES fin_suppliers(id),
  serial_no            TEXT,
  location             TEXT,
  notes                TEXT,
  status               TEXT NOT NULL DEFAULT 'In use' CHECK (status IN ('In use', 'Disposed')),
  disposed_on          DATE,
  disposal_proceeds    NUMERIC(14,2),
  disposal_entry_id    BIGINT REFERENCES fin_entries(id),
  disposal_note        TEXT,
  created_by           INTEGER REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (residual < cost),
  CHECK (opening_depreciation <= cost - residual),
  CHECK (available_on >= acquired_on),
  CHECK ((status = 'Disposed') = (disposed_on IS NOT NULL))
);
ALTER TABLE fin_lines ADD COLUMN asset_id INTEGER REFERENCES fin_assets(id);
CREATE INDEX fin_lines_asset ON fin_lines (asset_id) WHERE asset_id IS NOT NULL;

-- Large expenses reviewed and kept as expenses (not fixed assets)
ALTER TABLE fin_expenses ADD COLUMN not_an_asset BOOLEAN NOT NULL DEFAULT false;

-- ── Provisions (IAS 37) ────────────────────────────────────────────────
CREATE TABLE fin_provisions (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('provision', 'contingency')),   -- a contingency is disclosed, never booked
  expense_account_id  INTEGER REFERENCES fin_accounts(id),
  disclosure          TEXT,                                                      -- the note for the accounts
  status              TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Settled')),
  created_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind = 'contingency' OR expense_account_id IS NOT NULL)
);
CREATE TABLE fin_provision_moves (
  id            SERIAL PRIMARY KEY,
  provision_id  INTEGER NOT NULL REFERENCES fin_provisions(id),
  kind          TEXT NOT NULL CHECK (kind IN ('recognise', 'use', 'release')),     -- book / pay out of it / no longer needed
  moved_on      DATE NOT NULL,
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_from     TEXT,                                                            -- 'use' only: bank, cash, director_*
  note          TEXT,
  entry_id      BIGINT REFERENCES fin_entries(id),
  status        TEXT NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted', 'Void')),
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Recurring and accrual journals ─────────────────────────────────────
CREATE TABLE fin_recurring_journals (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  memo          TEXT,
  lines         JSONB NOT NULL,                     -- [{ accountId, debit, credit, description }]
  auto_reverse  BOOLEAN NOT NULL DEFAULT false,     -- an accrual: reversed on the 1st of the next month
  starts_month  TEXT NOT NULL CHECK (starts_month ~ '^\d{4}-\d{2}$'),
  ends_month    TEXT CHECK (ends_month ~ '^\d{4}-\d{2}$'),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_month IS NULL OR ends_month >= starts_month)
);

-- ── Month close record ─────────────────────────────────────────────────
CREATE TABLE fin_close_checklists (
  period_id        INTEGER PRIMARY KEY REFERENCES fin_periods(id),
  ticks            JSONB NOT NULL DEFAULT '{}',     -- items confirmed by hand (petty cash counted, Trax checked ...)
  results          JSONB,                           -- the checklist when the month was closed
  override_reason  TEXT,                            -- closed with items still open
  closed_by        INTEGER REFERENCES users(id),
  closed_at        TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
