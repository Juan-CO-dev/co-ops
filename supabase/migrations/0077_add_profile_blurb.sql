-- Migration 0077_add_profile_blurb
-- Applied via Supabase MCP apply_migration on 2026-06-18.
-- Canonical reference: docs/superpowers/specs/2026-06-18-profile-blurb-design.md
--
-- Adds the optional AGM+-editable "about me" profile blurb. Nullable text,
-- bounded at 500 chars by a CHECK (defense-in-depth behind the route's own
-- length validation). No RLS change: users_update_self already permits a user
-- to UPDATE columns on their own row; the AGM+ write gate is app-layer in
-- PATCH /api/users/me/profile-blurb.

ALTER TABLE users ADD COLUMN profile_blurb text;

ALTER TABLE users ADD CONSTRAINT users_profile_blurb_len_chk
  CHECK (profile_blurb IS NULL OR char_length(profile_blurb) <= 500);
