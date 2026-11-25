-- 026: files on Vercel Blob, and receipts on order payments.
-- A file is either in the database (as before) or on Vercel Blob (blob_url set, no bytes kept here).
ALTER TABLE fin_files ADD COLUMN blob_url TEXT;
ALTER TABLE reseller_payment_files ADD COLUMN blob_url TEXT;
ALTER TABLE reseller_payment_files ALTER COLUMN data DROP NOT NULL;
ALTER TABLE reseller_payment_files ADD CONSTRAINT reseller_payment_files_stored CHECK (data IS NOT NULL OR blob_url IS NOT NULL);

-- Receipts and screenshots for a customer's payment on an order (the files live in fin_files)
CREATE TABLE customer_payment_files (
  payment_id  INTEGER NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
  file_id     BIGINT NOT NULL REFERENCES fin_files(id),
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_id, file_id)
);
