-- 012: damaged pieces that can still be sold. A piece stays where it is (usually At Studio) with a
-- Damaged label, what's wrong, and an asking price in PKR. Status 'Damaged' still means written off.

ALTER TABLE stock_pieces ADD COLUMN damaged          BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stock_pieces ADD COLUMN damage_note      TEXT;
ALTER TABLE stock_pieces ADD COLUMN asking_price_pkr NUMERIC(12,2) CHECK (asking_price_pkr >= 0);
