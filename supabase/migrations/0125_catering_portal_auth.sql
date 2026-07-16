-- Migration 0125_catering_portal_auth
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: lib/portal/{auth,session,magic-link,rate-limit}.ts +
--   docs/superpowers/plans/2026-07-16-portal-2-customer-principal-magic-link.md
--
-- Portal-2: the customer (second-principal) auth substrate. Enforcement is app-layer +
-- service-role (consistent with every catering lib); RLS here is deny-all-to-end-users +
-- current_customer_id() as defense-in-depth.

-- Magic-link tokens — EMAIL-keyed (the account may not exist yet at request time).
CREATE TABLE catering_portal_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,                         -- normalized (trim+lower)
  token_hash   text NOT NULL,                         -- sha256(rawToken)
  name         text,                                  -- optional, carried from intake
  purpose      text NOT NULL DEFAULT 'magic_link' CHECK (purpose IN ('magic_link')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  ip_address   text
);
CREATE INDEX catering_portal_tokens_hash ON catering_portal_tokens (token_hash);
CREATE INDEX catering_portal_tokens_email ON catering_portal_tokens (lower(email));

-- Customer sessions — the second principal's session store.
CREATE TABLE catering_portal_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES catering_customers(id) ON DELETE CASCADE,
  token_hash        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  ip_address        text,
  user_agent        text
);
CREATE INDEX catering_portal_sessions_customer ON catering_portal_sessions (customer_id);

-- In-DB fixed-window rate limiter (D1) — keyed on ip+email+window. Reused by Portal-3.
CREATE TABLE catering_portal_rate_limits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key    text NOT NULL,
  window_start  timestamptz NOT NULL,
  count         int NOT NULL DEFAULT 1,
  UNIQUE (bucket_key, window_start)
);

-- Portal-account state on the contact.
ALTER TABLE catering_customers ADD COLUMN email_verified_at    timestamptz;
ALTER TABLE catering_customers ADD COLUMN last_portal_login_at timestamptz;

-- current_customer_id() — second-principal RLS helper (defense-in-depth; mirrors
-- current_user_id()). SECURITY DEFINER + locked search_path; revoke from anon AND public.
CREATE OR REPLACE FUNCTION current_customer_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'customer_id', '')::uuid
$$;
REVOKE EXECUTE ON FUNCTION current_customer_id() FROM anon;
REVOKE EXECUTE ON FUNCTION current_customer_id() FROM public;

-- RLS: enable with NO permissive policies => zero access for anon/authenticated;
-- service-role bypasses RLS entirely (the app-layer path).
ALTER TABLE catering_portal_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE catering_portal_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE catering_portal_rate_limits ENABLE ROW LEVEL SECURITY;
