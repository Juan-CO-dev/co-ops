# Vendor Directory Admin — Design

**Date:** 2026-06-25
**Phase:** Item/Inventory Spine — the outward march, step 3 (first slice). Activates the dormant vendor scaffold.
**Status:** draft, pending review

---

## Goal

Fill the existing **501-stub** vendor admin (`app/admin/vendors/*`, `app/api/admin/vendors/*`) with a real **vendor directory** module: GM+ full CRUD of the shared vendor directory, AGM+ trivial edits. This is the foundation SKUs (next slice) + ordering hang off of.

## Ground truth
- `vendors`: 1 row (`"TBD - Reassign"` placeholder). Cols: name, category, contact_person/email/phone, ordering_email/url/days, payment_terms, account_number, notes, active, created_at/by. **No updated_at/by** (migration 0090 adds them).
- Vendor admin is **not built** — `route.ts`/`[id]/route.ts` return 501; `page.tsx`/`[id]/page.tsx` are stubs. This slice fills them.
- `vendors_update_trivial` RLS policy exists (AGM+ may update a vendor row); the **column split is enforced app-layer** (RLS can't do per-column). Confirm the policy at build.
- The 24 SKUs + the TBD placeholder stay as-is — SKU admin + remapping is the next slice.

## The trivial/full split (locked in AGENTS.md)
- **Trivial — AGM+ (≥6):** `contact_person`, `contact_email`, `contact_phone`, `ordering_email`, `ordering_url`, `notes`.
- **Full — GM+ (≥7):** the above PLUS `name`, `category`, `ordering_days`, `payment_terms`, `account_number`, `active`.
- **Create + deactivate — GM+ (≥7).**

## Architecture (mirror the User Management module)

### Migration 0090
`alter table vendors add column updated_at timestamptz; add column updated_by uuid references users(id);` (nullable; no backfill — edits set them going forward). Captured as `supabase/migrations/0090_vendors_updated_meta.sql`.

### Lib `lib/admin/vendors.ts` (new)
- `loadVendors(actor)`: list active + inactive vendors (AGM+ readable; the page gates ≥6). Returns a `VendorView[]` (id, name, category, contacts, ordering_*, payment_terms, account_number, active, ...).
- `createVendor(actor, input)`: GM+ only. Insert; `created_by`/`updated_by` = actor. Audit `vendor.create`.
- `updateVendor(actor, { id, changes })`: **column-split enforced** — if `changes` touches any full-only column, require GM+ (else `AdminVendorError(403, "forbidden")`); trivial-only changes allow AGM+. Set `updated_at`/`updated_by`. Audit `vendor.full_profile_edit` (full) or a trivial action (reuse `vendor.full_profile_edit` with a `scope: "trivial"|"full"` metadata, OR a dedicated trivial code — decide at build; AGENTS.md notes the split but not a separate audit action, so reuse `vendor.full_profile_edit` with metadata scope). Check `rowCount`/`error`.
- `deactivateVendor(actor, { id })`: GM+. `active=false` (append-only, never delete). Audit `vendor.deactivate`. (Reactivate = `vendor.activate`, also GM+ — include both directions via the active toggle.)
- New typed error `AdminVendorError` mirroring `AdminTemplateError`.

### Routes (fill the stubs)
- `app/api/admin/vendors/route.ts`: `GET` (list, AGM+) + `POST` (create, GM+).
- `app/api/admin/vendors/[id]/route.ts`: `PATCH` (update — trivial/full split; the lib enforces the level per changed columns, but the route should also gate the floor at AGM+ + step-up) + `DELETE`/PATCH for deactivate (GM+).
- Each self-gates `requireSession → level floor → assertStepUp(tier)`. **Step-up:** create/deactivate/full-edit = Tier B (they're destructive); a trivial-only edit = Tier A. (Mirror how User Management tiers create/role-change vs lighter edits.)
- Leave `[id]/items/route.ts` (SKUs) stubbed — next slice.

### Pages
- `app/admin/vendors/page.tsx`: list (name + category + active badge) + an "Add vendor" affordance (GM+). Inactive vendors shown muted with a reactivate.
- `app/admin/vendors/[id]/page.tsx`: edit form — full fields for GM+, only trivial fields editable for AGM+ (others read-only). Deactivate/reactivate (GM+).
- Both under the admin shell (gate ≥6). EN+ES i18n. Add a Vendors card to the `/admin` hub.

## Testing
`npx tsc --noEmit` + `npm run build` + throwaway tsx smokes (deleted):
- create a throwaway vendor (GM+ actor) → appears in `loadVendors`; trivial update as an AGM-level actor succeeds; a full-field update as AGM-level is rejected (403); GM+ full update succeeds + sets updated_by; deactivate flips active. Clean up (hard-delete the throwaway vendor — no FK refs since no SKUs attached).
- Operator smoke (Juan, preview): rename "TBD - Reassign" / add a real vendor; confirm AGM sees only trivial fields editable.

## Open decisions (your review)
- **D1 — trivial-edit audit action.** Reuse `vendor.full_profile_edit` with `metadata.scope = "trivial"|"full"` (no new action), vs a dedicated `vendor.trivial_edit`. *Recommend reuse + scope metadata* (AGENTS.md defines the split but not a second action; keeps the registry lean).
- **D2 — list visibility floor.** Vendor *directory* readable at AGM+ (≥6, the admin shell floor) — everyone who reaches /admin sees vendors; edit is gated per the split. Confirm (vs GM+-only to even view).

## Out of scope (next slices)
- SKU (vendor_items) admin + remapping the 24 placeholders + manual-SKU (nullable vendor_id) + per-location SKU (location_id) schema. Next slice.
- Ordering, receiving, on-hand, cost/yield — later steps.
