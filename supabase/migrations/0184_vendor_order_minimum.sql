-- Migration 0184_vendor_order_minimum
-- AUTHORED 2026-08-28. NOT YET APPLIED — GATE (LEAD/JUAN).
--
-- 0184: the vendor order minimum — a DISPLAY-ONLY advisory, in the vendor's own words.
--
-- PROVENANCE. Three facts Juan carries in his head and nothing in the schema could hold
-- (2026-08-28, the post-Dynamic-Pars cleanup batch):
--     PFG            "10 case minimum"
--     Leonard Paper  "$350"
--     Trimark        "$350"
-- The DATA is not in this file — see "post-apply authoring" at the bottom.
--
-- ── WHY ONE NULLABLE TEXT COLUMN, AND NOT A STRUCTURED PAIR ─────────────────────────────
-- The three known minimums come in TWO INCOMPATIBLE KINDS: a dollar floor on the invoice
-- and a case-count floor on the order. A structured split (`minimum_kind` + `minimum_value`)
-- would be honest about the shapes we have seen and speculative about the ones we have not
-- — a weight minimum, a per-line minimum, "$350 OR 10 cases", "waived on Tuesdays" — and it
-- would imply an arithmetic nothing computes. NOTHING IN THE SYSTEM READS THIS NUMBER; the
-- walker does not check an order against it, the PO does not refuse under it, Dynamic Pars
-- does not reach for it. It is a fact the person placing the order needs in front of them.
--
-- A text advisory is what we actually know, and it is tenant-shaped: the next restaurant's
-- vendor says "5 case minimum on frozen" and the column holds that without a migration. If a
-- surface ever needs to COMPUTE on a minimum, that is the moment to earn a structured column
-- from real vocabulary — and the text values here are the corpus that would design it.
-- (Same posture 0177 took with vendor_price_history provenance and 0182 with cushion_class:
-- do not pin a vocabulary in DDL before the vocabulary exists.)
--
-- ── ADDITIVE, HONEST-NULL, RLS UNCHANGED ────────────────────────────────────────────────
-- ADD COLUMN IF NOT EXISTS, nullable, no default, no CHECK. NULL means "no minimum on file"
-- — which is the pre-existing meaning of every one of the 18 vendor rows, so there is no
-- backfill and no sentinel. Every existing writer keeps working untouched.
--
-- RLS UNCHANGED. `vendors` keeps exactly the policies it has; this file adds no policy,
-- revokes nothing, and grants nothing. The column is read and written by the service-role
-- admin layer (lib/admin/vendors.ts), whose authority floors are app-layer and unchanged:
-- reading the vendor is AGM+ (≥6) and editing a CORE field is MoO+ (≥8) with Tier-B step-up,
-- because an order minimum is the same KIND of vendor-account fact as payment_terms and
-- account_number and takes the same floor rather than minting a third opinion.
--
-- ── PRE-APPLY DEGRADATION (the 0180/0182/0183 probe precedent) ───────────────────────────
-- The app ships BEFORE this file is applied. PostgREST rejects a WHOLE select when one named
-- column is missing, so naming `order_minimum` unconditionally would 500 /admin/vendors,
-- /admin/vendors/[id] AND the par-pass submit for every deploy between that PR and this gate.
-- `vendorOrderMinimumReady` (lib/vendor-schema-probes.ts) therefore gates both readers:
-- pre-apply the column is absent from the select lists, the admin field does not render (the
-- card says so), the draft-order advisory line does not render, and a write that somehow
-- carried the field REFUSES with a named 503 rather than silently dropping it. The probe
-- caches only the TRUE answer and re-probes while false, so both surfaces light themselves
-- the moment this migration lands — no redeploy, no flag, no stale `false` in a warm lambda.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS order_minimum text NULL;

COMMENT ON COLUMN public.vendors.order_minimum IS
  'DISPLAY-ONLY order minimum, in the vendor''s own words ("$350", "10 case minimum"). '
  'Deliberately unstructured: the known minimums are two incompatible kinds (dollars vs '
  'cases) and NOTHING computes on this value — it is rendered to the person placing the '
  'order and nowhere else. NULL = no minimum on file. If a surface ever needs to compute '
  'against a minimum, design the structured column from the vocabulary these values collect.';

-- ── POST-APPLY AUTHORING (the lead runs this AFTER the ALTER, not as part of it) ────────
--
-- Data is not schema, so Juan's three facts are NOT seeded by this migration — a seeded
-- value would be indistinguishable from a structural default the next time someone reads
-- this file. The three UPDATEs are listed in the PR body, ready to run, and they are ordinary
-- data writes matched on vendor NAME (verify the match returns 1 row each before committing;
-- `vendors.name` carries no unique constraint).
