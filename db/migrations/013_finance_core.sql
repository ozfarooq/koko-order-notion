-- 013: finance core. A double-entry ledger: settings, chart of accounts, fiscal periods, journal
-- entries and lines, entry numbering, exchange rates and file storage (docs/finance-module.mdx v1.6).
-- The rules that keep the books correct live here, not only in the app:
--   * a posted entry balances (debits = credits, at least two lines), checked at commit;
--   * posted entries and their lines never change; the only allowed change is Posted -> Reversed;
--   * closed periods take postings only from the owner with a reason; locked periods take none;
--   * control accounts are posted by the system (and opening balances), never by a manual journal;
--   * the same source event can't be posted twice.
-- The app tells the database who is acting with set_config('koko.role' / 'koko.user_id', ..., true).

-- ── Settings (one row) ─────────────────────────────────────────────────
CREATE TABLE fin_settings (
  id                   BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  company_name         TEXT NOT NULL DEFAULT 'Koko Atelier (Private) Limited',
  base_currency        CHAR(3) NOT NULL DEFAULT 'PKR',
  go_live_date         DATE NOT NULL DEFAULT '2026-07-01',       -- opening balances are dated this day
  revenue_event        TEXT NOT NULL DEFAULT 'paid' CHECK (revenue_event IN ('paid', 'delivered')),  -- v1.6 C1
  reporting_framework  TEXT NOT NULL DEFAULT 'IFRS_SMES' CHECK (reporting_framework IN ('AFRS_SSE', 'IFRS_SMES', 'IFRS')),
  accounting_policies  TEXT,
  -- Tax hooks (Section 8.0): off until the owner switches tax on (planned 1 July 2027)
  tax_enabled          BOOLEAN NOT NULL DEFAULT false,
  tax_enabled_from     DATE,
  sales_tax_registered BOOLEAN NOT NULL DEFAULT false,
  ntn                  TEXT,
  strn                 TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO fin_settings DEFAULT VALUES;

-- ── Chart of accounts ──────────────────────────────────────────────────
CREATE TABLE fin_accounts (
  id               SERIAL PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE CHECK (code ~ '^[0-9]{4}(-[0-9]{2})?$'),
  name             TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'cogs', 'expense', 'tax')),
  parent_id        INTEGER REFERENCES fin_accounts(id),
  system_key       TEXT UNIQUE,                       -- code finds accounts by key, never by number
  is_control       BOOLEAN NOT NULL DEFAULT false,    -- mirrors a sub-ledger: system postings only
  is_contra        BOOLEAN NOT NULL DEFAULT false,    -- e.g. accumulated depreciation, sales returns
  is_tax           BOOLEAN NOT NULL DEFAULT false,    -- activated when tax is switched on
  currency         CHAR(3) NOT NULL DEFAULT 'PKR',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  fs_line          TEXT,                              -- financial statement line, e.g. 'Cash and bank'
  is_current       BOOLEAN,                           -- current / non-current (balance sheet accounts)
  cash_flow_class  TEXT CHECK (cash_flow_class IN ('operating', 'investing', 'financing', 'cash')),
  description      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Fiscal periods: 12 months July to June, plus a 13th adjustment period (IAS 10) ──
CREATE TABLE fin_periods (
  id             SERIAL PRIMARY KEY,
  fiscal_year    TEXT NOT NULL CHECK (fiscal_year ~ '^[0-9]{4}-[0-9]{2}$'),   -- '2026-27'
  period_no      INTEGER NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  name           TEXT NOT NULL,                                             -- 'Jul 2026', 'Adjustments 2026-27'
  starts_on      DATE NOT NULL,
  ends_on        DATE NOT NULL CHECK (ends_on >= starts_on),
  is_adjustment  BOOLEAN NOT NULL DEFAULT false,
  status         TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Closed', 'Locked')),
  closed_by      INTEGER REFERENCES users(id),
  closed_at      TIMESTAMPTZ,
  UNIQUE (fiscal_year, period_no),
  CHECK (is_adjustment = (period_no = 13))
);

