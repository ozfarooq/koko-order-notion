# Koko Atelier CRM: Rename and Inventory Phase 1 Spec

2026-11-18 · Omer

## Overview

This phase renames the app to **Koko Atelier CRM** and adds a studio inventory that tracks every physical piece Koko makes ahead of an order. The spec is written to be handed to Claude Code in the `ozfarooq/koko-order-notion` repo.

**Business model it must fit**

- **Customer orders are stitch-to-order.** A retail or website order never takes a piece from stock. It is tracked by the existing order statuses (New, In Tailoring, Ready, and so on). Inventory does not change when a customer order is created.
- **Reseller stock is made in advance.** Pieces for Collage Dubai and FPL are stitched in batches, held at the studio, then handed over. Reseller stock already exists today as `consignment_items` (one row per piece, statuses At Store, Sold, Paid, Returned).
- **Shoot samples.** One sample piece per outfit is made for the photoshoot. It moves between the studio, the shoot and store displays, and is later sold, sent to a store or archived.
- **Returns come back to the studio.** A piece a reseller returns becomes studio stock that can be resent or sold.
- **Sizes:** X-Small, Small, Medium, Large, X-Large (the existing `SIZE_OPTIONS` values without Custom).

**In scope:** rename, studio piece register, production batches, samples, links to handovers and reseller returns, the Inventory page, piece history.

**Out of scope (later phases):** raw materials (fabric, trims), bill of materials, cost per piece, accounting entries.

## Part A: Rename to Koko Atelier CRM

The rename touches five files and changes no behaviour. The repo name and the Vercel URL stay as they are.

| File | Change |
| --- | --- |
| `index.html` | `<title>` becomes `Koko Atelier CRM`; add `<meta name="application-name">` and `<meta name="apple-mobile-web-app-title">` with the same value |
| `package.json`, `package-lock.json` | `"name": "koko-order-notion"` becomes `"koko-atelier-crm"` (both places in the lock file) |
| `src/components/Layout.jsx` | In `Logo` (expanded sidebar) and the phone top bar, add a small `CRM` tag after the wordmark: `<span className="rounded border border-line-strong px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.18em] text-muted">CRM</span>` |
| `src/pages/Login.jsx` | Same `CRM` tag after the wordmark in the logo band (slightly larger: `px-2 text-xs tracking-[0.2em]`); footer reads `Koko Atelier CRM © {year}` |

Keep customer-facing text as "Koko Atelier": PDF receipts, reseller statements, product sheets and the public `/board`. Customers and stores should see the brand, not the internal tool name.

**Done when:** `npm run build` passes, the browser tab and an iPhone home-screen shortcut both read "Koko Atelier CRM", and the tag shows in light and dark mode.

## Part B: Data model (migration 008)

Add one migration, `db/migrations/008_inventory.sql`, with two tables and a trigger. Apply it with `node scripts/migrate.js`. Do not edit `db/schema.sql`; add a line to its header comment listing 008.

**Design choices**

- One row per physical piece, the same pattern `consignment_items` already uses.
- Reseller stock is still read from `consignment_items`. A studio piece links to the consignment piece it became, through `consignment_item_id`, so its whole life is traceable.
- Existing handovers are not backfilled. Their pieces stay visible through the reseller screens. Use an Opening count (below) to load what is physically at the studio today.
- Every status change is written to `stock_movements` by a trigger, so history cannot be skipped by any code path.

```sql
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
```

**Status meanings**

| Status | Where the piece physically is |
| --- | --- |
| In Production | Being cut, stitched or embroidered |
| At Studio | Finished and available at the studio |
| At Shoot | With the photographer or stylist (samples) |
| With Reseller | Handed over; the linked consignment piece holds its store status |
| Sold | Sold through a reseller or directly to a customer |
| Archived | Kept, not for sale (old samples) |
| Damaged | Written off; the reason goes in the movement note |

## Business rules and flows

Each flow below names what happens to `stock_pieces`. Every write sets `updated_by` (or `created_by`) and, where a reason exists, `move_note`, so the trigger records who moved what and why.

Returned pieces come back to At Studio, so one piece can go to a second store. Customer orders never appear here because they are stitched to order.

**1. Production batch (reseller stock)**

