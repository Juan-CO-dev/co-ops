-- scripts/guide-test/reset-catering-fn.sql
-- SIM ONLY (project jepgzucrvklhqpthowsc). NEVER APPLY TO PRODUCTION (bgcvurheqzylyfehqgzh).
-- NOT a migration: test tooling for the sim, like reset-fn.sql and scripts/sim-*.sql.
--
-- Installs public.guide_test_reset_catering(): clears the catering rows that guide testers and photo
-- walkers make (leads, follow-ups, stage moves, quotes, customers, companies, prep demand) so the next
-- walk starts from the clean board docs/guides/walks/catering.walk.md expects ("No quotes yet.",
-- "No company accounts yet.", no Hill Staffers LLC lead). Called by scripts/guide-test/reset.ts --catering
-- with the sim service-role key. guide_test_reset_day() does not touch catering.
--
-- WHICH ROWS ARE TEST ROWS. The sim seed (scripts/sim/launch-readiness cold-empty recipe,
-- fixtures/manifest.json) loads catering CONFIG only: packages, package items, slot options, pricing and
-- rate rules, allergen types, fulfillment nodes, FAQ, food facts, delivery zones, blackout dates,
-- capacity policy. It empties customers/companies/domains/portal rows (AUTH) and leads, events, quotes,
-- items, options, orders, payments, prep demand (HISTORY) and loads none of them back. Every user on the
-- sim is a sim persona (@sim.co-ops), and testers act only through the app as those personas. So:
--   test lead      = catering_pipeline row created_by a sim persona
--   test quote     = quote on a test lead, or created_by a sim persona, plus every version in its family
--   test order     = catering_orders row on a test lead, or created_by a sim persona
--   test customer  = created_by a sim persona AND no longer referenced by any remaining lead/quote/order/payment
--   test company   = created_by a sim persona AND no remaining customer points at it
--   derived rows   = pipeline events, quote items + options, payments, prep demand, order items and
--                    customer_orders link rows hanging off the rows above; portal sessions/tokens of the
--                    deleted customers. "Follow-ups" are catering_pipeline.follow_up_date, gone with the lead.
-- Never touched: catering CONFIG tables, rows made by the system or a portal customer (created_by null:
-- ezCater intake, Toast catering scan, portal self-serve), ezcater_*, toast_catering_orders (its lead_id
-- is ON DELETE SET NULL), notifications, and audit_log (append-only; the old test audit rows stay).
-- If an ezCater event/order or a customer_feedback row points at a test row, the function refuses
-- instead of guessing (nothing is deleted: the whole call is one transaction).
--
-- Safety pattern mirrors guide_test_reset_day(): sim-persona sentinel, SECURITY DEFINER, pinned
-- search_path, every table schema-qualified, execute revoked from public/anon/authenticated and granted
-- to service_role only.
create or replace function public.guide_test_reset_catering() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare
  testers uuid[];
  leads   uuid[];
  quotes  uuid[];
  items   uuid[];
  orders  uuid[];
  custs   uuid[];
  emails  text[];
  comps   uuid[];
  n int;
  counts jsonb := '{}'::jsonb;
begin
  if not exists (select 1 from public.users where email = 'maya@sim.co-ops') then
    raise exception 'SIM ONLY: sim persona sentinel missing';
  end if;

  select coalesce(array_agg(id), '{}') into testers from public.users where email like '%@sim.co-ops';

  select coalesce(array_agg(id), '{}') into leads
    from public.catering_pipeline where created_by = any (testers);

  select coalesce(array_agg(id), '{}') into quotes
    from public.catering_quotes where pipeline_id = any (leads) or created_by = any (testers);
  -- root_id always points at version 1 of the family: take every version of a test family.
  select coalesce(array_agg(id), '{}') into quotes
    from public.catering_quotes where id = any (quotes) or root_id = any (quotes);

  select coalesce(array_agg(id), '{}') into items
    from public.catering_quote_items where quote_id = any (quotes);

  select coalesce(array_agg(id), '{}') into orders
    from public.catering_orders where pipeline_id = any (leads) or created_by = any (testers);

  -- Refuse rather than guess when non-test history points at a test row.
  if exists (select 1 from public.ezcater_events where lead_id = any (leads)) then
    raise exception 'guide_test_reset_catering: an ezcater_events row points at a test lead; stop and look';
  end if;
  if exists (select 1 from public.ezcater_orders where lead_id = any (leads)) then
    raise exception 'guide_test_reset_catering: an ezcater_orders row points at a test lead; stop and look';
  end if;
  if exists (select 1 from public.customer_feedback where catering_order_id = any (orders)) then
    raise exception 'guide_test_reset_catering: customer_feedback points at a test catering order; stop and look';
  end if;

  -- children first
  delete from public.catering_prep_demand
   where pipeline_id = any (leads) or quote_id = any (quotes) or created_by = any (testers);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('catering_prep_demand', n);

  delete from public.catering_quote_item_options where quote_item_id = any (items);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('catering_quote_item_options', n);

  delete from public.catering_quote_items where id = any (items);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('catering_quote_items', n);

  delete from public.catering_payments where quote_id = any (quotes);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('catering_payments', n);

  delete from public.customer_orders where catering_order_id = any (orders);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('customer_orders', n);

  delete from public.catering_order_items where order_id = any (orders);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('catering_order_items', n);

  delete from public.catering_orders where id = any (orders);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('catering_orders', n);

  delete from public.catering_quotes where id = any (quotes);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('catering_quotes', n);

  delete from public.catering_pipeline_events where pipeline_id = any (leads);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('catering_pipeline_events', n);

  delete from public.catering_pipeline where id = any (leads);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('catering_pipeline', n);

  -- Customers: only tester-made ones nothing else still points at (pipeline/quotes/orders.customer_id
  -- are NO ACTION; payments.customer_id is SET NULL, so it is checked too rather than silently nulled).
  select coalesce(array_agg(c.id), '{}'), coalesce(array_agg(lower(c.email)) filter (where c.email is not null), '{}')
    into custs, emails
    from public.catering_customers c
   where c.created_by = any (testers)
     and not exists (select 1 from public.catering_pipeline p where p.customer_id = c.id)
     and not exists (select 1 from public.catering_quotes q where q.customer_id = c.id)
     and not exists (select 1 from public.catering_orders o where o.customer_id = c.id)
     and not exists (select 1 from public.catering_payments y where y.customer_id = c.id);

  delete from public.catering_portal_sessions where customer_id = any (custs);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('catering_portal_sessions', n);

  delete from public.catering_portal_tokens where lower(email) = any (emails);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('catering_portal_tokens', n);

  -- catering_companies.claimed_by_customer_id is ON DELETE SET NULL: a kept company claimed by a test
  -- customer just becomes unclaimed.
  delete from public.catering_customers where id = any (custs);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('catering_customers', n);

  select coalesce(array_agg(co.id), '{}') into comps
    from public.catering_companies co
   where co.created_by = any (testers)
     and not exists (select 1 from public.catering_customers c where c.company_id = co.id);

  delete from public.catering_company_domains where company_id = any (comps);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('catering_company_domains', n);

  delete from public.catering_companies where id = any (comps);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('catering_companies', n);

  raise notice 'guide_test_reset_catering: %', counts;
  return counts;
end
$fn$;
revoke all on function public.guide_test_reset_catering() from public, anon, authenticated;
grant execute on function public.guide_test_reset_catering() to service_role;
