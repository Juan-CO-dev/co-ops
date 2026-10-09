-- SQL harness for 0234 (customer profiles + consent). Runs in ONE transaction and ROLLS BACK, so it is
-- safe on the sim project after 0234 is applied (CC runs it there; it passes locally on PGlite).
-- FIXTURES ONLY: every email/phone below is invented (example.com / 555 numbers).
begin;
do $$
declare
  loc uuid; loc2 uuid; actor uuid; a uuid; b uuid; c uuid; r jsonb; imp uuid; n int; s text; v record; sug uuid;
  failed boolean;
begin
  select id into loc from public.locations order by id limit 1;
  insert into public.locations(id, name) values (gen_random_uuid(), 'Harness shop 2') returning id into loc2;
  insert into public.users(id, name, role) values (gen_random_uuid(), 'Harness owner', 'owner') returning id into actor;

  -- Capture fixtures: pointers exist for G1..G4 at loc, G5 does not.
  insert into public.toast_capture_runs(id, location_id, business_date, status, finished_at)
  values (gen_random_uuid(), loc, '2026-10-01', 'completed', now()) returning id into imp;
  for s in select unnest(array['G1','G2','G3','G4']) loop
    insert into public.toast_orders(location_id, order_guid, business_date, content_hash, deleted, voided, excess_food)
    values (loc, 'HARNESS-' || s, '2026-10-01', repeat('0',64), false, false, false) returning id into c;
    insert into public.toast_order_latest_pointers(location_id, order_guid, snapshot_id, business_date, run_started_at, run_id)
    values (loc, 'HARNESS-' || s, c, '2026-10-01', now(), imp);
  end loop;
  c := null; imp := null;

  -- 1. Identity: email first, then phone; no email+phone => skipped; missing pointer => skipped.
  r := public.customer_ingest_orders(loc, jsonb_build_array(
    jsonb_build_object('order_guid','HARNESS-G1','business_date','2026-10-01','email','ana@example.com','phone','+12025550101','full_name','Ana Diaz',
      'first_name','Ana','last_name','Diaz','source','toast_online','channel','online','total_cents',1500,
      'items',jsonb_build_array(jsonb_build_object('name','Crunchy Boi','qty',1)),'cards',jsonb_build_array(jsonb_build_object('brand','VISA','last4','4242'))),
    jsonb_build_object('order_guid','HARNESS-G2','business_date','2026-10-02','phone','+12025550101','full_name','Ana D','source','toast_pos','channel','takeout','total_cents',900),
    jsonb_build_object('order_guid','HARNESS-G3','business_date','2026-10-02','full_name','Nobody','source','toast_pos','channel','dine_in','total_cents',500),
    jsonb_build_object('order_guid','HARNESS-G5','business_date','2026-10-02','email','zed@example.com','source','toast_pos','channel','dine_in','total_cents',500)));
  assert (r->>'linked')::int = 2 and (r->>'skipped')::int = 2 and (r->>'created')::int = 1, 'ingest counts ' || r::text;
  select customer_id into a from public.customer_identifiers where kind='email' and value='ana@example.com';
  assert (select count(*) from public.customer_orders where customer_id = a) = 2, 'phone match attaches to the email profile';
  assert (select full_name from public.customers where id = a) = 'Ana Diaz', 'first name kept, never overwritten';

  -- 2. Name + card never auto-merges: same name, same card, different email => two people.
  r := public.customer_ingest_orders(loc, jsonb_build_array(
    jsonb_build_object('order_guid','HARNESS-G4','business_date','2026-10-03','email','ana.work@example.com','full_name','Ana Diaz','source','toast_online',
      'channel','online','total_cents',700,'cards',jsonb_build_array(jsonb_build_object('brand','VISA','last4','4242')))));
  select customer_id into b from public.customer_identifiers where kind='email' and value='ana.work@example.com';
  assert a <> b, 'name + card must not auto-merge';
  assert (select count(*) from public.customer_card_candidates(array[b])) = 1, 'the shared card is a candidate';
  assert public.customer_suggest_merge(a, b, 0.85, array['same_full_name','shared_card']), 'suggestion filed';
  assert not public.customer_suggest_merge(b, a, 0.85, array['same_full_name','shared_card']), 'one suggestion per pair';
  select id into sug from public.customer_merge_suggestions where customer_a = least(a,b) and customer_b = greatest(a,b);

  -- 3. Bad identifiers and PAN-shaped cards are refused by constraints.
  failed := false;
  begin insert into public.customer_identifiers(customer_id, kind, value, value_sha256, source) values (a,'email','Ana@Example.com',public.customer_sha256('Ana@Example.com'),'x');
  exception when check_violation then failed := true; end;
  assert failed, 'mixed-case email refused';
  failed := false;
  begin insert into public.customer_identifiers(customer_id, kind, value, value_sha256, source) values (a,'phone','2025550101',public.customer_sha256('2025550101'),'x');
  exception when check_violation then failed := true; end;
  assert failed, 'non-E.164 phone refused';
  failed := false;
  begin insert into public.customer_cards(customer_id, brand, last4) values (a,'VISA','4242424242424242');
  exception when check_violation then failed := true; end;
  assert failed, 'a PAN never fits in last4';

  -- 4. CSV import: baseline, idempotent replay, diff with absence = opt-out, newly opted in.
  r := public.customer_consent_import_begin(actor, 'toast_csv_import', repeat('a',64), '2026-10-01', false, 1);
  imp := (r->>'import_id')::uuid;
  r := public.customer_consent_import_chunk(actor, imp, 0, jsonb_build_array(
    jsonb_build_object('email','ana@example.com'), jsonb_build_object('email','bo@example.com','first_name','Bo','last_name','Li')));
  assert (r->>'new_opt_ins')::int = 2 and (r->>'new_customers')::int = 1, 'baseline chunk ' || r::text;
  r := public.customer_consent_import_chunk(actor, imp, 0, '[]'::jsonb);
  assert (r->>'replay')::boolean and (r->>'new_opt_ins')::int = 2, 'a retried chunk replays';
  r := public.customer_consent_import_finish(actor, imp, false);
  assert (r->>'baseline')::boolean and (r->>'new_opt_ins')::int = 2 and (r->>'opt_outs')::int = 0, 'baseline finish ' || r::text;
  r := public.customer_consent_import_begin(actor, 'toast_csv_import', repeat('a',64), '2026-10-01', false, 1);
  assert r->>'state' = 'completed', 'same file = replay';
  assert (select count(*) from public.customer_consent_events) = 2, 'replay writes nothing';
  assert (select count(*) from public.customer_newly_opted_in('2026-01-01', 100)) = 0, 'baseline is never "newly opted in"';

  failed := false;
  begin perform public.customer_consent_import_begin(actor, 'toast_csv_import', repeat('b',64), '2026-09-01', false, 1);
  exception when raise_exception then failed := true; end;
  assert failed, 'an export older than the last import is refused';

  r := public.customer_consent_import_begin(actor, 'toast_csv_import', repeat('c',64), '2026-10-05', false, 1);
  imp := (r->>'import_id')::uuid;
  r := public.customer_consent_import_chunk(actor, imp, 0, jsonb_build_array(
    jsonb_build_object('email','ana@example.com'), jsonb_build_object('email','ana.work@example.com')));
  r := public.customer_consent_import_finish(actor, imp, false);
  assert (r->>'new_opt_ins')::int = 1 and (r->>'opt_outs')::int = 1 and (r->>'unchanged')::int = 1, 'diff ' || r::text;
  select c2.status into s from public.customer_consent_current c2 join public.customer_identifiers i on i.customer_id = c2.customer_id
    where i.value = 'bo@example.com' and c2.channel = 'email';
  assert s = 'opted_out', 'absent from the new list = opted out';
  assert (select count(*) from public.customer_newly_opted_in('2026-01-01', 100)) = 1, 'the profile that opted in later is newly opted in';
  assert (select previous_status from public.customer_newly_opted_in('2026-01-01', 100)) = 'none', 'previous status none';
  assert (select had_orders from public.customer_newly_opted_in('2026-01-01', 100)), 'it had orders before opting in';

  -- 5. Exports: opted-in subjects only; an opt-out drops at once; bo (opted out) never appears.
  assert (select count(*) from public.customer_marketing_export('email')) = 2, 'two opted-in addresses';
  assert not exists(select 1 from public.customer_marketing_export('email') where value = 'bo@example.com'), 'opt-out never exported';
  assert (select count(*) from public.customer_marketing_export('sms')) = 0, 'no sms consent, no phones';
  -- an explicit unsubscribe (newer) beats the list
  r := public.customer_consent_import_begin(actor, 'toast_csv_import', repeat('d',64), '2026-10-06', true, 1);
  imp := (r->>'import_id')::uuid;
  r := public.customer_consent_import_chunk(actor, imp, 0, jsonb_build_array(jsonb_build_object('email','ana.work@example.com','status','opted_out'),
    jsonb_build_object('email','ana@example.com','status','opted_in')));
  r := public.customer_consent_import_finish(actor, imp, false);
  assert (r->>'opt_outs')::int = 1 and (r->>'unchanged')::int = 1, 'explicit status ' || r::text;
  assert not exists(select 1 from public.customer_marketing_export('email') where value = 'ana.work@example.com'), 'opt-out drops immediately';

  -- 6. Merge confirm: b into a; orders and cards move; consent read through merged_into.
  r := public.customer_merge(actor, sug, a);
  assert (r->>'changed')::boolean, 'merged';
  assert (select merged_into from public.customers where id = b) = a, 'b points at a';
  assert (select count(*) from public.customer_orders where customer_id = a) = 3, 'orders moved';
  assert (select count(*) from public.customer_cards where customer_id = b) = 0, 'cards moved';
  failed := false;
  begin perform public.customer_merge(actor, sug, a); exception when raise_exception then failed := true; end;
  assert failed, 'a decided suggestion cannot be confirmed twice';
  -- latest event across the merged pair: ana.work opted out on 10-06 is now the person's latest.
  assert (select status from public.customer_consent_current where customer_id = a and channel = 'email') = 'opted_out', 'tie/merge read';

  -- 7. Erase on request: identifiers and cards gone, hashes suppressed, re-ingest does not re-create.
  r := public.customer_erase(actor, b, 'delete_request');
  assert (r->>'customer_id')::uuid = a and (r->>'changed')::boolean, 'erase resolves to the root';
  assert (select count(*) from public.customer_identifiers where customer_id in (a,b)) = 0, 'identifiers deleted';
  assert (select full_name from public.customers where id = a) is null, 'name cleared';
  assert (select count(*) from public.customer_orders where customer_id = a) = 3, 'orders stay as anonymous stats';
  assert (select count(*) from public.customer_suppressions) = 3, 'hashes suppressed';
  r := public.customer_ingest_orders(loc, jsonb_build_array(
    jsonb_build_object('order_guid','HARNESS-G1','business_date','2026-10-01','email','ana@example.com','phone','+12025550101','source','toast_online','channel','online','total_cents',1500)));
  assert (r->>'linked')::int = 0 and (r->>'suppressed')::int = 1, 'a deleted person is not re-created';
  r := public.customer_consent_import_begin(actor, 'toast_csv_import', repeat('e',64), '2026-10-07', true, 1);
  imp := (r->>'import_id')::uuid;
  r := public.customer_consent_import_chunk(actor, imp, 0, jsonb_build_array(jsonb_build_object('email','ana@example.com','status','opted_in')));
  assert (r->>'suppressed')::int = 1, 'nor by an import';
  r := public.customer_consent_import_finish(actor, imp, false);
  assert (select count(*) from public.customer_marketing_export('email')) = 0, 'nothing left to export';

  -- 8. Large absence wave needs a human yes.
  r := public.customer_consent_import_begin(actor, 'toast_csv_import', repeat('f',64), '2026-10-07', false, 1);
  imp := (r->>'import_id')::uuid;
  r := public.customer_consent_import_chunk(actor, imp, 0, (select jsonb_agg(jsonb_build_object('email','p'||g||'@example.com')) from generate_series(1,40) g));
  r := public.customer_consent_import_finish(actor, imp, false);
  r := public.customer_consent_import_begin(actor, 'toast_csv_import', repeat('9',64), '2026-10-08', false, 1);
  imp := (r->>'import_id')::uuid;
  r := public.customer_consent_import_chunk(actor, imp, 0, jsonb_build_array(jsonb_build_object('email','p1@example.com')));
  failed := false;
  begin perform public.customer_consent_import_finish(actor, imp, false); exception when raise_exception then failed := true; end;
  assert failed, '39 of 40 vanishing needs confirmation';
  r := public.customer_consent_import_finish(actor, imp, true);
  assert (r->>'opt_outs')::int = 39, 'confirmed wave ' || r::text;

  -- 9. Retention: an old, never-opted-in person is erased; the cutoff must be >= 1 year back.
  insert into public.customers(full_name, name_key, last_seen_at, first_seen_at, sources) values ('Old Timer','old timer', now() - interval '4 years', now() - interval '5 years', array['toast_pos'])
    returning id into c;
  failed := false;
  begin perform public.customer_retention_sweep(actor, now() - interval '30 days', 10); exception when raise_exception then failed := true; end;
  assert failed, 'a short retention cutoff is refused';
  r := public.customer_retention_sweep(actor, now() - interval '3 years', 10);
  assert (r->>'erased')::int = 1 and (select erase_reason from public.customers where id = c) = 'retention', 'retention ' || r::text;

  -- 10. Append-only and grants.
  assert not has_table_privilege('service_role', 'public.customer_consent_events', 'UPDATE'), 'no update on events';
  assert not has_table_privilege('service_role', 'public.customer_consent_events', 'DELETE'), 'no delete on events';
  assert not has_table_privilege('service_role', 'public.customer_consent_events', 'INSERT'), 'events only through RPCs';
  assert not has_table_privilege('authenticated', 'public.customer_identifiers', 'SELECT'), 'staff JWT reads no contacts';
  assert not has_function_privilege('authenticated', 'public.customer_marketing_export(text)', 'EXECUTE'), 'staff JWT cannot export';
  assert not has_function_privilege('service_role', 'public.customer_resolve(text,text,text,text,text,uuid,timestamptz,text,text)', 'EXECUTE'), 'resolver is private';
  raise notice 'customer profiles harness: PASS';
end $$;
rollback;
