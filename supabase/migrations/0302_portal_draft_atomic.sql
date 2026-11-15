-- Migration 0302_portal_draft_atomic
-- AUTHORED 2026-11-14. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word).
-- Provenance: audit wave W01 (online catering order) — B032 (a cart save could replace the line items
--   AFTER submit froze the total), B144 (submit's status flip, napkins line and deposit-due intent were
--   three separate writes; a failure after the flip left a submitted order with no napkins line and no
--   deposit request, and a retry answered 409) and B002 (the order's allergy / special-instructions
--   note now rides the submit). Review round 2 (B033): an older cart save that reached the database
--   AFTER a newer one overwrote it (the row lock serializes arrival, not edit order), so the cart
--   writer now refuses to go backwards on the build page's edit revision.
--
-- WHAT: two SECURITY DEFINER writers, the ONLY database writers of a self-serve DRAFT's lines and of
--   its submit. Each runs in ONE transaction and takes the SAME lock first: the catering_quotes row
--   FOR UPDATE. So a cart save and a submit for one draft serialize; whichever commits second sees the
--   first's result.
--     portal_draft_set_lines(customer, quote, lines, snapshot, rev_epoch, rev_seq)
--       owned + 'draft' + not superseded (re-checked under the lock) → [edit order] → delete the
--       draft's lines (options cascade, 0144) → insert the new lines and their package picks → write
--       the charge snapshot and the revision. A submit that won the lock first leaves status
--       'submitted' → `not_draft`, nothing written.
--       Edit order: the build page sends (epoch = one id per page load, seq = grows per edit). When
--       the stored revision has the SAME epoch and a seq >= this one, the save is older than (or a
--       retry of) one already written → returns {stale: true} and writes nothing. Another epoch, or a
--       save with no revision (a page cached from before this), is written as before; a save with no
--       revision leaves the stored revision alone. Epoch and seq come together or not at all.
--     portal_draft_submit(customer, quote, expected_lines, snapshot, napkins, expires_at,
--                         set_dietary_notes, dietary_notes)
--       owned + 'draft' + not superseded under the lock → the draft's CURRENT lines must equal the set
--       the server priced (`expected_lines`: id, quantity, unit price) else `cart_changed` (a cart save
--       committed between the server's read and this lock) → flip to 'submitted' with the snapshot and
--       expiry → the napkins line (when chosen) → the deposit 'due' payment intent (the 0130 partial
--       unique index makes it at most one) → the lead's dietary notes (when sent). All or nothing.
--       DELIVERY (Juan's ruling 2026-11-15): before the flip, a delivery order is re-priced against the
--       shop's active zones as they are UNDER THE LOCK (the zone rows are read FOR SHARE, so a fee edit
--       waits for this submit): no active zone → `delivery_unavailable` (never free); the snapshot
--       must carry the MOST EXPENSIVE active zone (ties: the higher minimum, then the lower id — the
--       app's resolvePortalDeliveryZone) and its fee, else `delivery_changed`; the snapshot subtotal
--       must reach that zone's min_order_cents, else `below_delivery_minimum`. A pickup must carry no
--       zone and no fee, and the snapshot's is_delivery must be the draft's own (else invalid_snapshot).
--   Every price is still decided in the app (D20 server price authority, lib/portal/draft.ts); the SQL
--   re-checks the arithmetic it can see: the snapshot's subtotal must equal the lines it writes.
--
-- REFUSALS (raise exception <code>; lib/portal/draft.ts maps each): not_found · not_draft ·
--   invalid_lines · invalid_snapshot · invalid_napkins · invalid_notes · invalid_rev · empty_cart ·
--   cart_changed · subtotal_mismatch · delivery_unavailable · delivery_changed · below_delivery_minimum.
--
-- SCHEMA: two nullable columns on catering_quotes, portal_rev_epoch text + portal_rev_seq bigint
--   (both null or both set, CHECK): the last edit revision the cart writer stored. Existing rows stay
--   null (no backfill). Nothing else reads them.
--
-- PRIVILEGES: execute for service_role ONLY (revoked from public, anon, authenticated; asserted). The
--   tables' grants are untouched; nothing new is granted on any table (the two new columns inherit
--   catering_quotes' existing table-level grants, as every column added to it has).
--
-- APP COMPATIBILITY: lib/portal/draft.ts calls these RPCs first and, when the function does not exist
--   yet (PGRST202 / 42883), runs its previous non-transactional path. Applying 0302 is therefore safe at
--   any time after the W01 deploy, and the deploy is safe before it. Until it is applied, B032 and B144
--   remain open (the legacy path is what ran before W01), and the server-side edit order is not
--   enforced (the legacy path has no column to keep the revision in; the build page still sends its
--   saves one at a time, the unmount save included).
--
-- DEPENDS ON: 0120 (quotes, items), 0127 (status 'submitted', origin, catering_payments), 0128
--   (portion), 0129 (pipeline intake columns incl. dietary_notes), 0130 (catering_payments_one_due),
--   0143 (size_id), 0144 (catering_quote_item_options), 0251/0252 (line_kind, components_listed),
--   0117 (catering_delivery_zones: location_id, fee_cents, min_order_cents, active).
--
-- PROOF: scripts/sql-harness-0302.mjs (PGlite, the real parent DDL + this file, synthetic rows),
--   CI-pinned by tests/portal-draft-atomic-migration.test.ts. The two-session serialization is the
--   row lock itself; a sim two-session check is CC's, not part of this file.
--
-- ROLLBACK: drop the two functions (and, optionally, the two portal_rev_* columns); the app falls back
--   to its legacy path by itself.
begin;

do $$
declare v_col text; v_missing text[] := '{}';
begin
  if to_regprocedure('public.portal_draft_set_lines(uuid,uuid,jsonb,jsonb,text,bigint)') is not null
     or to_regprocedure('public.portal_draft_submit(uuid,uuid,jsonb,jsonb,jsonb,timestamptz,boolean,text)') is not null then
    raise exception '0302: already applied';
  end if;
  foreach v_col in array array['customer_id','location_id','status','superseded_at','pipeline_id','expires_at','origin',
      'is_delivery','delivery_zone_id','subtotal_cents','delivery_fee_cents','service_charge_cents','gratuity_cents',
      'tax_cents','total_cents','deposit_cents','tax_rate_bps','gratuity_bps','service_charge_bps','deposit_pct_bps',
      'tax_on_delivery','tax_on_gratuity'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_quotes' and column_name = v_col) then
      v_missing := v_missing || ('catering_quotes.' || v_col);
    end if;
  end loop;
  foreach v_col in array array['quote_id','item_id','menu_item_id','package_id','size_id','portion','description','quantity',
      'unit_price_cents','line_total_cents','display_order','created_by','line_kind','components_listed'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_quote_items' and column_name = v_col) then
      v_missing := v_missing || ('catering_quote_items.' || v_col);
    end if;
  end loop;
  foreach v_col in array array['quote_item_id','package_item_id','item_id','menu_item_id','quantity','created_by'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_quote_item_options' and column_name = v_col) then
      v_missing := v_missing || ('catering_quote_item_options.' || v_col);
    end if;
  end loop;
  foreach v_col in array array['quote_id','customer_id','kind','amount_cents','status','created_by'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_payments' and column_name = v_col) then
      v_missing := v_missing || ('catering_payments.' || v_col);
    end if;
  end loop;
  foreach v_col in array array['id','location_id','fee_cents','min_order_cents','active'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_delivery_zones' and column_name = v_col) then
      v_missing := v_missing || ('catering_delivery_zones.' || v_col);
    end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catering_pipeline' and column_name = 'dietary_notes') then
    v_missing := v_missing || 'catering_pipeline.dietary_notes'::text;
  end if;
  if cardinality(v_missing) > 0 then raise exception '0302: missing columns %', v_missing; end if;
  select string_agg(column_name::text, ', ' order by column_name) into v_col from information_schema.columns
   where table_schema = 'public' and table_name = 'catering_quotes' and column_name in ('portal_rev_epoch', 'portal_rev_seq');
  if v_col is not null then raise exception '0302: catering_quotes already has %', v_col; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'catering_payments'
                   and indexname = 'catering_payments_one_due' and indexdef ilike '%unique%(quote_id, kind)%where%status%due%') then
    raise exception '0302: missing the 0130 partial unique index catering_payments_one_due';
  end if;
end $$;

-- The cart writer's last stored edit revision (W01-r2). Nullable, no backfill, no default.
alter table public.catering_quotes
  add column portal_rev_epoch text,
  add column portal_rev_seq bigint,
  add constraint catering_quotes_portal_rev_pair check ((portal_rev_epoch is null) = (portal_rev_seq is null)
    and (portal_rev_seq is null or portal_rev_seq >= 1) and (portal_rev_epoch is null or length(portal_rev_epoch) between 1 and 64));

-- The 15 snapshot keys, exactly (the app's snapshotColumns). A payload with any other key set refuses.
create function public.portal_draft_snapshot_ok(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select p is not null and jsonb_typeof(p) = 'object'
     and (select array_agg(k order by k) from jsonb_object_keys(p) k) = array['delivery_fee_cents','delivery_zone_id','deposit_cents',
       'deposit_pct_bps','gratuity_bps','gratuity_cents','is_delivery','service_charge_bps','service_charge_cents','subtotal_cents',
       'tax_cents','tax_on_delivery','tax_on_gratuity','tax_rate_bps','total_cents']
     and jsonb_typeof(p->'is_delivery') = 'boolean' and jsonb_typeof(p->'tax_on_delivery') = 'boolean' and jsonb_typeof(p->'tax_on_gratuity') = 'boolean'
     and jsonb_typeof(p->'delivery_zone_id') in ('string','null')
     and (select bool_and(jsonb_typeof(p->k) = 'number') from unnest(array['subtotal_cents','delivery_fee_cents','service_charge_cents',
       'gratuity_cents','tax_cents','total_cents','deposit_cents','tax_rate_bps','gratuity_bps','service_charge_bps','deposit_pct_bps']) k)
$$;

create function public.portal_draft_set_lines(p_customer_id uuid, p_quote_id uuid, p_lines jsonb, p_snapshot jsonb,
  p_rev_epoch text, p_rev_seq bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  q record; l jsonb; o jsonb; v_item uuid; v_sum bigint := 0;
begin
  if p_customer_id is null or p_quote_id is null then raise exception 'not_found'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200 then raise exception 'invalid_lines'; end if;
  if not public.portal_draft_snapshot_ok(p_snapshot) then raise exception 'invalid_snapshot'; end if;
  if (p_rev_epoch is null) <> (p_rev_seq is null)
     or (p_rev_seq is not null and (p_rev_seq < 1 or length(p_rev_epoch) not between 1 and 64)) then
    raise exception 'invalid_rev';
  end if;

  -- THE lock (shared with portal_draft_submit): the draft's quote row.
  select id, customer_id, status, superseded_at, portal_rev_epoch, portal_rev_seq into q from public.catering_quotes where id = p_quote_id for update;
  if not found or q.customer_id is distinct from p_customer_id then raise exception 'not_found'; end if;
  if q.status <> 'draft' or q.superseded_at is not null then raise exception 'not_draft'; end if;

  -- Edit order (W01-r2): a save from the same page that is not newer than the stored one writes nothing.
  if p_rev_epoch is not null and q.portal_rev_epoch = p_rev_epoch and q.portal_rev_seq >= p_rev_seq then
    return jsonb_build_object('quote_id', p_quote_id, 'stale', true);
  end if;

  for l in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(l) <> 'object' or jsonb_typeof(l->'line_total_cents') <> 'number' then raise exception 'invalid_lines'; end if;
    v_sum := v_sum + (l->>'line_total_cents')::bigint;
  end loop;
  if v_sum <> (p_snapshot->>'subtotal_cents')::bigint then raise exception 'subtotal_mismatch'; end if;

  delete from public.catering_quote_items where quote_id = p_quote_id; -- options cascade (0144)
  for l in select value from jsonb_array_elements(p_lines) loop
    insert into public.catering_quote_items (quote_id, item_id, menu_item_id, package_id, size_id, portion, description, quantity,
      unit_price_cents, line_total_cents, display_order, created_by, line_kind, components_listed)
    values (p_quote_id, (l->>'item_id')::uuid, (l->>'menu_item_id')::uuid, (l->>'package_id')::uuid, (l->>'size_id')::uuid,
      l->>'portion', l->>'description', (l->>'quantity')::numeric, (l->>'unit_price_cents')::integer,
      (l->>'line_total_cents')::integer, (l->>'display_order')::integer, null, l->>'line_kind', (l->>'components_listed')::boolean)
    returning id into v_item;
    if l ? 'options' and jsonb_typeof(l->'options') <> 'array' then raise exception 'invalid_lines'; end if;
    for o in select value from jsonb_array_elements(coalesce(l->'options', '[]'::jsonb)) loop
      insert into public.catering_quote_item_options (quote_item_id, package_item_id, item_id, menu_item_id, quantity, created_by)
      values (v_item, (o->>'package_item_id')::uuid, (o->>'item_id')::uuid, (o->>'menu_item_id')::uuid, (o->>'quantity')::numeric, null);
    end loop;
  end loop;

  update public.catering_quotes set
    is_delivery = (p_snapshot->>'is_delivery')::boolean, delivery_zone_id = (p_snapshot->>'delivery_zone_id')::uuid,
    subtotal_cents = (p_snapshot->>'subtotal_cents')::integer, delivery_fee_cents = (p_snapshot->>'delivery_fee_cents')::integer,
    service_charge_cents = (p_snapshot->>'service_charge_cents')::integer, gratuity_cents = (p_snapshot->>'gratuity_cents')::integer,
    tax_cents = (p_snapshot->>'tax_cents')::integer, total_cents = (p_snapshot->>'total_cents')::integer,
    deposit_cents = (p_snapshot->>'deposit_cents')::integer, tax_rate_bps = (p_snapshot->>'tax_rate_bps')::integer,
    gratuity_bps = (p_snapshot->>'gratuity_bps')::integer, service_charge_bps = (p_snapshot->>'service_charge_bps')::integer,
    deposit_pct_bps = (p_snapshot->>'deposit_pct_bps')::integer, tax_on_delivery = (p_snapshot->>'tax_on_delivery')::boolean,
    tax_on_gratuity = (p_snapshot->>'tax_on_gratuity')::boolean,
    portal_rev_epoch = coalesce(p_rev_epoch, portal_rev_epoch),
    portal_rev_seq = case when p_rev_epoch is null then portal_rev_seq else p_rev_seq end
  where id = p_quote_id;

  return jsonb_build_object('quote_id', p_quote_id, 'lines', jsonb_array_length(p_lines), 'stale', false);
end $$;

create function public.portal_draft_submit(p_customer_id uuid, p_quote_id uuid, p_expected_lines jsonb, p_snapshot jsonb,
  p_napkins jsonb, p_expires_at timestamptz, p_set_dietary_notes boolean, p_dietary_notes text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  q record; z record; v_current jsonb; v_expected jsonb; v_count integer; v_sum bigint; v_payment uuid;
begin
  if p_customer_id is null or p_quote_id is null then raise exception 'not_found'; end if;
  if p_expected_lines is null or jsonb_typeof(p_expected_lines) <> 'array' then raise exception 'invalid_lines'; end if;
  if not public.portal_draft_snapshot_ok(p_snapshot) then raise exception 'invalid_snapshot'; end if;
  if p_expires_at is null then raise exception 'invalid_snapshot'; end if;
  if p_napkins is not null and (jsonb_typeof(p_napkins) <> 'object' or jsonb_typeof(p_napkins->'item_id') <> 'string'
       or jsonb_typeof(p_napkins->'unit_price_cents') <> 'number' or nullif(btrim(p_napkins->>'description'), '') is null) then
    raise exception 'invalid_napkins';
  end if;
  if p_set_dietary_notes is null or (p_dietary_notes is not null and length(p_dietary_notes) > 2000) then raise exception 'invalid_notes'; end if;

  -- THE lock (shared with portal_draft_set_lines): the draft's quote row.
  select id, customer_id, status, superseded_at, pipeline_id, location_id, is_delivery into q from public.catering_quotes where id = p_quote_id for update;
  if not found or q.customer_id is distinct from p_customer_id then raise exception 'not_found'; end if;
  if q.status <> 'draft' or q.superseded_at is not null then raise exception 'not_draft'; end if;

  -- The lines the server priced must still be the lines on the draft (B032): same ids, quantities, prices.
  select count(*), coalesce(sum(line_total_cents), 0),
         coalesce(jsonb_agg(jsonb_build_object('id', id::text, 'quantity', quantity, 'unit_price_cents', unit_price_cents) order by id::text), '[]'::jsonb)
    into v_count, v_sum, v_current
    from public.catering_quote_items where quote_id = p_quote_id;
  if v_count = 0 then raise exception 'empty_cart'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', e->>'id', 'quantity', (e->>'quantity')::numeric, 'unit_price_cents', (e->>'unit_price_cents')::integer) order by e->>'id'), '[]'::jsonb)
    into v_expected from jsonb_array_elements(p_expected_lines) e;
  if v_current is distinct from v_expected then raise exception 'cart_changed'; end if;
  if v_sum + coalesce((p_napkins->>'unit_price_cents')::bigint, 0) <> (p_snapshot->>'subtotal_cents')::bigint then
    raise exception 'subtotal_mismatch';
  end if;

  -- Delivery (Juan 2026-11-15): never free, never the cheaper zone, never under the minimum.
  if (p_snapshot->>'is_delivery')::boolean is distinct from q.is_delivery then raise exception 'invalid_snapshot'; end if;
  if q.is_delivery then
    perform 1 from public.catering_delivery_zones where location_id = q.location_id and active for share;
    select id, fee_cents, min_order_cents into z from public.catering_delivery_zones
     where location_id = q.location_id and active
     order by fee_cents desc, coalesce(min_order_cents, -1) desc, id asc limit 1;
    if not found then raise exception 'delivery_unavailable'; end if;
    if (p_snapshot->>'delivery_zone_id') is distinct from z.id::text
       or (p_snapshot->>'delivery_fee_cents')::integer is distinct from z.fee_cents then
      raise exception 'delivery_changed';
    end if;
    if z.min_order_cents is not null and (p_snapshot->>'subtotal_cents')::bigint < z.min_order_cents then
      raise exception 'below_delivery_minimum';
    end if;
  elsif jsonb_typeof(p_snapshot->'delivery_zone_id') <> 'null' or (p_snapshot->>'delivery_fee_cents')::integer <> 0 then
    raise exception 'invalid_snapshot';
  end if;

  update public.catering_quotes set
    status = 'submitted', expires_at = p_expires_at,
    is_delivery = (p_snapshot->>'is_delivery')::boolean, delivery_zone_id = (p_snapshot->>'delivery_zone_id')::uuid,
    subtotal_cents = (p_snapshot->>'subtotal_cents')::integer, delivery_fee_cents = (p_snapshot->>'delivery_fee_cents')::integer,
    service_charge_cents = (p_snapshot->>'service_charge_cents')::integer, gratuity_cents = (p_snapshot->>'gratuity_cents')::integer,
    tax_cents = (p_snapshot->>'tax_cents')::integer, total_cents = (p_snapshot->>'total_cents')::integer,
    deposit_cents = (p_snapshot->>'deposit_cents')::integer, tax_rate_bps = (p_snapshot->>'tax_rate_bps')::integer,
    gratuity_bps = (p_snapshot->>'gratuity_bps')::integer, service_charge_bps = (p_snapshot->>'service_charge_bps')::integer,
    deposit_pct_bps = (p_snapshot->>'deposit_pct_bps')::integer, tax_on_delivery = (p_snapshot->>'tax_on_delivery')::boolean,
    tax_on_gratuity = (p_snapshot->>'tax_on_gratuity')::boolean
  where id = p_quote_id;

  if p_napkins is not null then
    insert into public.catering_quote_items (quote_id, item_id, menu_item_id, package_id, portion, description, quantity,
      unit_price_cents, line_total_cents, display_order, created_by)
    values (p_quote_id, (p_napkins->>'item_id')::uuid, null, null, null, p_napkins->>'description', 1,
      (p_napkins->>'unit_price_cents')::integer, (p_napkins->>'unit_price_cents')::integer, v_count, null);
  end if;

  -- Self-serve is deposit-required. At most one live 'due' intent per (quote, kind) (0130).
  insert into public.catering_payments (quote_id, customer_id, kind, amount_cents, status, created_by)
  values (p_quote_id, p_customer_id, 'deposit', (p_snapshot->>'deposit_cents')::integer, 'due', p_customer_id)
  on conflict (quote_id, kind) where status = 'due' do nothing
  returning id into v_payment;
  if v_payment is null then
    select id into v_payment from public.catering_payments where quote_id = p_quote_id and kind = 'deposit' and status = 'due';
  end if;

  if p_set_dietary_notes and q.pipeline_id is not null then
    update public.catering_pipeline set dietary_notes = nullif(btrim(p_dietary_notes), '')
    where id = q.pipeline_id and customer_id = p_customer_id;
  end if;

  return jsonb_build_object('quote_id', p_quote_id, 'payment_id', v_payment);
end $$;

-- Privileges: service_role executes the two writers; nobody executes the snapshot helper directly
-- (it runs inside the definer functions as their owner).
do $$ declare f regprocedure; begin
  foreach f in array array[
    'public.portal_draft_set_lines(uuid,uuid,jsonb,jsonb,text,bigint)'::regprocedure,
    'public.portal_draft_submit(uuid,uuid,jsonb,jsonb,jsonb,timestamptz,boolean,text)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
    assert not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE')
       and has_function_privilege('service_role', f, 'EXECUTE'), '0302: writer privilege escape';
    assert not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid = f and a.grantee = 0), '0302: PUBLIC writer escape';
  end loop;
  f := 'public.portal_draft_snapshot_ok(jsonb)'::regprocedure;
  execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  assert not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE')
     and not has_function_privilege('service_role', f, 'EXECUTE'), '0302: helper privilege escape';
end $$;

commit;
