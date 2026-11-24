-- 024: finance F7: Pakistan tax (spec Section 8). Dormant until the owner switches tax on in Finance
-- settings with a start date (planned 1 July 2027); nothing posted before that date changes.
--   * tax profile settings (PRA number, filer status, small company, prices include tax, COD withholding);
--   * effective-dated tax rates (seed values, to be confirmed by the tax advisor) and tax codes;
--   * withholding deducted by Koko on supplier payments, tax suffered (deducted from Koko), tax deposits;
--   * the tax calendar; deferred tax accounts (IAS 12).

ALTER TABLE fin_settings
  ADD COLUMN pra_number          TEXT,
  ADD COLUMN filer_status        BOOLEAN NOT NULL DEFAULT true,            -- on the Active Taxpayers List
  ADD COLUMN small_company       BOOLEAN NOT NULL DEFAULT false,           -- qualifies for the small company rate
  ADD COLUMN pos_required        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN prices_include_tax  BOOLEAN NOT NULL DEFAULT true,            -- Q1: tax inside the price, or added on top
  ADD COLUMN cod_wht_treatment   TEXT NOT NULL DEFAULT 'Adjustable' CHECK (cod_wht_treatment IN ('Final', 'Adjustable')),
  ADD COLUMN tax_addbacks        JSONB NOT NULL DEFAULT '{}';              -- per tax year: other add-backs / deductions in the estimate

INSERT INTO fin_accounts (code, name, type, system_key, is_tax, is_active, is_current, fs_line, cash_flow_class, description) VALUES
('2330', 'Deferred tax', 'liability', 'deferred_tax', true, false, false, 'Deferred tax', 'operating', 'IAS 12: tax on temporary differences (a debit balance is a deferred tax asset)'),
('7110', 'Deferred tax expense / (income)', 'tax', 'deferred_tax_expense', true, false, NULL, 'Taxation', 'operating', 'IAS 12: movement in deferred tax');

-- Tax codes carried on journal lines (fin_lines.tax_code)
CREATE TABLE fin_tax_codes (
  code         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('output', 'zero', 'exempt', 'input', 'wht_deducted', 'wht_suffered', 'withheld_st')),
  rate_key     TEXT,                                   -- fin_tax_rates.key for the rate, if any
  description  TEXT
);
INSERT INTO fin_tax_codes (code, name, kind, rate_key, description) VALUES
('ST',     'Sales tax, standard rate',            'output',       'sales_tax',          'Retail, website and damaged-piece sales'),
('ZR',     'Zero-rated export',                   'zero',         NULL,                 'Reseller sales abroad (UAE)'),
('EX',     'Exempt / outside sales tax',          'exempt',       NULL,                 'Custom tailoring income and other non-taxable income, if the advisor confirms'),
('IN',     'Input sales tax',                     'input',        'sales_tax',          'Sales tax on purchases from registered suppliers'),
('W153G',  'WHT s153(1)(a): supply of goods',     'wht_deducted', 'wht_goods',          'Deducted by Koko when paying for goods'),
('W153S',  'WHT s153(1)(b): services',            'wht_deducted', 'wht_services',       'Deducted by Koko when paying for services'),
('W155',   'WHT s155: rent',                      'wht_deducted', 'wht_rent',           'Deducted by Koko when paying rent'),
('W6A',    'WHT s6A: e-commerce COD (courier)',   'wht_suffered', 'cod_wht',            'Deducted by Trax from COD collections'),
('W6AD',   'WHT s6A: digital payments',           'wht_suffered', 'digital_wht',        'Deducted by payment intermediaries'),
('W154',   'WHT s154: export proceeds',           'wht_suffered', 'export_wht',         'Deducted by the bank on export proceeds'),
('WBANK',  'WHT: bank and other',                 'wht_suffered', NULL,                 'Other tax deducted from Koko'),
('STW',    'Sales tax withheld by others',        'withheld_st',  NULL,                 'Sales tax withheld by couriers and intermediaries');

