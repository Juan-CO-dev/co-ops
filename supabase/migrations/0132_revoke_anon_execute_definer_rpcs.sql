-- Migration 0132_revoke_anon_execute_definer_rpcs
-- Applied via Supabase MCP apply_migration on 2026-07-19 (SECURITY HOTFIX — applied ahead of merge).
-- Canonical reference: docs/security/2026-07-18-coops-security-hardening.md (findings WB3-01 Critical, WB3-02)
--
-- WB3-01 (CRITICAL) + WB3-02: four SECURITY DEFINER RPCs retained the default PUBLIC EXECUTE grant, so
-- any caller holding the public anon key (shipped in the browser bundle) could invoke them directly
-- via PostgREST /rpc. Being SECURITY DEFINER they bypass RLS, and the three operational RPCs trust a
-- caller-supplied p_actor_id — so an UNAUTHENTICATED party could forge actor-attributed, append-only
-- operational + audit writes (flip instance status, supersede real completions, write forged audit
-- rows). Their newer siblings (submit_opening_atomic / submit_phase1_atomic / submit_phase2_atomic /
-- save_phase2_item_atomic / create_opening_instance_atomic) were already service-role-only — these
-- older ones were missed. portal_rate_limit_hit (migration 0131, this hardening pass) had the same gap:
-- an anon could inflate/poison any rate-limit bucket to DoS a victim's legit portal action.
--
-- LESSON (AGENTS.md): `REVOKE EXECUTE … FROM anon` alone does NOT strip the PUBLIC grant — anon still
-- inherits EXECUTE via PUBLIC. Must revoke from PUBLIC (and from anon/authenticated to strip Supabase's
-- explicit role grants). 0131's `REVOKE … FROM anon` was ineffective for exactly this reason.

REVOKE EXECUTE ON FUNCTION public.submit_am_prep_atomic(uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_mid_day_phase1_atomic(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.save_mid_day_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_rate_limit_hit(text, timestamptz, integer) FROM PUBLIC, anon, authenticated;

-- Post-condition (verified): has_function_privilege('anon'|'authenticated', fn, 'EXECUTE') = false;
-- service_role retains EXECUTE (the only legitimate caller — server-side service-role client).
