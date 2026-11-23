-- 018: finance F3: sales, customer receipts and reseller posting.
-- * customer_payments: one row per payment (negative = refund). It is the single source of the advance:
--   a trigger keeps orders.advance_paid_pkr = sum(payments), and any change the order screens make to
--   advance_paid_pkr is recorded as a payment row, so existing screens keep working (spec v1.6 C5b).
-- * orders.paid_on (revenue date, v1.6 C1), status_changed_on (date of returns / cancellations),
--   tracking_number (Trax, C5a).
-- * fin_post_exceptions: postings that failed (missing rate, closed period…) wait here for a retry;
--   saving an order or a reseller statement never fails because of finance.

ALTER TABLE orders ADD COLUMN paid_on DATE;
ALTER TABLE orders ADD COLUMN paid_on_inferred BOOLEAN NOT NULL DEFAULT false;   -- backfilled, not seen happen
ALTER TABLE orders ADD COLUMN status_changed_on DATE;
ALTER TABLE orders ADD COLUMN tracking_number TEXT;

-- Paid date for orders already Paid: the day the app recorded the change, else delivery / order date
UPDATE orders o SET paid_on = coalesce(
    (SELECT (max(a.at) AT TIME ZONE 'Asia/Karachi')::date FROM audit_log a
      WHERE a.entity = 'order' AND a.entity_id = o.id::text AND a.action IN ('order.update', 'order.create') AND a.changes->>'status' = 'Paid'),
    o.delivery_date, o.order_date, (o.updated_at AT TIME ZONE 'Asia/Karachi')::date),
  paid_on_inferred = NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity = 'order' AND a.entity_id = o.id::text
      AND a.action IN ('order.update', 'order.create') AND a.changes->>'status' = 'Paid')
WHERE o.status = 'Paid';
UPDATE orders SET status_changed_on = (updated_at AT TIME ZONE 'Asia/Karachi')::date WHERE status IN ('Returned', 'Cancelled');

CREATE FUNCTION orders_status_dates() RETURNS trigger AS $$
DECLARE today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_on := today;
    -- Becoming Paid: today, unless the paid date was given in the same change
    IF NEW.status = 'Paid' THEN
      IF TG_OP = 'INSERT' THEN NEW.paid_on := coalesce(NEW.paid_on, today);
      ELSIF NEW.paid_on IS NOT DISTINCT FROM OLD.paid_on THEN NEW.paid_on := today;
      END IF;
      NEW.paid_on_inferred := false;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER orders_status_dates BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION orders_status_dates();

-- ── Customer payments ──────────────────────────────────────────────────
CREATE TABLE customer_payments (
  id                SERIAL PRIMARY KEY,
  order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  paid_on           DATE NOT NULL,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount <> 0),         -- negative = refund
  method            TEXT NOT NULL DEFAULT 'bank' CHECK (method IN ('bank', 'cash', 'trax_cod', 'director_omer', 'director_usman')),
  method_confirmed  BOOLEAN NOT NULL DEFAULT true,                       -- false: recorded from the order screen / migration, method assumed
  reference         TEXT,
  notes             TEXT,
  source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'order_screen', 'migrated')),
  created_by        INTEGER REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_payments_order_idx ON customer_payments (order_id);
CREATE INDEX customer_payments_date_idx ON customer_payments (paid_on);

-- Existing advances become one payment each (method assumed: bank)
INSERT INTO customer_payments (order_id, paid_on, amount, method, method_confirmed, notes, source)
SELECT id, coalesce(paid_on, order_date, (created_at AT TIME ZONE 'Asia/Karachi')::date), advance_paid_pkr, 'bank', false,
       'Recorded before payments were kept one by one', 'migrated'
FROM orders WHERE order_type = 'Sale' AND advance_paid_pkr <> 0;

-- Payments -> orders.advance_paid_pkr
CREATE FUNCTION customer_payments_sync() RETURNS trigger AS $$
DECLARE oid uuid := coalesce(NEW.order_id, OLD.order_id);
BEGIN
  PERFORM set_config('koko.payments_sync', '1', true);
  UPDATE orders SET advance_paid_pkr = coalesce((SELECT sum(amount) FROM customer_payments WHERE order_id = oid), 0)
  WHERE id = oid AND advance_paid_pkr IS DISTINCT FROM coalesce((SELECT sum(amount) FROM customer_payments WHERE order_id = oid), 0);
  IF TG_OP = 'UPDATE' AND NEW.order_id <> OLD.order_id THEN
    UPDATE orders SET advance_paid_pkr = coalesce((SELECT sum(amount) FROM customer_payments WHERE order_id = OLD.order_id), 0) WHERE id = OLD.order_id;
  END IF;
  PERFORM set_config('koko.payments_sync', '', true);
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER customer_payments_sync AFTER INSERT OR UPDATE OR DELETE ON customer_payments FOR EACH ROW EXECUTE FUNCTION customer_payments_sync();

-- The order screens still write advance_paid_pkr: each change becomes a payment row (method to confirm)
CREATE FUNCTION orders_advance_to_payment() RETURNS trigger AS $$
DECLARE diff numeric := NEW.advance_paid_pkr - CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.advance_paid_pkr END;
BEGIN
  IF diff <> 0 AND coalesce(current_setting('koko.payments_sync', true), '') <> '1' THEN
    INSERT INTO customer_payments (order_id, paid_on, amount, method, method_confirmed, notes, source, created_by)
    VALUES (NEW.id, (now() AT TIME ZONE 'Asia/Karachi')::date, diff, 'bank', false,
            CASE WHEN NEW.status = 'Paid' AND diff > 0 THEN 'Final payment, recorded when the order was marked Paid' ELSE 'Recorded on the order screen' END,
            'order_screen', NEW.updated_by);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER orders_advance_to_payment AFTER INSERT OR UPDATE OF advance_paid_pkr ON orders FOR EACH ROW EXECUTE FUNCTION orders_advance_to_payment();

-- ── Postings waiting for a retry ───────────────────────────────────────
CREATE TABLE fin_post_exceptions (
  source_type  TEXT NOT NULL,                  -- order, reseller
  source_id    TEXT NOT NULL,
  label        TEXT,                           -- SO-000123, Collage Fashions
  error        TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 1,
  first_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_type, source_id)
);
