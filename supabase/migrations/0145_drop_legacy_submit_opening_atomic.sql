-- 0145 — drop the legacy submit_opening_atomic RPC (Wave 1.5 legacy cuts).
--
-- The C.53 restructure split opening submission into per-phase RPCs
-- (submit_phase1_atomic, 0055; submit_phase2_atomic, C.53 commit A) and the
-- route handlers migrated to them; the legacy batch route
-- (/api/opening/submit) and its lib dispatcher (submitOpening) are deleted in
-- the same PR as this migration. Nothing invokes this function anymore —
-- verified by call-graph trace: the only JS call site was lib/opening.ts
-- submitOpening, whose only caller was the deleted batch route.
--
-- Dropping (not just revoking) removes a SECURITY DEFINER writer that
-- bypassed the per-phase validation contracts (C.54 provenance attestation,
-- §8.4 per-item shape) — dead code that is also live attack surface if any
-- EXECUTE grant path is ever misconfigured. Signature pinned explicitly so a
-- future same-named function is never dropped by accident.
--
-- Append-only law note: this drops a FUNCTION (code), not data. No table,
-- row, or audit history is touched.

DROP FUNCTION IF EXISTS public.submit_opening_atomic(
  uuid,   -- p_opening_instance_id
  uuid,   -- p_actor_id
  jsonb,  -- p_entries
  uuid,   -- p_closing_report_ref_item_id
  boolean,-- p_is_update
  uuid,   -- p_original_submission_id
  jsonb,  -- p_changed_fields
  text,   -- p_ip_address
  text,   -- p_user_agent
  jsonb   -- p_section_verifications
);