-- Rates with effective dates: a change applies from its date only (seed values, Finance Act 2025-26,
-- to be confirmed with Koko's tax advisor; filing stays manual on IRIS / PRA)
CREATE TABLE fin_tax_rates (
  id              SERIAL PRIMARY KEY,
  key             TEXT NOT NULL,
  label           TEXT NOT NULL,
  rate            NUMERIC(7,3) NOT NULL CHECK (rate >= 0 AND rate <= 100),   -- percent
  threshold       NUMERIC(16,2),                                            -- applies above this amount (if set)
  effective_from  DATE NOT NULL,
  note            TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key, effective_from)
);
INSERT INTO fin_tax_rates (key, label, rate, threshold, effective_from, note) VALUES
('sales_tax',           'Sales tax, standard rate',                       18,    NULL,      '2025-07-01', 'Sales Tax Act 1990, s3'),
('corporate',           'Income tax: company',                            29,    NULL,      '2025-07-01', 'First Schedule Part I Div II'),
('small_company',       'Income tax: small company',                      20,    NULL,      '2025-07-01', 'If Koko qualifies as a small company'),
('super_tax',           'Super tax (s4C)',                                8,     500000000, '2025-07-01', 'Only on income above the threshold; nil at Koko''s scale'),
('minimum_tax',         'Minimum tax on turnover (s113)',                 1.25,  NULL,      '2025-07-01', 'Payable where higher than normal tax; excess carried forward'),
('cod_wht',             'WHT on COD collections (s6A)',                   2,     NULL,      '2025-07-01', 'Deducted by the courier'),
('digital_wht',         'WHT on digital payments (s6A)',                  1,     NULL,      '2025-07-01', 'Deducted by payment intermediaries'),
('export_wht',          'WHT on export proceeds (s154)',                  1,     NULL,      '2025-07-01', 'Deducted by the bank'),
('wht_goods',           'WHT on goods (s153(1)(a)), supplier on the ATL', 5,     75000,     '2025-07-01', 'Threshold: payments above Rs 75,000 a year'),
('wht_goods_nonatl',    'WHT on goods (s153(1)(a)), supplier not on ATL', 10,    75000,     '2025-07-01', NULL),
('wht_services',        'WHT on services (s153(1)(b)), on the ATL',       11,    30000,     '2025-07-01', NULL),
('wht_services_nonatl', 'WHT on services (s153(1)(b)), not on the ATL',   22,    30000,     '2025-07-01', NULL),
('wht_rent',            'WHT on rent (s155)',                             15,    NULL,      '2025-07-01', 'Flat seed; the Act has slabs'),
('initial_allowance',   'Initial allowance: plant and machinery (s23)',   25,    NULL,      '2025-07-01', 'Tax depreciation, first year'),
('taxdep_machinery',    'Tax depreciation: machinery',                    15,    NULL,      '2025-07-01', 'Third Schedule, reducing balance'),
('taxdep_furniture',    'Tax depreciation: furniture',                    15,    NULL,      '2025-07-01', 'Third Schedule, reducing balance'),
('taxdep_computers',    'Tax depreciation: computers',                    30,    NULL,      '2025-07-01', 'Third Schedule, reducing balance');

-- Tax deducted from Koko (courier, bank, intermediaries) with the certificate reference
CREATE TABLE fin_tax_suffered (
  id               SERIAL PRIMARY KEY,
  tax_code         TEXT NOT NULL REFERENCES fin_tax_codes(code),
  suffered_on      DATE NOT NULL,
  party            TEXT,                                 -- Trax, Bank Alfalah, Collage ...
  base_amount      NUMERIC(14,2),                        -- what it was deducted from
  amount           NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  from_account     TEXT NOT NULL,                        -- system key of the account the money was short from
  reseller_id      INTEGER REFERENCES resellers(id),
  certificate_ref  TEXT,
  note             TEXT,
  entry_id         BIGINT REFERENCES fin_entries(id),
  status           TEXT NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted', 'Void')),
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Withholding deducted by Koko on an expense (when paid)
ALTER TABLE fin_expenses ADD COLUMN wht_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (wht_amount >= 0),
                         ADD COLUMN wht_code   TEXT REFERENCES fin_tax_codes(code);

-- Tax paid to FBR / PRA (CPR), and sales tax returns booked
CREATE TABLE fin_tax_payments (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('sales_tax', 'wht', 'advance_tax', 'income_tax')),
  period      TEXT NOT NULL,                             -- '2027-07' (month) or '2028' (tax year)
  paid_on     DATE NOT NULL,
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_from   TEXT NOT NULL,
  cpr_no      TEXT,
  note        TEXT,
  entry_id    BIGINT REFERENCES fin_entries(id),
  status      TEXT NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted', 'Void')),
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tax calendar: generated per tax year, due dates editable
CREATE TABLE fin_tax_calendar (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,                             -- sales_tax_return, wht_deposit, wht_statement, advance_tax, income_tax_return, secp_return
  period      TEXT NOT NULL,                             -- '2027-07', '2028-Q1', '2028'
  title       TEXT NOT NULL,
  due_on      DATE NOT NULL,
  status      TEXT NOT NULL DEFAULT 'Due' CHECK (status IN ('Due', 'Done', 'Not needed')),
  done_on     DATE,
  reference   TEXT,
  note        TEXT,
  UNIQUE (kind, period)
);
