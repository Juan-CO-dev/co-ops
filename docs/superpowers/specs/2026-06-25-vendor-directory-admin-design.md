# Vendor Directory Admin — Design (v2, redesigned per Juan's review of #94)

**Date:** 2026-06-25
**Phase:** Item/Inventory Spine — outward march, step 3. Now a **3-slice mini-arc**.
**Status:** v2 draft (supersedes #94's single-contact/free-text model), pending review

---

## Why v2
#94's first cut (single contact + single ordering block, free-text category, GM/AGM trivial-full split) was reviewed; Juan reshaped it. Superseded. The vendor work splits into:
- **Slice A — vendor directory (this spec):** core fields + **category from a shared registry** + **multi-contact + multi-ordering-detail** tables + the revised authority ladder.
- **Slice B — ordering calendar:** per-vendor **order-days + delivery-days** + an **aggregated, color-coded landing-page calendar** (what to order when, 2 colors/vendor).
- **Slice C (later) — SKU catalog + the SKU→portioned-item BOM** ("see what a vendor's cases convert into on the line").

---

## Decisions (Juan-locked)

**Category — a shared `categories` registry, adopted incrementally.** A new `categories` table seeded to ALIGN with the prep sections + line extras: `Veg, Cooks, Sides, Sauces, Slicing, Misc, Paper, Cleaning` (+ MoO+ add-new). Vendors reference it now; **items + the coming inventory report adopt the same list** as they're built; `prep_sections` stays as-is (it carries prep render shape/columns) and is reconciled into this taxonomy when the inventory report defines the requirement. The point: one category vocabulary so the whole system stays consistent. (Same "enumerate categorical free-text via registries" principle as units.)

**Contacts + ordering details — separate multi-row tables, ≥1 each.** A vendor has N contacts + N ordering details. AGM+ **appends**; GM+ **edits/removes**; the last contact + last ordering detail can't be removed (min 1 each).

**Authority ladder:**
- **MoO+ (≥8):** delete/deactivate a vendor + **full edit** of the core identity/financial fields (name, category, payment_terms, account_number).
- **GM+ (≥7):** **add** a vendor (sets all fields at creation) + **light edit** (notes) + **edit/remove** contacts & ordering details + add-category-to-registry.
- **AGM+ (≥6):** **append** a new contact or ordering detail only (add-only; editing/removing existing = GM+).
- (Interpretation to confirm: post-creation editing of name/category/payment/account is MoO+; a GM creates freely but changing those later is MoO+. Flagged below.)

**Ordering days = Slice B** (not A). The aggregated landing calendar is part of B.

---

## Architecture (Slice A)

### Migrations
- **0091 `categories`:** `id, slug (unique), label, label_es, active, display_order, audit`. Seeded: Veg/Cooks/Sides/Sauces/Slicing/Misc/Paper/Cleaning (slugs align with prep_sections slugs where they overlap). RLS deny-all (admin via service-role). MoO+ add-new (a `category.create` action + route, mirroring units' add-new).
- **0092 `vendor_contacts`:** `id, vendor_id FK, name, email, phone, display_order, active, audit`. RLS deny-all.
- **0093 `vendor_ordering_details`:** `id, vendor_id FK, method (text: email|url|phone|portal|other), value (text — the address/url/number), label, display_order, active, audit`. RLS deny-all.
- **`vendors.category_id`** (nullable FK → categories) added; backfill the 1 placeholder. The legacy single `contact_*`/`ordering_*` + free-text `category` columns go **vestigial** (left in place; the new tables/FK are the truth). Migrate the placeholder's existing single contact/ordering into the new tables.

### Lib `lib/admin/vendors.ts` (rework)
- `loadVendors` / `getVendor` now hydrate `contacts: VendorContact[]` + `orderingDetails: VendorOrderingDetail[]` + `category` (from categories).
- `createVendor` (GM+): core + category_id; seed the first contact + first ordering detail in the same call (min-1 satisfied at creation).
- `updateVendorCore` (MoO+): name/category_id/payment_terms/account_number. `updateVendorLight` (GM+): notes. (Or one `updateVendor` that gates per-field-group: core→MoO+, notes→GM+.)
- Contacts: `addVendorContact` (AGM+ append), `updateVendorContact` (GM+), `removeVendorContact` (GM+; **block if it's the last active contact** → `AdminVendorError(400, "last_contact")`).
- Ordering details: `addVendorOrderingDetail` (AGM+), `updateVendorOrderingDetail` (GM+), `removeVendorOrderingDetail` (GM+; block last → `last_ordering_detail`).
- `deactivateVendor` (MoO+).
- `loadCategories` + `addCategory` (MoO+).
- Audits: `vendor.create`, `vendor.full_profile_edit`, `vendor.deactivate`/`activate` (existing) + new `category.create` (+ contact/ordering changes audit under `vendor.full_profile_edit` with metadata, or dedicated — decide at build; lean metadata-scoped to keep the registry lean). Emails lowercased.

### Routes
- `vendors` GET (≥6) / POST create (GM+, Tier B).
- `vendors/[id]` GET / PATCH core (MoO+ Tier B) / PATCH light (GM+) / deactivate (MoO+).
- `vendors/[id]/contacts` POST (AGM+) ; `vendors/[id]/contacts/[contactId]` PATCH/DELETE (GM+).
- `vendors/[id]/ordering-details` POST (AGM+) ; `.../[detailId]` PATCH/DELETE (GM+).
- `categories` GET (≥6) / POST (MoO+).
- Each self-gates requireSession → level floor → assertStepUp(tier). The lib is the authority per-action.

### Pages
- `/admin/vendors`: list (name + category badge + active) + Add (GM+).
- `/admin/vendors/[id]`: core fields (editable MoO+; read-only for GM/AGM), notes (GM+); **Contacts** list (+ Add for AGM+, edit/remove for GM+, last-one protected) ; **Ordering details** list (same). Category = dropdown from `categories`.
- `/admin/categories` (or fold into an existing registry admin): MoO+ manage categories.
- EN+ES i18n.

## Testing
tsc + build + throwaway smokes (deleted): create vendor (GM+) seeds first contact+ordering; AGM appends a contact (ok) but can't edit/remove (403) or touch core (403); GM edits/removes a contact but can't remove the last (400 last_contact); MoO edits core + deactivates; category dropdown lists the registry; MoO adds a category. Clean up.

## Open decisions (your review)
- **D1 — GM create vs MoO core-edit.** A GM **creates** a vendor (sets name/category/payment/account at creation) but **post-creation edits** of those core fields are **MoO+** (GM+ light-edits notes + manages contacts/ordering). Confirm that's the intent (vs GM+ can also edit core after create, MoO+ only for delete).
- **D2 — ordering detail shape.** `method` enum (email|url|phone|portal|other) + `value` + `label`. Enough, or do you want explicit fields (ordering_email, ordering_url, …) per detail? *Recommend method+value+label (flexible, one row per channel).*
- **D3 — categories admin home.** A dedicated `/admin/categories` page vs folding category-manage into the checklist-templates Global tab (where sections/units live). *Recommend its own small page now; can move.*

## Out of scope (this slice)
- Order/delivery days + aggregated landing calendar (Slice B).
- SKU catalog + SKU→item BOM visualization (Slice C).
- Reconciling prep_sections into the categories taxonomy (when the inventory report lands).

---

## Addendum (2026-06-25) — multi-classification (per Juan smoke of #95)
A vendor now affects **MULTIPLE categories** (was single category_id) AND has **MULTIPLE order types** (NEW — traditional supply view: Produce/Protein/Dairy/Dry Goods/Paper/Chemical/Beverage/Specialty/Equipment/Other; an `order_types` registry mirroring categories, MoO+ add-new). Migration 0093: `order_types` + `vendor_categories` + `vendor_order_types` join tables (set-membership hard rows; vendors.category_id vestigial, migrated into the join). Authority: classification (categories + order types) management = **GM+** (lighter than identity/financial core, which stays MoO+); set at creation (GM+, ≥1 each required); `setVendorCategories`/`setVendorOrderTypes` replace the set (≥1 enforced); order_types registry add = MoO+. UI: multi-select chips on create + a GM+ "Classification" card on the detail page; list rows show category + order-type badges; taxonomy admin page covers both registries.