-- Running entry numbers per type and fiscal year: JV-2627-000001
CREATE TABLE fin_sequences (
  prefix       TEXT NOT NULL,
  fiscal_year  TEXT NOT NULL,
  last_no      INTEGER NOT NULL,
  PRIMARY KEY (prefix, fiscal_year)
);

-- ── Journal entries and lines ──────────────────────────────────────────
CREATE TABLE fin_entries (
  id               BIGSERIAL PRIMARY KEY,
  entry_no         TEXT UNIQUE,                       -- given when posted; drafts have none
  entry_type       TEXT NOT NULL DEFAULT 'JV' CHECK (entry_type IN ('JV', 'OB', 'SI', 'RC', 'EX', 'PY', 'PU', 'IN', 'BK', 'TX', 'CL')),
  entry_date       DATE NOT NULL,
  period_id        INTEGER NOT NULL REFERENCES fin_periods(id),
  memo             TEXT,
  source_type      TEXT,                              -- order, customer_payment, reseller_item, expense, reversal, opening ...
  source_id        TEXT,
  source_event     TEXT,                              -- paid, settled, reversed, opening ...
  status           TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted', 'Reversed')),
  reversal_of      BIGINT REFERENCES fin_entries(id), -- on a reversal: the entry it reverses
  reversed_by      BIGINT REFERENCES fin_entries(id), -- on a reversed entry: its reversal
  override_reason  TEXT,                              -- why it was posted into a closed period
  created_by       INTEGER REFERENCES users(id),
  posted_by        INTEGER REFERENCES users(id),
  posted_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'Draft' OR entry_no IS NOT NULL),
  CHECK ((source_type IS NULL) = (source_id IS NULL))
);
CREATE UNIQUE INDEX fin_entries_source_key ON fin_entries (source_type, source_id, source_event)
  WHERE source_type IS NOT NULL AND status <> 'Reversed';
CREATE INDEX fin_entries_date_idx   ON fin_entries (entry_date);
CREATE INDEX fin_entries_period_idx ON fin_entries (period_id);

CREATE TABLE fin_lines (
  id                   BIGSERIAL PRIMARY KEY,
  entry_id             BIGINT NOT NULL REFERENCES fin_entries(id) ON DELETE CASCADE,
  line_no              INTEGER NOT NULL,
  account_id           INTEGER NOT NULL REFERENCES fin_accounts(id),
  debit                NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit               NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency             CHAR(3) NOT NULL DEFAULT 'PKR',
  amount_fc            NUMERIC(14,2),                 -- foreign amount when currency <> PKR
  fx_rate              NUMERIC(14,6),                 -- PKR per 1 unit of currency
  party_type           TEXT CHECK (party_type IN ('customer', 'reseller', 'supplier', 'staff', 'director', 'courier')),
  party_id             TEXT,
  order_id             UUID REFERENCES orders(id),
  product_id           INTEGER REFERENCES products(id),
  collection_id        INTEGER REFERENCES collections(id),
  consignment_item_id  UUID REFERENCES consignment_items(id),
  tax_code             TEXT,                          -- null while tax is off (Section 8.0)
  description          TEXT,
  CHECK ((debit > 0) <> (credit > 0)),
  CHECK (currency = 'PKR' OR (amount_fc IS NOT NULL AND fx_rate IS NOT NULL)),
  CHECK ((party_type IS NULL) = (party_id IS NULL)),
  UNIQUE (entry_id, line_no)
);
CREATE INDEX fin_lines_account_idx ON fin_lines (account_id, entry_id);
CREATE INDEX fin_lines_party_idx   ON fin_lines (party_type, party_id);
CREATE INDEX fin_lines_order_idx   ON fin_lines (order_id);
CREATE INDEX fin_lines_coll_idx    ON fin_lines (collection_id);

-- ── Exchange rates (PKR per unit) ──────────────────────────────────────
CREATE TABLE fin_fx_rates (
  rate_date    DATE NOT NULL,
  currency     CHAR(3) NOT NULL CHECK (currency <> 'PKR'),
  rate_to_pkr  NUMERIC(14,6) NOT NULL CHECK (rate_to_pkr > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_date, currency)
);

