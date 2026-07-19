-- Migration 0134_catering_portal_tokens_hash_unique
-- Applied via Supabase MCP apply_migration on 2026-07-19.
-- Canonical reference: docs/security/2026-07-18-coops-security-hardening.md (finding A3-02 / WA-L2)
--
-- WA-L2: catering_portal_tokens.token_hash had only a non-unique index, yet consumeMagicLink does
-- `rows[0]!` after the compare-and-set UPDATE — assuming at most one live row per hash. Tokens are
-- 256-bit CSPRNG so a natural collision is not a practical threat, but the invariant should be
-- DB-enforced, not assumed. Add a UNIQUE index (verified: zero existing duplicate hashes).

CREATE UNIQUE INDEX catering_portal_tokens_token_hash_key
  ON public.catering_portal_tokens (token_hash);