1. The user picks an outfit and enters a quantity per size, for example OPHÉRA: Small 1, Medium 2, Large 1.
2. One `stock_pieces` row is created per unit with `kind = 'Stock'`, `source = 'Made'`, `status = 'In Production'` (or `'At Studio'` if the pieces are already finished), and `made_on` set.
3. "Mark ready" moves selected In Production pieces to At Studio.

**2. Shoot sample**

1. "Add sample" creates one piece with `kind = 'Sample'` for the outfit and size chosen.
2. A sample can move between At Studio, At Shoot and With Reseller (store display). `location_note` says who has it.
3. At season end it becomes Sold (sample sale), Archived, or switches to `kind = 'Stock'` to be handed over like normal stock.
4. The overview flags any active outfit in the latest collection that has no sample. Allow more than one sample per outfit, but show a warning when adding a second.

**3. Handover to a reseller (change to ****`createConsignment`****)**

1. For each unit in the handover, take the oldest studio piece that matches product and size, with `kind = 'Stock'` and `status = 'At Studio'` (first in, first out, by `made_on` then `created_at`).
2. When a piece is taken, set `status = 'With Reseller'`, `consignment_item_id` = the new consignment piece, `move_note = 'Handover to <reseller> on <date>'`.
3. If no studio piece matches, still record the handover as today, and create a new stock piece directly as With Reseller (`source = 'Made'`) linked to the consignment piece. Old handovers keep working and every new reseller piece has a studio record.
4. Do the consignment insert and the stock updates in one `transaction()` so a failure leaves nothing half-done.
5. The response adds `fromStudio` (units taken from stock) and `newlyMade` (units with no studio piece), and the toast shows both.

**4. Reseller status sync**

Whenever a consignment piece's status changes (in `updateConsignmentItem`, `recordReturns` and statement entry), sync its linked stock piece:

| Consignment status | Linked stock piece becomes |
| --- | --- |
| At Store | With Reseller |
| Sold or Paid | Sold |
| Returned | At Studio, `move_note = 'Returned by <reseller>'` |

A returned consignment piece with no linked stock piece (from an old handover) creates a new stock piece: `source = 'Reseller return'`, `status = 'At Studio'`, linked to that consignment piece. Undoing a return (Returned back to At Store) moves the stock piece back to With Reseller. Write this once as a helper, `syncStockFromConsignment(consignmentItemIds, user)`, and call it from all three places.

**5. Direct sale of a studio piece**

A studio piece (stock or sample) can be sold to a walk-in or online customer. The user marks it Sold and optionally enters an order number (`SO-000xxx`); the server resolves it to `order_id`. Creating a customer order never takes stock on its own; this link is always made by hand.

**6. Opening count and adjustments**

- **Opening count:** the same Add pieces form with `source = 'Opening count'` and `status = 'At Studio'`, used once to load what is at the studio today.
- **Customer return:** `source = 'Customer return'`, for a stitched piece a customer sent back that can be resold.
- **Damaged or lost:** status Damaged with a required `move_note`.
- **Delete** is allowed only for a piece with no `consignment_item_id` and no `order_id`, created in the last 7 days. It is for typing mistakes; anything older is moved to Damaged or Archived so history stays.

## API and data layer

Put the new data functions in a new module, `lib/inventory.js`, following the pattern of `lib/resellers.js` (its own `neon` handle, `HttpError`, `blank` and `num` imported from `db.js`). Register routes in `lib/router.js` and audit every write with `auth.audit`, as existing routes do.

| Method and path | Permission | Purpose |
| --- | --- | --- |
| `GET /inventory` | `inventory:read` | Overview: one row per product with counts by status and size, reseller At Store counts from `consignment_items`, and sample status |
| `GET /inventory/pieces?status=&kind=&productId=&q=` | `inventory:read` | Piece list with product name, image, collection, linked reseller and order number |
| `POST /inventory/pieces` | `inventory:write` | Add pieces: `{ productId, sizes: { Small: 1, Medium: 2 }, kind, status, source, madeOn, locationNote, notes }`; returns `{ created }` |
| `PATCH /inventory/pieces/:id` | `inventory:write` | Edit `status`, `kind`, `locationNote`, `notes`, `moveNote`, `orderNumber` |
| `POST /inventory/pieces/move` | `inventory:write` | Bulk status change: `{ pieceIds, status, moveNote }` (Mark ready, send to shoot) |
| `GET /inventory/pieces/:id/history` | `inventory:read` | Movements, newest first, with user names |
| `DELETE /inventory/pieces/:id` | `inventory:write` | Delete a mistake (rules in flow 6) |
| `GET /inventory/available` | `fc:write` | `[{ productId, size, count }]` of At Studio stock, for the handover form |