-- ── Files (in the database until Google Drive; v1.6 C3) ────────────────
CREATE TABLE fin_files (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  mime         TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv',
                                             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  size         INTEGER NOT NULL CHECK (size > 0 AND size <= 2621440),     -- 2.5 MB
  sha256       TEXT NOT NULL UNIQUE,                                      -- the same file is never stored twice
  storage      TEXT NOT NULL DEFAULT 'db' CHECK (storage IN ('db', 'gdrive')),
  external_id  TEXT,                                                      -- Google Drive file id, later
  folder       TEXT,                                                      -- e.g. 'Opening balances', 'Receipts / 2026-11'
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE fin_file_blobs (
  file_id  BIGINT PRIMARY KEY REFERENCES fin_files(id) ON DELETE CASCADE,
  data     BYTEA NOT NULL
);
CREATE TABLE fin_entry_files (
  entry_id  BIGINT NOT NULL REFERENCES fin_entries(id),
  file_id   BIGINT NOT NULL REFERENCES fin_files(id),
  PRIMARY KEY (entry_id, file_id)
);

-- ── Rules ──────────────────────────────────────────────────────────────
-- FY '2026-27' -> 'JV-2627-000001'
CREATE FUNCTION fin_next_entry_no(p_prefix TEXT, p_fy TEXT) RETURNS TEXT AS $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO fin_sequences (prefix, fiscal_year, last_no) VALUES (p_prefix, p_fy, 1)
  ON CONFLICT (prefix, fiscal_year) DO UPDATE SET last_no = fin_sequences.last_no + 1
  RETURNING last_no INTO n;
  RETURN p_prefix || '-' || substr(p_fy, 3, 2) || substr(p_fy, 6, 2) || '-' || lpad(n::text, 6, '0');
END $$ LANGUAGE plpgsql;

-- Before an entry is written: find its period, check the period allows it, number it when posted,
-- and refuse any change to a posted entry except marking it Reversed.
CREATE FUNCTION fin_entries_guard() RETURNS trigger AS $$
DECLARE p fin_periods%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IN ('Posted', 'Reversed') THEN
    IF OLD.status = 'Posted' AND NEW.status = 'Reversed' AND NEW.reversed_by IS NOT NULL
       AND (NEW.entry_no, NEW.entry_type, NEW.entry_date, NEW.period_id, NEW.memo, NEW.source_type, NEW.source_id,
            NEW.source_event, NEW.reversal_of, NEW.override_reason, NEW.created_by, NEW.posted_by, NEW.posted_at)
           IS NOT DISTINCT FROM
           (OLD.entry_no, OLD.entry_type, OLD.entry_date, OLD.period_id, OLD.memo, OLD.source_type, OLD.source_id,
            OLD.source_event, OLD.reversal_of, OLD.override_reason, OLD.created_by, OLD.posted_by, OLD.posted_at) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Entry % is posted and cannot be changed. Reverse it instead.', OLD.entry_no USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'Reversed' THEN
    RAISE EXCEPTION 'Only a posted entry can be marked reversed' USING ERRCODE = 'P0001';
  END IF;

  -- Period: the month containing the date, unless the 13th adjustment period was chosen
  IF NEW.period_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.entry_date IS DISTINCT FROM OLD.entry_date AND NEW.period_id = OLD.period_id) THEN
    SELECT * INTO p FROM fin_periods WHERE NOT is_adjustment AND NEW.entry_date BETWEEN starts_on AND ends_on;
    IF NOT FOUND THEN RAISE EXCEPTION 'There is no accounting period for %', NEW.entry_date USING ERRCODE = 'P0001'; END IF;
    NEW.period_id := p.id;
  ELSE
    SELECT * INTO p FROM fin_periods WHERE id = NEW.period_id;
    IF NEW.entry_date NOT BETWEEN p.starts_on AND p.ends_on THEN
      RAISE EXCEPTION 'The date % is outside period %', NEW.entry_date, p.name USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.status = 'Posted' THEN
    IF p.status = 'Locked' THEN
      RAISE EXCEPTION 'Period % is locked', p.name USING ERRCODE = 'P0001';
    ELSIF p.status = 'Closed' AND (coalesce(current_setting('koko.role', true), '') <> 'owner' OR coalesce(trim(NEW.override_reason), '') = '') THEN
      RAISE EXCEPTION 'Period % is closed. Only the owner can post into it, with a reason.', p.name USING ERRCODE = 'P0001';
    END IF;
    IF NEW.entry_no IS NULL THEN NEW.entry_no := fin_next_entry_no(NEW.entry_type, p.fiscal_year); END IF;
    NEW.posted_at := coalesce(NEW.posted_at, now());
    NEW.posted_by := coalesce(NEW.posted_by, nullif(current_setting('koko.user_id', true), '')::integer);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER fin_entries_guard BEFORE INSERT OR UPDATE ON fin_entries FOR EACH ROW EXECUTE FUNCTION fin_entries_guard();

