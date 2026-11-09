-- 003: staff/reseller accounts, login sessions, and an audit trail of who changed what
--
-- Roles: owner (everything) · manager · staff · reseller (read-only view of their own consignment stock)

CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  username        TEXT NOT NULL,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  password_hash   TEXT NOT NULL,                 -- scrypt, never the password itself
  role            TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff', 'reseller')),
  reseller_id     INTEGER REFERENCES resellers(id),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  failed_logins   INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,                   -- set after repeated wrong passwords
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- a reseller login always belongs to exactly one reseller; staff logins never do
  CONSTRAINT users_reseller_link CHECK ((role = 'reseller') = (reseller_id IS NOT NULL))
);
CREATE UNIQUE INDEX users_username_key ON users (lower(username));
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Only a hash of the session token is stored, so a database leak can't be used to log in
CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Who created / last changed each record
ALTER TABLE orders
  ADD COLUMN created_by INTEGER REFERENCES users(id),
  ADD COLUMN updated_by INTEGER REFERENCES users(id);
ALTER TABLE consignments
  ADD COLUMN created_by INTEGER REFERENCES users(id);
ALTER TABLE consignment_items
  ADD COLUMN updated_by INTEGER REFERENCES users(id);

-- Full history: one row per change (login, order edit, status move, statement entry, user admin…)
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,          -- e.g. order.update, piece.update, user.create, auth.login
  entity      TEXT,                   -- order, piece, consignment, user
  entity_id   TEXT,
  changes     JSONB,                  -- what was sent (passwords never stored)
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX audit_log_at_idx     ON audit_log (at DESC);