**Validation rules (server side)**

- `PATCH` and `move` must not set With Reseller by hand; only a handover does that. They also refuse to change a piece that is With Reseller; the reseller screens own it.
- Damaged requires a `moveNote`.
- `orderNumber` must match an existing order or the request fails with 400 `Order SO-000xxx not found`.
- Sizes outside the five standard sizes are refused in `POST /inventory/pieces` (Custom is accepted only from handovers, for older data).
- Quantities per size: whole numbers from 0 to 50; at least one unit in total.

**Changes to existing functions**

- `db.createConsignment`: flow 3, inside one `transaction()`.
- `db.updateConsignmentItem`, `resellers.recordReturns`, `resellers.enterStatement`: call `syncStockFromConsignment` after the status update.
- `lib/dashboard.js` (optional): add studio stock and in-production counts to the dashboard payload.

**Overview query shape** (one row per product)

```json
{
  "productId": 12, "product": "OPHÉRA", "collection": "VÉLORA", "imageUrl": "...",
  "inProduction": 2,
  "atStudio": { "X-Small": 0, "Small": 1, "Medium": 2, "Large": 0, "X-Large": 0 },
  "atResellers": [{ "resellerId": 1, "name": "Collage Dubai", "count": 3 }],
  "samples": [{ "id": "...", "size": "Medium", "status": "At Shoot", "locationNote": "With photographer" }],
  "soldLast30": 1
}
```

## UI

All screens reuse the existing kit (`PageHeader`, `StatCard`, `Modal`, `Field`, `Segmented`, `EmptyState`, `SkeletonRows`, `ErrorBanner` from `src/ui/kit.jsx`), the "Minimal Yet Warm" tokens and `ProductPicker`. They must work on a phone first, like the rest of the app.

**Navigation (****`src/app/nav.js`****)**

- Add `inventory: true` to `FEATURES`.
- New section **Studio** between Retail and Resellers, with one item: Inventory, `/inventory`, icon `Boxes` from lucide-react, shown when `can('inventory:read')`.
- Add the route in `src/App.jsx`: lazy-loaded `pages/inventory/Inventory.jsx` wrapped in `<Require permission="inventory:read">`. The command palette picks it up from the nav.
- Add API helpers to `src/data/storage.js`: `getInventory`, `getStockPieces`, `addStockPieces`, `updateStockPiece`, `moveStockPieces`, `getStockHistory`, `deleteStockPiece`, `getAvailableStock`.

**Inventory page: header and stats**

- `PageHeader` eyebrow "Studio", title "Inventory", subtitle "Pieces made ahead of orders: reseller stock and shoot samples".
- Actions: **Add pieces** (primary) and **Add sample** (secondary), only with `inventory:write`.
- Four `StatCard`s: At studio, In production, At resellers, Samples out (At Shoot plus samples With Reseller).
- `Segmented` tabs: **Overview**, **Pieces**, **Samples**.

**Overview tab**

- Collection filter (default: newest collection) and a "Show outfits with no stock" toggle.
- One row per outfit: thumbnail, name, In production count, a size strip `XS S M L XL` with the At Studio count under each (0 shown faint), At resellers as chips per store ("Collage 3"), and a sample badge (status or "No sample" in the warning tone).
- On a phone, the row becomes a card with the size strip under the name.
- Tapping a row opens the Pieces tab filtered to that outfit.

**Pieces tab**

- Filters: status (multi-select chips, default In Production and At Studio), kind, search by outfit name.
- List rows: image, outfit, size, kind badge, status pill, location note, "made 12 Nov", and the linked reseller or order number.
- Checkbox selection with a sticky bar: **Mark ready**, **Send to shoot**, **Move to studio**, **Mark damaged** (asks for a reason).
- Tapping a piece opens the **Piece modal**: status select (With Reseller hidden), kind, location note, notes, order number field when status is Sold, a move-note field, and the History list (date, from → to, note, user). Delete button only when allowed.
- Add pill colours for the new statuses in `storage.js`, next to `FC_STATUS_OPTIONS`: In Production amber, At Studio gold, At Shoot plum, With Reseller sky, Sold green, Archived stone, Damaged rose.