CREATE FUNCTION fin_entries_no_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'Draft' THEN
    RAISE EXCEPTION 'Entry % is posted and cannot be deleted. Reverse it instead.', OLD.entry_no USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER fin_entries_no_delete BEFORE DELETE ON fin_entries FOR EACH ROW EXECUTE FUNCTION fin_entries_no_delete();

-- Lines of a posted entry never change; manual journals can't touch control accounts; inactive accounts take nothing
CREATE FUNCTION fin_lines_guard() RETURNS trigger AS $$
DECLARE e fin_entries%ROWTYPE; a fin_accounts%ROWTYPE;
BEGIN
  SELECT * INTO e FROM fin_entries WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END);
  IF FOUND AND e.status <> 'Draft' THEN
    RAISE EXCEPTION 'Entry % is posted; its lines cannot be changed', e.entry_no USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO a FROM fin_accounts WHERE id = NEW.account_id;
  IF NOT a.is_active THEN
    RAISE EXCEPTION 'Account % % is not active', a.code, a.name USING ERRCODE = 'P0001';
  END IF;
  IF a.is_control AND e.entry_type = 'JV' AND e.source_type IS NULL THEN
    RAISE EXCEPTION 'Account % % is kept by the system and cannot be used in a manual journal', a.code, a.name USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER fin_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON fin_lines FOR EACH ROW EXECUTE FUNCTION fin_lines_guard();

-- At commit: every posted entry has at least two lines and balances to the paisa
CREATE FUNCTION fin_entries_balanced() RETURNS trigger AS $$
DECLARE d NUMERIC; c NUMERIC; n INTEGER; st TEXT;
BEGIN
  SELECT status INTO st FROM fin_entries WHERE id = NEW.id;
  IF st IN ('Posted', 'Reversed') THEN
    SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO d, c, n FROM fin_lines WHERE entry_id = NEW.id;
    IF n < 2 OR d <> c OR d = 0 THEN
      RAISE EXCEPTION 'Entry % does not balance (debits %, credits %, % lines)', NEW.entry_no, d, c, n USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER fin_entries_balanced AFTER INSERT OR UPDATE ON fin_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fin_entries_balanced();

-- Accounts with postings keep their code and type, and are never deleted
CREATE FUNCTION fin_accounts_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM fin_lines WHERE account_id = OLD.id) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Account % has postings and cannot be deleted; make it inactive instead', OLD.code USING ERRCODE = 'P0001';
    ELSIF NEW.code <> OLD.code OR NEW.type <> OLD.type THEN
      RAISE EXCEPTION 'Account % has postings; its code and type cannot change', OLD.code USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER fin_accounts_guard BEFORE UPDATE OR DELETE ON fin_accounts FOR EACH ROW EXECUTE FUNCTION fin_accounts_guard();

-- ── Seed: FY 2026-27 periods ───────────────────────────────────────────
INSERT INTO fin_periods (fiscal_year, period_no, name, starts_on, ends_on, is_adjustment)
SELECT '2026-27', g, to_char(m, 'Mon YYYY'), m::date, (m + interval '1 month - 1 day')::date, false
FROM generate_series(1, 12) g, LATERAL (SELECT date '2026-07-01' + (g - 1) * interval '1 month' AS m) x;
INSERT INTO fin_periods (fiscal_year, period_no, name, starts_on, ends_on, is_adjustment)
VALUES ('2026-27', 13, 'Adjustments 2026-27', '2027-06-30', '2027-06-30', true);

