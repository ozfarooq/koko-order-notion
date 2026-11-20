-- 011: automatic reseller codes. Each reseller has its own prefix and running number, e.g.
-- Fashion Collage: KOATLR-041, KOATLR-042 … Outfits handed over without a code get the next
-- number; the till barcode adds the size (KOATLR-041-S). No prefix = no automatic codes.

ALTER TABLE resellers ADD COLUMN code_prefix TEXT CHECK (code_prefix ~ '^[A-Z0-9][A-Z0-9-]{0,19}$' AND code_prefix !~ '-$');
ALTER TABLE resellers ADD COLUMN next_code INTEGER NOT NULL DEFAULT 1 CHECK (next_code BETWEEN 1 AND 99999);