**Samples tab**

- A grid of the newest collection's outfits: photo, sample size, status, location note. Outfits with no sample show an "Add sample" button.

**Add pieces modal**

- `ProductPicker` for the outfit, then five steppers (XS to XL), each 0 by default, with the total shown in the footer.
- Fields: Status (In Production or At Studio), Source (Made, Opening count, Customer return), Made on (date, default today), Notes.
- Add sample opens the same modal with Kind fixed to Sample and a single size select instead of steppers.

**Handover form (****`src/pages/resellers/Handovers.jsx`****)**

- Load `getAvailableStock()` when the form opens.
- Each line shows "3 at studio" next to the size select, and "none at studio, will be recorded as newly made" when the quantity exceeds what is available. This is a hint only and never blocks saving.
- After saving, the toast reads "Handover recorded · 4 pieces (3 from studio stock)".
- Note: the handover form's default size is `Medium`; keep that.

## Permissions

Add two permissions in `lib/auth.js` `PERMISSIONS`. Owner already has `*`.

| Role | inventory:read | inventory:write |
| --- | --- | --- |
| owner | yes | yes |
| manager | yes | yes |
| staff | yes | yes |
| reseller | no | no |

Staff get write access because studio staff record batches and samples. Resellers never see studio stock.

## Build order

1. Part A rename, as its own commit.
2. Migration 008, then `node scripts/migrate.js --status` and apply.
3. `lib/inventory.js` and the routes, including `syncStockFromConsignment`.
4. Hook handovers, returns and statements into the sync.
5. Storage helpers, nav entry, route, and the Inventory page (Overview, Pieces, Samples, modals).
6. Handover form stock hint.
7. Opening count: enter today's studio stock and samples by hand.

One branch per step group, merged into master the way earlier phases were (`feat: Phase 6``:`` studio inventory`).

## Acceptance checklist

- Tab title, home-screen name and `CRM` tag show "Koko Atelier CRM"; receipts and statements still say "Koko Atelier"
- Adding MOKA Small 1, Medium 2 creates 3 pieces In Production, each with a movement row
- Mark ready moves them to At Studio; the overview size strip shows S 1, M 2
- A handover of MOKA Medium × 3 takes the 2 studio pieces (With Reseller, linked) and creates 1 newly made piece; toast says "3 pieces (2 from studio stock)"
- Marking one of those consignment pieces Sold sets its stock piece to Sold; Paid keeps it Sold
- Recording a return sets the stock piece back to At Studio with note "Returned by Collage Dubai"
- Returning an old (pre-008) consignment piece creates a new At Studio piece with source Reseller return
- A sample moved to At Shoot with a location note shows under Samples out
- Marking a piece Sold with an unknown order number fails with a clear message
- Damaged without a reason is refused
- A reseller login gets 403 on `/api/inventory` and sees no Studio menu
- Staff can add pieces; every write appears in the audit trail
- Customer order create, edit and delete do not change any stock piece
- `npm run build` passes; pages work in light and dark mode and on a phone

## Prompt for Claude Code

Paste this into Claude Code in VS Code, at the repo root, with this document saved as `docs/inventory-phase-1.md`:

```markdown
Read docs/inventory-phase-1.md in full, then read lib/db.js, lib/resellers.js,
lib/router.js, lib/auth.js, src/app/nav.js, src/App.jsx, src/data/storage.js,
src/pages/resellers/Handovers.jsx and src/ui/kit.jsx to learn the patterns.

Implement the spec in the build order it gives. Rules:
- Follow existing code style: neon tagged templates, HttpError, auth.audit on
  every write, the kit components and Tailwind tokens.
- Never edit db/schema.sql except its header comment; schema changes go in
  db/migrations/008_inventory.sql.
- Customer orders are stitch-to-order: nothing in the order flow may touch
  stock_pieces.
- Commit after each build-order step with a clear message. Run npm run build
  before each commit.
- When done, walk through the acceptance checklist and tell me which items
  you verified and how.
```
