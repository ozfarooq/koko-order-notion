-- 027: receipts from a folder, money coming in from the inbox, and wages paid straight from a transfer.

-- A file from a folder is known by the fingerprint of the original (before any resizing), so scanning
-- the same folder again adds only what is new
ALTER TABLE fin_intake_items ADD COLUMN source_hash TEXT, ADD COLUMN source_path TEXT;
CREATE UNIQUE INDEX fin_intake_items_source_hash ON fin_intake_items (source_hash) WHERE source_hash IS NOT NULL;

-- A salary paid when no payroll week is posted: the transfer books that week's wage itself
-- (direct), for the week named on the note, less any days off
ALTER TABLE fin_staff_payment_parts
  ADD COLUMN week_ending DATE,
  ADD COLUMN days_off NUMERIC(3,1),
  ADD COLUMN direct BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT fin_staff_payment_parts_direct CHECK (NOT direct OR (kind = 'salary' AND week_ending IS NOT NULL AND payroll_line_id IS NULL));

-- More sticker-note words seen on the studio's transfers
INSERT INTO fin_intake_labels (label, kind, account_id)
SELECT v.label, v.kind, a.id FROM (VALUES
  ('Videographer', 'expense', 'photoshoots'), ('Photographer', 'expense', 'photoshoots'), ('Shoot', 'expense', 'photoshoots'),
  ('Cleaning', 'claim', 'repairs')
) v(label, kind, key) JOIN fin_accounts a ON a.system_key = v.key
ON CONFLICT DO NOTHING;
