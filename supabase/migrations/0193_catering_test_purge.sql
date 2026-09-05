-- Migration 0193_catering_test_purge
-- AUTHORED 2026-09-05. APPLY ON JUAN'S "confirm purge" (given 2026-09-05).
--
-- 0193: physically delete the builder's catering TEST artifacts. Juan's ruling (2026-09-05):
-- the append-only law protects operators' history; test rows made while building are not
-- history and "make the numbers a lie". This is a MIGRATION with a literal manifest — no app
-- code path deletes catering rows, and none is added. Every count is asserted before its
-- DELETE so a drifted prod refuses instead of guessing. One audit row records the ruling.
--
-- Manifest (live counts 2026-09-05): test customers 2 (the two builder emails) · portal test
-- leads 11 (all stage lost) · their events 26 · quotes 11 + orphan staff quote 1 · quote items
-- 42 · quote item options (all under those) · payments 4 (every row) · prep_demand 3 (every row)
-- · portal tokens 25 (every row) · portal sessions 20 (every row) · rate limits (transient).
-- Untouched: the 5 real leads (toast_catering ×2, ezcater ×3) and their 8 events,
-- toast_catering_orders, ezcater_events, audit_log, customer_feedback.

do $$
declare
  v_customers uuid[];
  v_leads     uuid[];
  v_quotes    uuid[];
  v_items     uuid[];
  n int;
  v_options int; v_rate int;
begin
  select coalesce(array_agg(id), '{}') into v_customers
    from public.catering_customers
   where lower(email) in ('juan@complimentsonlysubs.com', 'contactmgb202@gmail.com');
  assert cardinality(v_customers) = 2, format('expected 2 test customers, found %s', cardinality(v_customers));
  assert (select count(*) from public.catering_customers) = 2, 'expected the test customers to be the ONLY customers';

  select coalesce(array_agg(id), '{}') into v_leads
    from public.catering_pipeline
   where lead_source = 'portal' and customer_id = any (v_customers);
  assert cardinality(v_leads) = 11, format('expected 11 test leads, found %s', cardinality(v_leads));
  assert (select count(*) from public.catering_pipeline where id <> all (v_leads)) = 5, 'expected exactly 5 real leads to remain';
  assert (select count(*) from public.catering_pipeline where id <> all (v_leads) and lead_source not in ('toast_catering','ezcater')) = 0,
         'a remaining lead is neither toast nor ezcater — stop and look';

  select coalesce(array_agg(id), '{}') into v_quotes
    from public.catering_quotes
   where pipeline_id = any (v_leads) or id = 'b90fded5-fbd1-4f69-b03e-59c08f707dbb';
  assert cardinality(v_quotes) = 12, format('expected 12 quotes (11 test + orphan), found %s', cardinality(v_quotes));
  assert (select count(*) from public.catering_quotes) = 12, 'expected no other quotes to exist';

  select coalesce(array_agg(id), '{}') into v_items from public.catering_quote_items where quote_id = any (v_quotes);
  assert cardinality(v_items) = 42, format('expected 42 quote items, found %s', cardinality(v_items));

  -- children first
  delete from public.catering_prep_demand where pipeline_id = any (v_leads) or quote_id = any (v_quotes);
  get diagnostics n = row_count; assert n = 3, format('prep_demand: expected 3, deleted %s', n);
  assert (select count(*) from public.catering_prep_demand) = 0, 'prep_demand should be empty after the purge';

  delete from public.catering_quote_item_options where quote_item_id = any (v_items);
  get diagnostics v_options = row_count;

  delete from public.catering_quote_items where id = any (v_items);
  get diagnostics n = row_count; assert n = 42, format('quote_items: expected 42, deleted %s', n);

  delete from public.catering_payments;
  get diagnostics n = row_count; assert n = 4, format('payments: expected 4, deleted %s', n);

  delete from public.catering_quotes where id = any (v_quotes);
  get diagnostics n = row_count; assert n = 12, format('quotes: expected 12, deleted %s', n);

  delete from public.catering_pipeline_events where pipeline_id = any (v_leads);
  get diagnostics n = row_count; assert n = 26, format('pipeline_events: expected 26, deleted %s', n);

  delete from public.catering_pipeline where id = any (v_leads);
  get diagnostics n = row_count; assert n = 11, format('pipeline: expected 11, deleted %s', n);

  delete from public.catering_portal_sessions where customer_id = any (v_customers);
  get diagnostics n = row_count; assert n = 20, format('portal_sessions: expected 20, deleted %s', n);

  delete from public.catering_portal_tokens where lower(email) in ('juan@complimentsonlysubs.com', 'contactmgb202@gmail.com');
  get diagnostics n = row_count; assert n = 25, format('portal_tokens: expected 25, deleted %s', n);
  assert (select count(*) from public.catering_portal_tokens) = 0, 'portal_tokens should be empty after the purge';

  delete from public.catering_portal_rate_limits;
  get diagnostics v_rate = row_count;

  delete from public.catering_customers where id = any (v_customers);
  get diagnostics n = row_count; assert n = 2, format('customers: expected 2, deleted %s', n);

  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
  values (null, null, 'catering.test_data_purge', 'catering_pipeline', null,
    jsonb_build_object(
      'actor_context', 'migration_apply', 'migration', '0193', 'ruling', 'Juan 2026-09-05: physically delete builder test catering data',
      'test_emails', jsonb_build_array('juan@complimentsonlysubs.com', 'contactmgb202@gmail.com'),
      'counts', jsonb_build_object('customers', 2, 'leads', 11, 'pipeline_events', 26, 'quotes', 12, 'quote_items', 42,
                                   'quote_item_options', v_options, 'payments', 4, 'prep_demand', 3,
                                   'portal_sessions', 20, 'portal_tokens', 25, 'rate_limits', v_rate),
      'ids', jsonb_build_object('customers', to_jsonb(v_customers), 'leads', to_jsonb(v_leads), 'quotes', to_jsonb(v_quotes)),
      'remaining_real_leads', 5),
    true);
end $$;
