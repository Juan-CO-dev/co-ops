-- Migration 0078_add_user_locations_active
-- Applied via Supabase MCP apply_migration on 2026-06-20.
-- Canonical reference: docs/superpowers/specs/2026-06-20-user-management-design.md
--   + AGENTS.md "Append-only philosophy is enforced at RLS".

-- C.44 Module 2 (User Management): location assignment removal is modeled
-- append-only as active=false (no DELETE). Every user_locations reader must
-- filter active=true (see lib/session.ts createSession, login-options,
-- lib/profiles.ts, lib/team-metrics.ts, lib/checklists.ts). No RLS change:
-- admin writes use the service-role client, gated app-layer.
ALTER TABLE public.user_locations
  ADD COLUMN active boolean NOT NULL DEFAULT true;