-- ── Seed: chart of accounts (Section 5) ────────────────────────────────
-- (code, name, type, system_key, control, contra, tax, active, fs_line, current, cash-flow class)
INSERT INTO fin_accounts (code, name, type, system_key, is_control, is_contra, is_tax, is_active, fs_line, is_current, cash_flow_class) VALUES
('1100', 'Cash in hand: studio petty cash',                    'asset', 'cash_studio',        false, false, false, true,  'Cash and bank', true, 'cash'),
('1110', 'Bank Alfalah current account (PKR)',                 'asset', 'bank_baf',           false, false, false, true,  'Cash and bank', true, 'cash'),
('1150', 'Trax COD clearing',                                  'asset', 'clearing_trax',      false, false, false, true,  'Other receivables', true, 'operating'),
('1160', 'Shopify / gateway clearing',                         'asset', 'clearing_gateway',   false, false, false, false, 'Other receivables', true, 'operating'),
('1200', 'Trade receivables: retail customers',                'asset', 'ar_customers',       true,  false, false, true,  'Trade receivables', true, 'operating'),
('1210', 'Trade receivables: resellers',                       'asset', 'ar_resellers',       true,  false, false, true,  'Trade receivables', true, 'operating'),
('1250', 'Allowance for expected credit losses',               'asset', 'ecl_allowance',      false, true,  false, true,  'Trade receivables', true, 'operating'),
('1300', 'Raw materials: fabric, trims, lining, packaging',    'asset', 'inv_materials',      true,  false, false, true,  'Inventories', true, 'operating'),
('1310', 'Work in progress',                                   'asset', 'inv_wip',            false, false, false, true,  'Inventories', true, 'operating'),
('1320', 'Finished goods: at studio',                          'asset', 'inv_fg_studio',      false, false, false, true,  'Inventories', true, 'operating'),
('1330', 'Finished goods: with resellers (consignment)',       'asset', 'inv_fg_consigned',   false, false, false, true,  'Inventories', true, 'operating'),
('1340', 'Inventory write-down to net realisable value',       'asset', 'inv_nrv_allowance',  false, true,  false, true,  'Inventories', true, 'operating'),
('1350', 'Right to recover returned goods',                    'asset', 'return_asset',       false, false, false, true,  'Inventories', true, 'operating'),
('1400', 'Advance income tax / tax withheld by others',        'asset', 'tax_wht_suffered',   false, false, true,  false, 'Tax refundable', true, 'operating'),
('1410', 'Sales tax withheld by couriers / intermediaries',    'asset', 'st_withheld',        false, false, true,  false, 'Tax refundable', true, 'operating'),
('1420', 'Input sales tax',                                    'asset', 'st_input',           false, false, true,  false, 'Tax refundable', true, 'operating'),
('1450', 'Deposits and prepayments',                           'asset', 'prepayments',        false, false, false, true,  'Deposits and prepayments', true, 'operating'),
('1500', 'Machinery and equipment',                            'asset', 'ppe_machinery',      false, false, false, true,  'Property, plant and equipment', false, 'investing'),
('1510', 'Furniture and fixtures',                             'asset', 'ppe_furniture',      false, false, false, true,  'Property, plant and equipment', false, 'investing'),
('1520', 'Computers and phones',                               'asset', 'ppe_computers',      false, false, false, true,  'Property, plant and equipment', false, 'investing'),
('1590', 'Accumulated depreciation',                           'asset', 'ppe_acc_depreciation', false, true, false, true, 'Property, plant and equipment', false, 'investing'),
('1600', 'Right-of-use asset: studio lease',                   'asset', 'rou_asset',          false, false, false, false, 'Right-of-use assets', false, 'investing'),
('2100', 'Trade payables: suppliers',                          'liability', 'ap_suppliers',   true,  false, false, true,  'Trade and other payables', true, 'operating'),
('2110', 'Staff expense claims payable',                       'liability', 'ap_staff_claims', true, false, false, true,  'Trade and other payables', true, 'operating'),
('2120', 'Salaries and wages payable',                         'liability', 'wages_payable',  false, false, false, true,  'Trade and other payables', true, 'operating'),
('2130', 'Accrued employee benefits',                          'liability', 'employee_benefits_accrued', false, false, false, true, 'Trade and other payables', true, 'operating'),
('2200', 'Customer advances (contract liabilities)',           'liability', 'customer_advances', true, false, false, true, 'Contract liabilities', true, 'operating'),
('2210', 'Refund liabilities',                                 'liability', 'refund_liability', false, false, false, true, 'Refund liabilities', true, 'operating'),
('2300', 'Output sales tax payable',                           'liability', 'st_output',      false, false, true,  false, 'Taxes payable', true, 'operating'),
('2310', 'Withholding tax deducted, payable to FBR',           'liability', 'wht_payable',    false, false, true,  false, 'Taxes payable', true, 'operating'),
('2320', 'Income tax payable',                                 'liability', 'income_tax_payable', false, false, true, false, 'Taxes payable', true, 'operating'),
('2400', 'Director current account: Omer Farooq',              'liability', 'director_omer',  false, false, false, true,  'Due to directors', true, 'financing'),
('2410', 'Director current account: Usman',                   'liability', 'director_usman', false, false, false, true,  'Due to directors', true, 'financing'),
('2500', 'Accrued expenses',                                   'liability', 'accrued_expenses', false, false, false, true, 'Trade and other payables', true, 'operating'),
('2600', 'Lease liability',                                    'liability', 'lease_liability', false, false, false, false, 'Lease liabilities', false, 'financing'),
('3100', 'Share capital',                                      'equity', 'share_capital',     false, false, false, true,  'Share capital', NULL, 'financing'),
('3200', 'Retained earnings',                                  'equity', 'retained_earnings', false, false, false, true,  'Retained earnings', NULL, 'operating'),
('4100', 'Retail sales: studio, WhatsApp, Instagram',          'income', 'sales_retail',      false, false, false, true,  'Revenue', NULL, 'operating'),
('4110', 'Retail sales: website (Shopify)',                    'income', 'sales_web',         false, false, false, true,  'Revenue', NULL, 'operating'),
('4200', 'Export / reseller sales',                            'income', 'sales_reseller',    false, false, false, true,  'Revenue', NULL, 'operating'),
('4300', 'Custom tailoring and alteration income',             'income', 'income_custom',     false, false, false, true,  'Revenue', NULL, 'operating'),
('4400', 'Commission income: per-piece tailoring',             'income', 'income_commission', false, false, false, true,  'Other income', NULL, 'operating'),
('4500', 'Sale of damaged / sample pieces',                    'income', 'sales_damaged',     false, false, false, true,  'Revenue', NULL, 'operating'),
('4800', 'Sales returns and discounts',                        'income', 'sales_returns',     false, true,  false, true,  'Revenue', NULL, 'operating'),
('4900', 'Other income, exchange gain',                        'income', 'fx_gain',           false, false, false, true,  'Other income', NULL, 'operating'),
('5100', 'Materials consumed',                                 'cogs', 'cogs_materials',      false, false, false, true,  'Cost of sales', NULL, 'operating'),
('5200', 'Direct labour (production wages)',                   'cogs', 'cogs_labour',         false, false, false, true,  'Cost of sales', NULL, 'operating'),
('5300', 'Outsourced work: embroidery, dyeing, printing',      'cogs', 'cogs_outsourced',     false, false, false, true,  'Cost of sales', NULL, 'operating'),
('5400', 'Production overhead applied',                        'cogs', 'cogs_overhead',       false, false, false, true,  'Cost of sales', NULL, 'operating'),
('5410', 'Stitching consumables (thread, pins, needles, chalk, interlining)', 'cogs', 'consumables', false, false, false, true, 'Cost of sales', NULL, 'operating'),
('5450', 'Unabsorbed production overhead (idle capacity)',     'cogs', 'overhead_unabsorbed', false, false, false, true,  'Cost of sales', NULL, 'operating'),
('5500', 'Inventory write-offs and damage',                    'cogs', 'inv_writeoff',        false, false, false, true,  'Cost of sales', NULL, 'operating'),
('5600', 'Costing variances (actual vs standard)',             'cogs', 'cost_variance',       false, false, false, true,  'Cost of sales', NULL, 'operating'),
('6100', 'Studio rent',                                        'expense', 'rent',             false, false, false, true,  'Administrative expenses', NULL, 'operating'),
('6110', 'Utilities: electricity, water, gas, internet',       'expense', 'utilities',        false, false, false, true,  'Administrative expenses', NULL, 'operating'),
('6120', 'Repairs and maintenance: electrician, carpenter',    'expense', 'repairs',          false, false, false, true,  'Administrative expenses', NULL, 'operating'),
('6200', 'Salaries: admin and non-production',                 'expense', 'salaries_admin',   false, false, false, true,  'Administrative expenses', NULL, 'operating'),
('6300', 'Marketing: paid ads (Meta etc.)',                    'expense', 'marketing_ads',    false, false, false, true,  'Selling and distribution expenses', NULL, 'operating'),
('6310', 'Marketing: PR gifts (cost of PR orders)',            'expense', 'pr_cost',          false, false, false, true,  'Selling and distribution expenses', NULL, 'operating'),
('6320', 'Photoshoots and content',                            'expense', 'photoshoots',      false, false, false, true,  'Selling and distribution expenses', NULL, 'operating'),
('6330', 'Events and exhibitions',                             'expense', 'events',           false, false, false, true,  'Selling and distribution expenses', NULL, 'operating'),
('6400', 'Courier and delivery charges',                       'expense', 'courier_charges',  false, false, false, true,  'Selling and distribution expenses', NULL, 'operating'),
('6410', 'Packaging',                                          'expense', 'packaging',        false, false, false, true,  'Selling and distribution expenses', NULL, 'operating'),
('6420', 'Courier deductions on COD payouts',                  'expense', 'courier_deductions', false, false, false, true, 'Selling and distribution expenses', NULL, 'operating'),
('6500', 'Reseller commission',                                'expense', 'reseller_commission', false, false, false, true, 'Selling and distribution expenses', NULL, 'operating'),
('6510', 'Reseller alteration / laundry charges',              'expense', 'reseller_alteration', false, false, false, true, 'Selling and distribution expenses', NULL, 'operating'),
('6600', 'Bank charges (incl. IBFT)',                          'expense', 'bank_charges',     false, false, false, true,  'Administrative expenses', NULL, 'operating'),
('6610', 'Payment gateway fees',                               'expense', 'gateway_fees',     false, false, false, true,  'Selling and distribution expenses', NULL, 'operating'),
('6700', 'Software and subscriptions (Shopify, Vercel, Neon, Claude)', 'expense', 'software', false, false, false, true, 'Administrative expenses', NULL, 'operating'),
('6800', 'Professional fees: accountant, legal, SECP',         'expense', 'professional_fees', false, false, false, true, 'Administrative expenses', NULL, 'operating'),
('6900', 'Travel and conveyance',                              'expense', 'travel',           false, false, false, true,  'Administrative expenses', NULL, 'operating'),
('6950', 'Depreciation',                                       'expense', 'depreciation',     false, false, false, true,  'Administrative expenses', NULL, 'operating'),
('6960', 'Impairment loss on receivables',                     'expense', 'ecl_expense',      false, false, false, true,  'Administrative expenses', NULL, 'operating'),
('6970', 'Finance cost on lease',                              'expense', 'lease_interest',   false, false, false, false, 'Finance cost', NULL, 'financing'),
('6990', 'Exchange loss',                                      'expense', 'fx_loss',          false, false, false, true,  'Other expenses', NULL, 'operating'),
('7100', 'Income tax expense (current, minimum tax)',          'tax', 'tax_expense',          false, false, true,  false, 'Taxation', NULL, 'operating');
