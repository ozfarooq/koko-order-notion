-- 014: a Finance Manager login (finance screens only; owners keep everything), and cash-flow
-- classes for the contra accounts so non-cash charges (depreciation, write-downs, credit losses)
-- are added back under operating activities in the indirect cash flow statement.

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'manager', 'staff', 'reseller', 'finance'));

UPDATE fin_accounts SET cash_flow_class = 'operating' WHERE system_key IN ('ppe_acc_depreciation', 'inv_nrv_allowance', 'ecl_allowance');
