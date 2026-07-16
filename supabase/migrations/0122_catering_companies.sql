-- Migration 0122_catering_companies
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: catering identity arc (Juan-approved 2026-07-16); D19d identity/company
-- model pulled forward from Wave 2. See project_coops_catering_module_state (approved design).
--
-- catering_companies: a first-class, CROSS-LOCATION company account (no location_id — a company
-- can span both stores). claimed_by_user_id/claimed_at are claim-ready columns for the later
-- client portal (a portal sign-up claims the account); the claim FLOW is a portal follow-up.
-- catering_company_domains: the auto-attribution list — a corporate email domain maps to exactly
-- one company (unique active domain). Personal domains (gmail/outlook/...) are NEVER added here;
-- personal-email contacts are hand-attached to a company via catering_customers.company_id.
-- catering_customers becomes the CONTACT: company_id links it to an account; email is the
-- contact identifier (one active contact per email). All writes go via the service-role lib
-- (app-layer authz); RLS is defense-in-depth — staff (L5+) may read, direct client writes denied.

CREATE TABLE public.catering_companies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  notes              text,
  claimed_by_user_id uuid REFERENCES public.users(id),
  claimed_at         timestamptz,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES public.users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES public.users(id)
);
ALTER TABLE public.catering_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_companies_read ON public.catering_companies FOR SELECT
  USING (public.current_user_role_level() >= 5);
CREATE POLICY catering_companies_no_user_insert ON public.catering_companies FOR INSERT WITH CHECK (false);
CREATE POLICY catering_companies_no_user_update ON public.catering_companies FOR UPDATE USING (false);
CREATE POLICY catering_companies_no_user_delete ON public.catering_companies FOR DELETE USING (false);

CREATE TABLE public.catering_company_domains (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.catering_companies(id),
  domain     text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id)
);
-- one company per active domain (a domain auto-attributes to exactly one company)
CREATE UNIQUE INDEX catering_company_domains_one_active
  ON public.catering_company_domains (lower(domain)) WHERE active;
CREATE INDEX catering_company_domains_company ON public.catering_company_domains (company_id);
ALTER TABLE public.catering_company_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY catering_company_domains_read ON public.catering_company_domains FOR SELECT
  USING (public.current_user_role_level() >= 5);
CREATE POLICY catering_company_domains_no_user_insert ON public.catering_company_domains FOR INSERT WITH CHECK (false);
CREATE POLICY catering_company_domains_no_user_update ON public.catering_company_domains FOR UPDATE USING (false);
CREATE POLICY catering_company_domains_no_user_delete ON public.catering_company_domains FOR DELETE USING (false);

-- catering_customers = the contact. Link to a company account; enforce email as the identifier.
ALTER TABLE public.catering_customers ADD COLUMN company_id uuid REFERENCES public.catering_companies(id);
CREATE INDEX catering_customers_company ON public.catering_customers (company_id);
CREATE UNIQUE INDEX catering_customers_one_active_email
  ON public.catering_customers (lower(email)) WHERE active AND email IS NOT NULL;
