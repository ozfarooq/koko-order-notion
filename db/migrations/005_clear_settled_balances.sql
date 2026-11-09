-- 005: delivered (Paid) orders are fully settled; cancelled/returned orders owe nothing.

-- Keep a record of every advance we change, so it can be reversed from the audit log
INSERT INTO audit_log (action, entity, entity_id, changes)
SELECT 'order.balance_cleared', 'order', id::text,
       jsonb_build_object('previousAdvancePaid', advance_paid_pkr, 'amount', amount_pkr, 'clearedBalance', amount_pkr - advance_paid_pkr,
                          'reason', 'Delivered orders paid in full (migration 005)')
FROM orders WHERE status = 'Paid' AND amount_pkr > advance_paid_pkr;

UPDATE orders SET advance_paid_pkr = amount_pkr WHERE status = 'Paid' AND amount_pkr > advance_paid_pkr;

-- Balance is never due on a cancelled or returned order; the order keeps its amount for the record
ALTER TABLE orders DROP COLUMN balance_due_pkr;
ALTER TABLE orders ADD COLUMN balance_due_pkr NUMERIC(12,2) GENERATED ALWAYS AS (
  CASE WHEN status IN ('Cancelled', 'Returned') THEN 0 ELSE amount_pkr - advance_paid_pkr END
) STORED;
