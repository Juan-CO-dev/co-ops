-- Migration 0124_catering_company_claimed_by_customer
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: lib/catering/companies.ts (claimedByCustomerId) +
--   docs/superpowers/plans/2026-07-16-portal-2-customer-principal-magic-link.md

-- The catering portal's account claimer is a CUSTOMER (catering_customers), not a staff user
-- (the spec's "fix owed"). Rename the placeholder column PR-1 shipped and add the correct FK.
-- catering_companies + catering_customers are empty (0 rows), so this is safe with no data move.
ALTER TABLE catering_companies RENAME COLUMN claimed_by_user_id TO claimed_by_customer_id;
ALTER TABLE catering_companies
  ADD CONSTRAINT catering_companies_claimed_by_customer_fkey
  FOREIGN KEY (claimed_by_customer_id) REFERENCES catering_customers(id) ON DELETE SET NULL;
