-- 015: finance F2a: suppliers, staff and pay history, expenses with receipts, weekly studio
-- claims, recurring expenses, weekly payroll (hours per job, custom work and per-piece commission
-- income) and staff payments that settle salary and claims in one transfer. Every money event
-- posts a journal through lib/finance (source_type/source_id/source_event keep it single).

ALTER TABLE fin_settings ADD COLUMN capitalisation_threshold NUMERIC(14,2) NOT NULL DEFAULT 25000;   -- suggest a fixed asset at or above
ALTER TABLE fin_settings ADD COLUMN working_days_per_week   INTEGER NOT NULL DEFAULT 6 CHECK (working_days_per_week BETWEEN 1 AND 7);

INSERT INTO fin_accounts (code, name, type, system_key, fs_line, is_current, cash_flow_class)
VALUES ('1460', 'Advances to staff', 'asset', 'staff_advances', 'Other receivables', true, 'operating');

-- ── Suppliers ──────────────────────────────────────────────────────────
CREATE TABLE fin_suppliers (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  phone               TEXT,
  cnic_ntn            TEXT,                                   -- tax fields stay hidden while tax is off
  strn                TEXT,
  atl_status          BOOLEAN,
  atl_checked_on      DATE,
  wht_category        TEXT,
  default_account_id  INTEGER REFERENCES fin_accounts(id),
  is_related_party    BOOLEAN NOT NULL DEFAULT false,         -- IAS 24
  notes               TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fin_suppliers_name_key ON fin_suppliers (lower(name));

-- ── Staff ──────────────────────────────────────────────────────────────
CREATE TABLE fin_staff (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  role_title      TEXT NOT NULL DEFAULT 'tailor',             -- tailor, embroidery, cutting master, other
  pay_type        TEXT NOT NULL DEFAULT 'weekly_salary' CHECK (pay_type IN ('weekly_salary', 'per_piece_external')),
  is_production   BOOLEAN NOT NULL DEFAULT true,              -- production wages are direct labour (5200), else admin salaries (6200)
  hours_per_day   NUMERIC(4,1),
  cnic            TEXT,                                       -- never shown in lists
  payment_method  TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fin_staff_name_key ON fin_staff (lower(name));

CREATE TABLE fin_staff_salary (
  id              SERIAL PRIMARY KEY,
  staff_id        INTEGER NOT NULL REFERENCES fin_staff(id),
  weekly_salary   NUMERIC(14,2) NOT NULL CHECK (weekly_salary >= 0),
  effective_from  DATE NOT NULL,
  UNIQUE (staff_id, effective_from)
);

-- ── Expenses ───────────────────────────────────────────────────────────
CREATE TABLE fin_expenses (
  id             SERIAL PRIMARY KEY,
  expense_date   DATE NOT NULL,
  supplier_id    INTEGER REFERENCES fin_suppliers(id),
  account_id     INTEGER NOT NULL REFERENCES fin_accounts(id),  -- the category
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  tax_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  paid_from      TEXT NOT NULL CHECK (paid_from IN ('bank', 'cash', 'director_omer', 'director_usman', 'unpaid')),
  description    TEXT,
  reference      TEXT,
  collection_id  INTEGER REFERENCES collections(id),
  order_id       UUID REFERENCES orders(id),
  status         TEXT NOT NULL DEFAULT 'Posted' CHECK (status IN ('Draft', 'Posted', 'Void')),
  recurring_id   INTEGER,
  entry_id       BIGINT REFERENCES fin_entries(id),            -- the posting (latest, after edits)
  paid_entry_id  BIGINT REFERENCES fin_entries(id),            -- for 'unpaid' bills: the payment
  paid_on        DATE,
  created_by     INTEGER REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fin_expenses_date_idx ON fin_expenses (expense_date);
CREATE TABLE fin_expense_files (
  expense_id  INTEGER NOT NULL REFERENCES fin_expenses(id),
  file_id     BIGINT NOT NULL REFERENCES fin_files(id),
  PRIMARY KEY (expense_id, file_id)
);

CREATE TABLE fin_recurring (
  id                   SERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  account_id           INTEGER NOT NULL REFERENCES fin_accounts(id),
  supplier_id          INTEGER REFERENCES fin_suppliers(id),
  amount               NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  day_of_month         INTEGER NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  paid_from            TEXT NOT NULL DEFAULT 'bank' CHECK (paid_from IN ('bank', 'cash', 'director_omer', 'director_usman', 'unpaid')),
  is_active            BOOLEAN NOT NULL DEFAULT true,
  last_generated_month TEXT,                                   -- '2026-11'
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE fin_expenses ADD CONSTRAINT fin_expenses_recurring_fk FOREIGN KEY (recurring_id) REFERENCES fin_recurring(id);
ALTER TABLE fin_expenses ADD COLUMN recurring_month TEXT;                  -- '2026-11' for generated bills
CREATE UNIQUE INDEX fin_expenses_recurring_month ON fin_expenses (recurring_id, recurring_month)
  WHERE recurring_id IS NOT NULL AND status <> 'Void';

-- ── Weekly studio claims ───────────────────────────────────────────────
CREATE TABLE fin_claims (
  id                   SERIAL PRIMARY KEY,
  staff_id             INTEGER NOT NULL REFERENCES fin_staff(id),
  week_ending          DATE NOT NULL,
  status               TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Approved', 'Paid', 'Rejected')),
  notes                TEXT,
  approved_entry_id    BIGINT REFERENCES fin_entries(id),
  approved_by          INTEGER REFERENCES users(id),
  approved_at          TIMESTAMPTZ,
  created_by           INTEGER REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE fin_claim_lines (
  id          SERIAL PRIMARY KEY,
  claim_id    INTEGER NOT NULL REFERENCES fin_claims(id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  account_id  INTEGER NOT NULL REFERENCES fin_accounts(id),
  description TEXT,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  UNIQUE (claim_id, line_no)
);
CREATE TABLE fin_claim_files (
  claim_id  INTEGER NOT NULL REFERENCES fin_claims(id),
  file_id   BIGINT NOT NULL REFERENCES fin_files(id),
  PRIMARY KEY (claim_id, file_id)
);

-- ── Weekly payroll (week ending Saturday) ──────────────────────────────
CREATE TABLE fin_payroll_runs (
  id            SERIAL PRIMARY KEY,
  week_ending   DATE NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted')),
  notes         TEXT,
  posted_by     INTEGER REFERENCES users(id),
  posted_at     TIMESTAMPTZ,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE fin_payroll_lines (
  id              SERIAL PRIMARY KEY,
  run_id          INTEGER NOT NULL REFERENCES fin_payroll_runs(id) ON DELETE CASCADE,
  staff_id        INTEGER NOT NULL REFERENCES fin_staff(id),
  weekly_salary   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (weekly_salary >= 0),
  days_present    NUMERIC(3,1) NOT NULL DEFAULT 6 CHECK (days_present >= 0 AND days_present <= 7),
  hours_worked    NUMERIC(5,1),
  gross_pay       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (gross_pay >= 0),
  advance_recovered NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (advance_recovered >= 0),
  notes           TEXT,
  UNIQUE (run_id, staff_id),
  CHECK (advance_recovered <= gross_pay)
);
CREATE TABLE fin_payroll_hours (
  id             SERIAL PRIMARY KEY,
  line_id        INTEGER NOT NULL REFERENCES fin_payroll_lines(id) ON DELETE CASCADE,
  job_type       TEXT NOT NULL CHECK (job_type IN ('order', 'batch', 'sample', 'other', 'idle')),
  order_id       UUID REFERENCES orders(id),
  collection_id  INTEGER REFERENCES collections(id),
  description    TEXT,
  hours          NUMERIC(5,1) NOT NULL CHECK (hours > 0)
);
-- Custom work by salaried staff and per-piece commission (e.g. Manaf): income, not wages
CREATE TABLE fin_payroll_income (
  id            SERIAL PRIMARY KEY,
  run_id        INTEGER NOT NULL REFERENCES fin_payroll_runs(id) ON DELETE CASCADE,
  staff_id      INTEGER NOT NULL REFERENCES fin_staff(id),
  kind          TEXT NOT NULL CHECK (kind IN ('custom_work', 'commission')),
  description   TEXT,
  pieces        INTEGER,
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  received_into TEXT NOT NULL DEFAULT 'cash' CHECK (received_into IN ('bank', 'cash', 'director_omer', 'director_usman'))
);
CREATE TABLE fin_payroll_files (
  run_id   INTEGER NOT NULL REFERENCES fin_payroll_runs(id),
  file_id  BIGINT NOT NULL REFERENCES fin_files(id),
  PRIMARY KEY (run_id, file_id)
);

-- ── Payments to staff: one transfer can settle salary, a claim and/or give an advance ──
CREATE TABLE fin_staff_payments (
  id          SERIAL PRIMARY KEY,
  staff_id    INTEGER NOT NULL REFERENCES fin_staff(id),
  paid_on     DATE NOT NULL,
  paid_from   TEXT NOT NULL CHECK (paid_from IN ('bank', 'cash', 'director_omer', 'director_usman')),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reference   TEXT,                                         -- bank reference, e.g. 323447769421
  notes       TEXT,
  entry_id    BIGINT REFERENCES fin_entries(id),
  status      TEXT NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted', 'Void')),
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fin_staff_payments_ref ON fin_staff_payments (reference) WHERE reference IS NOT NULL AND status <> 'Void';
CREATE TABLE fin_staff_payment_parts (
  id               SERIAL PRIMARY KEY,
  payment_id       INTEGER NOT NULL REFERENCES fin_staff_payments(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('salary', 'claim', 'advance')),
  payroll_line_id  INTEGER REFERENCES fin_payroll_lines(id),
  claim_id         INTEGER REFERENCES fin_claims(id),
  amount           NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  CHECK ((kind = 'claim') = (claim_id IS NOT NULL))
);
CREATE TABLE fin_staff_payment_files (
  payment_id  INTEGER NOT NULL REFERENCES fin_staff_payments(id),
  file_id     BIGINT NOT NULL REFERENCES fin_files(id),
  PRIMARY KEY (payment_id, file_id)
);

-- ── Seed: the studio staff (Section 3; Abdur Rehman's weekly salary from the 22 Nov 2026 payment) ──
INSERT INTO fin_staff (name, role_title, pay_type, is_production, hours_per_day, notes) VALUES
  ('Abdur Rehman',    'main tailor',    'weekly_salary',      true, 10, 'Submits the weekly studio expense claim'),
  ('Jahangir',        'embroidery',     'weekly_salary',      true, 10, NULL),
  ('Master Iftikhar', 'cutting master', 'weekly_salary',      true, 4,  'Weekly salary to be confirmed'),
  ('Manaf',           'tailor',         'per_piece_external', true, NULL, 'Per piece, not paid by Koko; the studio earns commission on his output');
INSERT INTO fin_staff_salary (staff_id, weekly_salary, effective_from)
SELECT id, s, '2026-07-01' FROM fin_staff JOIN (VALUES ('Abdur Rehman', 17500), ('Jahangir', 15000)) v(n, s) ON v.n = fin_staff.name;
