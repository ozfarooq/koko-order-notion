-- 008: studio inventory. One row per physical piece made ahead of an order
-- (reseller stock, shoot samples, returned pieces). Customer orders are stitch-to-order
-- and never take a piece from here.

CREATE TABLE stock_pieces (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           INTEGER NOT NULL REFERENCES products(id),
  size                 TEXT NOT NULL CHECK (size IN ('X-Small','Small','Medium','Large','X-Large','Custom')),
  kind                 TEXT NOT NULL DEFAULT 'Stock' CHECK (kind IN ('Stock','Sample')),
  status               TEXT NOT NULL DEFAULT 'At Studio' CHECK (status IN
                         ('In Production','At Studio','At Shoot','With Reseller','Sold','Archived','Damaged')),
  source               TEXT NOT NULL DEFAULT 'Made' CHECK (source IN
                         ('Made','Opening count','Reseller return','Customer return')),
  consignment_item_id  UUID UNIQUE REFERENCES consignment_items(id) ON DELETE SET NULL,
  order_id             UUID REFERENCES orders(id) ON DELETE SET NULL,   -- set when sold to a customer
  location_note        TEXT,          -- e.g. 'With photographer Ali', 'Display at Collage'
  notes                TEXT,
  made_on              DATE,
  move_note            TEXT,          -- reason for the latest status change, copied into stock_movements
  created_by           INTEGER REFERENCES users(id),
  updated_by           INTEGER REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_pieces_product_idx ON stock_pieces (product_id, size);
CREATE INDEX stock_pieces_status_idx  ON stock_pieces (status);
CREATE TRIGGER stock_pieces_touch BEFORE UPDATE ON stock_pieces
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE stock_movements (
  id           SERIAL PRIMARY KEY,
  piece_id     UUID NOT NULL REFERENCES stock_pieces(id) ON DELETE CASCADE,
  from_status  TEXT,               -- NULL when the piece was created
  to_status    TEXT NOT NULL,
  note         TEXT,
  user_id      INTEGER REFERENCES users(id),
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_piece_idx ON stock_movements (piece_id, at);

CREATE FUNCTION log_stock_movement() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO stock_movements (piece_id, from_status, to_status, note, user_id)
    VALUES (NEW.id, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
            NEW.status, NEW.move_note, COALESCE(NEW.updated_by, NEW.created_by));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER stock_pieces_log AFTER INSERT OR UPDATE OF status ON stock_pieces
  FOR EACH ROW EXECUTE FUNCTION log_stock_movement();
