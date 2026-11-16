-- Migration 0327_receiving_atomic_writers
-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word), AFTER 0326.
-- Provenance: CO-OPS bug audit wave W20 (found at 7494f738): B197 (a failed line insert left an empty delivery that
--   blocked saving it again), B114 (two people confirming a receipt at once could overwrite a manager's final
--   decision), and owner decision W20-2 (b): build a manager "unlink" for a receipt linked to the wrong delivery
--   (B112 left confirmations and statements sitting in a delivery's only receipt slot, with no way out).
--   Review W20-r4 (2026-11-16, file still unapplied): the automatic link checked the unlink record in one request
--   and wrote the link in two more, so a worker that chose its pair before a manager unlinked it put the pair
--   back when it resumed. Function 5 makes that check part of the link's own transaction.
--
-- WHAT (four service-role functions and one append-only table; no existing row is read or rewritten at apply):
--   1. record_delivery_atomic(p_header, p_lines, p_line_credits, p_missing_credits) -> jsonb {delivery_id, item_ids}
--      ONE transaction for what lib/receiving.ts recordDelivery wrote as four separate requests: the delivery
--      header, its lines (in the order sent), the credits for flagged lines (each names its line by 1-based
--      `line_index`, resolved here to the new line id) and the line-less credits for ordered items that never
--      arrived. Any failure (the 0169 duplicate index, a CHECK, the 0178 vendor binding, the 0168 credit index)
--      rolls ALL of it back, so nothing is left behind and the retry works. The lines are stamped with the
--      HEADER's created_at (B199, review W20-r1): "the lines this delivery was created with" is an identity the
--      append guard reads (line.created_at = delivery.created_at), never a guess from timing. The pre-0327
--      fallback in lib/receiving.ts writes the same stamp from its second request. It is a writer only: every business
--      rule (who may receive, the shop bind, the PO state, SKU / photo / missing-item validation, oz resolution,
--      credit amounts) stays in lib/receiving.ts and runs BEFORE this call, exactly as it does today.
--   2. delivery_match_verdict(p_delivery, p_kind 'attest'|'override', p_verdict, p_note, p_receipt) -> jsonb
--      The read-check-write of attestMatch / overrideMatch under the delivery ROW LOCK: an attestation that
--      queued behind an override is refused `already_overridden` instead of replacing it and dropping its note,
--      and two notes appended at once are both kept, in order.
--      `p_receipt` is the receipt the verdict is ABOUT (the one the person compared on screen). It is REQUIRED,
--      for an attestation and for an override: null is refused `receipt_required` (review W20-r2). A caller that
--      cannot say which receipt the person saw must not have this function decide on whatever is linked now (the
--      app's page offers both actions only beside a linked receipt). It is compared with the linked receipt UNDER
--      THE LOCK: if a manager unlinked it, or unlinked it and linked another, in between, the verdict is refused
--      `receipt_changed` instead of marking the replacement on the first receipt's comparison (review W20-r1).
--   3. delivery_receipt_unlink(p_delivery, p_receipt, p_note, p_actor) -> jsonb
--      Clears BOTH sides of a delivery <-> receipt link in one transaction, sets the delivery's match back to
--      `counted_only` (a verdict about a receipt that is no longer linked means nothing; an override is cleared
--      too, and its state is kept on the unlink row), appends the reason to the delivery note and records the act
--      in delivery_receipt_unlinks. `p_receipt` is the receipt the person SAW: a different one is `receipt_changed`.
--   4. delivery_receipt_unlinks: one row per unlink (delivery, receipt, shop, prior match state, reason, who,
--      when). Append-only by grant: deny-all RLS, service_role SELECT only, written only by function 3. The app
--      reads it so the "is this the invoice?" prompt and the automatic link's choice of a candidate leave out a
--      pair a person undid; function 5 is what REFUSES to write such a pair.
--   5. delivery_receipt_auto_link(p_delivery, p_receipt, p_location, p_vendor, p_delivery_date, p_parse_state,
--      p_received_at) -> jsonb {linked: true, location_id} | {linked: false, reason}
--      THE ONE AUTOMATIC WRITER of a delivery <-> receipt link (both directions in lib/email-receipts.ts call it;
--      a person's manual link is not this function). Under the delivery ROW LOCK and then the receipt's, in ONE
--      transaction, it (a) REFUSES a pair that is on delivery_receipt_unlinks (`pair_unlinked`: automation never
--      puts back a link a manager undid), (b) re-checks, on the locked rows, the snapshot the caller chose its
--      candidate on: the delivery's shop, vendor and date with no receipt yet (`delivery_changed`), the receipt's
--      shop, vendor, parse state and received-at, not flagged for a person, an INVOICE (B112, now inside the
--      writer), not linked, and no other delivery pointing at it (`receipt_changed`), and (c) writes BOTH sides.
--      Any failure rolls both sides back, so there is no half link and nothing to compensate. It takes the same
--      locks in the same order as function 3, so an unlink and an automatic link of one delivery run one after
--      the other: the reviewer's interleaving (worker A links, a manager unlinks, worker B resumes with the pair
--      it chose earlier) ends with B reading the unlink record under the lock and being refused. A refusal is a
--      returned answer, not an error: automation is best-effort and a refused pair simply waits for a person.
--
-- NAMED REFUSALS (P0001, message = the code; the app maps them): invalid_input, not_found, no_receipt,
--   invalid_verdict, note_required, already_overridden, receipt_changed, receipt_required, forbidden.
--   Function 5 raises only invalid_input (a missing argument); its refusals are the `reason` it returns:
--   pair_unlinked, delivery_changed, receipt_changed.
--
-- LOCK ORDER: the delivery row FOR NO KEY UPDATE (functions 2, 3 and 5; compatible with the key-share checks of
--   the rows that reference a delivery), then, in functions 3 and 5 only, the receipt row. Nothing takes a
--   delivery after a receipt. The receipt update of functions 3 and 5 fires 0297's receipt-event trigger, which
--   key-shares the inbound message: that is why 0326 comes first (it stops a vendor mail action's lock from
--   blocking that key-share). The app's manual link stays two single-statement requests (receipt, then
--   delivery), each holding one row lock at a time, so it cannot form a cycle with these.
--
-- EXISTING ROWS: untouched. Deliveries already linked to a confirmation or statement are NOT repaired here; a
--   manager unlinks them one at a time through the app. Empty deliveries left by past failed saves are NOT
--   deleted (owner decision W20-3: Juan confirms the list first; the read-only query is in the PR).
--
-- APP COMPATIBILITY: the app runs before and after this file, with ONE thing off until it is applied. Before it:
--   recordDelivery and the attest / override writes fall back to their previous statements (the function is not
--   there: PGRST202 / 42883), the unlink button answers "not available yet" (503 unlink_unavailable), the unlink
--   history read finds no table and treats that as "nothing was unlinked", and THE AUTOMATIC LINK LINKS NOTHING
--   (function 5 is the only automatic writer; PostgREST cannot put a NOT EXISTS on another table into an
--   UPDATE's WHERE, so there is no request-by-request fallback that could keep the unlink rule atomic, and the
--   app does not keep an unguarded second writer). Receipts then wait in the queue and the "is this the
--   invoice?" prompt, where a person links them by hand. APPLY THIS FILE BEFORE THE APP THAT CALLS IT IS
--   DEPLOYED, or accept that pause. After it: the four functions are used.
--
-- DEPENDS ON: 0100, 0160, 0168, 0169, 0170, 0171, 0174, 0175, 0178, 0294 (the columns, checks and indexes named
--   in the pre-flight; 0175 and 0294 are the receipt's doc_kind and attribution_conflict) and 0326 when vendor
--   mail (0297) is installed.
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select table_name, count(*) from information_schema.columns where table_schema='public'
--    and table_name in ('vendor_deliveries','vendor_delivery_items','vendor_credits') group by 1;
--   select to_regclass('public.vendor_deliveries_dedupe_uq'), to_regclass('public.vendor_deliveries_email_receipt_uq'),
--          to_regclass('public.vendor_credits_line_reason_uq');                                   -- all present
--   -- deliveries linked to something that is not an invoice (B112; a manager can now unlink them):
--   select d.id, d.delivery_date, d.location_id, r.doc_kind from public.vendor_deliveries d
--     join public.email_receipts r on r.id = d.email_receipt_id where r.doc_kind is distinct from 'invoice';
--   -- deliveries with no line (B197 leftovers; report only):
--   select d.id, d.created_at, d.delivery_date, d.invoice_number from public.vendor_deliveries d
--    where not exists (select 1 from public.vendor_delivery_items i where i.delivery_id = d.id);
--
-- VERIFY AFTER APPLY:
--   select routine_name, grantee, privilege_type from information_schema.routine_privileges
--    where routine_schema='public' and routine_name in ('record_delivery_atomic','delivery_match_verdict','delivery_receipt_unlink',
--      'delivery_receipt_auto_link') order by 1, 2;                          -- service_role (+ postgres) only
--   select to_regprocedure('public.delivery_match_verdict(uuid,text,text,text,uuid)') is not null as five_args,
--          to_regprocedure('public.delivery_match_verdict(uuid,text,text,text)') is null as no_four_args;   -- t, t
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema='public' and table_name='delivery_receipt_unlinks' and grantee in ('anon','authenticated','service_role');
--                                                                            -- service_role SELECT, nothing else
--   Two-session proof (sim only, CC runs it): scripts/sim/receiving-0326-0327-lock-check-management.mjs
--
-- ROLLBACK: revert the app (it falls back by itself once the functions are gone; the automatic link pauses,
--   it does not fall back), then
--   drop function public.record_delivery_atomic(jsonb,jsonb,jsonb,jsonb);
--   drop function public.delivery_match_verdict(uuid,text,text,text,uuid);
--   drop function public.delivery_receipt_unlink(uuid,uuid,text,uuid);
--   drop function public.delivery_receipt_auto_link(uuid,uuid,uuid,uuid,date,text,timestamptz);
--   Keep delivery_receipt_unlinks: it is the record of what people unlinked.
-- PROOF: scripts/sql-harness-0327.mjs (PGlite: the real 0100 / 0168 / 0169 / 0178 DDL and the real 0160 / 0170 /
--   0171 / 0174 / 0175 statements, synthetic rows), pinned by tests/receiving-atomic-writers-migration.test.ts.
begin;

-- ── PRE-FLIGHT: every table, column, check and index the functions rely on ─────────────────────────────────
do $$
declare v_missing text; v_mutate regprocedure;
begin
  if to_regclass('public.vendor_deliveries') is null or to_regclass('public.vendor_delivery_items') is null
     or to_regclass('public.vendor_credits') is null or to_regclass('public.email_receipts') is null
     or to_regclass('public.users') is null or to_regclass('public.locations') is null then
    raise exception '0327: the receiving tables (0100, 0168, 0170) must exist first';
  end if;
  select string_agg(need.t || '.' || need.c, ', ' order by need.t, need.c) into v_missing
  from (values
    ('vendor_deliveries','id'), ('vendor_deliveries','vendor_id'), ('vendor_deliveries','location_id'),
    ('vendor_deliveries','delivery_date'), ('vendor_deliveries','invoice_number'), ('vendor_deliveries','invoice_total'),
    ('vendor_deliveries','notes'), ('vendor_deliveries','note'), ('vendor_deliveries','receipt_url'),
    ('vendor_deliveries','received_by'), ('vendor_deliveries','delivery_status'), ('vendor_deliveries','purchase_order_id'),
    ('vendor_deliveries','match_state'), ('vendor_deliveries','email_receipt_id'), ('vendor_deliveries','created_at'),
    ('vendor_delivery_items','id'), ('vendor_delivery_items','delivery_id'), ('vendor_delivery_items','vendor_item_id'),
    ('vendor_delivery_items','qty_received'), ('vendor_delivery_items','vendor_id'), ('vendor_delivery_items','unit_price'),
    ('vendor_delivery_items','observed_oz_per_each'), ('vendor_delivery_items','notes'), ('vendor_delivery_items','created_by'),
    ('vendor_delivery_items','received_level_label'), ('vendor_delivery_items','received_qty_at_level'),
    ('vendor_delivery_items','resolved_oz'), ('vendor_delivery_items','note'), ('vendor_delivery_items','photo_url'),
    ('vendor_delivery_items','expected_qty'), ('vendor_delivery_items','discrepancy_type'), ('vendor_delivery_items','created_at'),
    ('vendor_credits','location_id'), ('vendor_credits','vendor_id'), ('vendor_credits','delivery_id'),
    ('vendor_credits','delivery_item_id'), ('vendor_credits','reason'), ('vendor_credits','sku_id'),
    ('vendor_credits','qty'), ('vendor_credits','amount_cents'), ('vendor_credits','created_by'),
    ('email_receipts','id'), ('email_receipts','linked_delivery_id'), ('email_receipts','location_id'),
    ('email_receipts','vendor_guess_id'), ('email_receipts','parse_state'), ('email_receipts','received_at'),
    ('email_receipts','doc_kind'), ('email_receipts','attribution_conflict'), ('users','id'), ('users','active')
  ) as need(t, c)
  where not exists (select 1 from information_schema.columns k
                     where k.table_schema = 'public' and k.table_name = need.t and k.column_name = need.c);
  if v_missing is not null then
    raise exception '0327: missing column(s): %', v_missing;
  end if;
  if to_regclass('public.vendor_deliveries_dedupe_uq') is null or to_regclass('public.vendor_deliveries_email_receipt_uq') is null
     or to_regclass('public.vendor_credits_line_reason_uq') is null then
    raise exception '0327: the 0168 / 0169 / 0171 unique indexes must exist first';
  end if;
  -- A verdict must name the receipt it is about. A four-argument draft of this function (one that cannot) must
  -- not be left callable beside the real one: refuse, never drop it from here.
  if to_regprocedure('public.delivery_match_verdict(uuid,text,text,text)') is not null then
    raise exception '0327: an earlier draft delivery_match_verdict(uuid,text,text,text) is installed; drop that function first';
  end if;
  -- 0326 first, wherever vendor mail is installed (see LOCK ORDER above).
  v_mutate := to_regprocedure('public.vendor_mail_mutate(uuid,integer,uuid,uuid,uuid,text,jsonb)');
  if v_mutate is not null then
    if position('for no key update' in (select prosrc from pg_proc where oid = v_mutate)) = 0 then
      raise exception '0327: 0326 (vendor mail lock order) must be applied first';
    end if;
  end if;
end $$;

-- ── 1. THE UNLINK RECORD ───────────────────────────────────────────────────────────────────────────────────
create table if not exists public.delivery_receipt_unlinks (
  id                uuid primary key default gen_random_uuid(),
  delivery_id       uuid not null references public.vendor_deliveries(id),
  receipt_id        uuid not null references public.email_receipts(id),
  location_id       uuid not null references public.locations(id),
  prior_match_state text not null,
  note              text not null check (length(btrim(note)) between 1 and 2000),
  unlinked_by       uuid not null references public.users(id),
  created_at        timestamptz not null default clock_timestamp()
);
create index if not exists delivery_receipt_unlinks_delivery_ix on public.delivery_receipt_unlinks (delivery_id, receipt_id);
create index if not exists delivery_receipt_unlinks_receipt_ix on public.delivery_receipt_unlinks (receipt_id);
comment on table public.delivery_receipt_unlinks is
  'One row per manager unlink of a receipt from a delivery (0327, audit W20). Append-only: written only by '
  'delivery_receipt_unlink(). Read by the app so automation never re-links a pair a person undid.';

alter table public.delivery_receipt_unlinks enable row level security;
drop policy if exists delivery_receipt_unlinks_no_user_select on public.delivery_receipt_unlinks;
drop policy if exists delivery_receipt_unlinks_no_user_insert on public.delivery_receipt_unlinks;
drop policy if exists delivery_receipt_unlinks_no_user_update on public.delivery_receipt_unlinks;
drop policy if exists delivery_receipt_unlinks_no_user_delete on public.delivery_receipt_unlinks;
create policy delivery_receipt_unlinks_no_user_select on public.delivery_receipt_unlinks for select using (false);
create policy delivery_receipt_unlinks_no_user_insert on public.delivery_receipt_unlinks for insert with check (false);
create policy delivery_receipt_unlinks_no_user_update on public.delivery_receipt_unlinks for update using (false);
create policy delivery_receipt_unlinks_no_user_delete on public.delivery_receipt_unlinks for delete using (false);

-- ── 2. ONE TRANSACTION FOR A NEW DELIVERY (B197) ───────────────────────────────────────────────────────────
create or replace function public.record_delivery_atomic(p_header jsonb, p_lines jsonb, p_line_credits jsonb, p_missing_credits jsonb)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  h record;
  v_id uuid;
  v_created timestamptz;
  v_item uuid;
  v_ids uuid[] := array[]::uuid[];
  v_line jsonb;
  v_line_credits jsonb := coalesce(p_line_credits, '[]'::jsonb);
  v_missing_credits jsonb := coalesce(p_missing_credits, '[]'::jsonb);
begin
  if p_header is null or jsonb_typeof(p_header) <> 'object'
     or p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_typeof(v_line_credits) <> 'array' or jsonb_typeof(v_missing_credits) <> 'array' then
    raise exception 'invalid_input';
  end if;
  if jsonb_array_length(p_lines) = 0
     or exists (select 1 from jsonb_array_elements(p_lines) e where jsonb_typeof(e) <> 'object')
     or exists (select 1 from jsonb_array_elements(v_line_credits) e where jsonb_typeof(e) <> 'object')
     or exists (select 1 from jsonb_array_elements(v_missing_credits) e where jsonb_typeof(e) <> 'object') then
    raise exception 'invalid_input';
  end if;
  -- A lined credit names its line by position in p_lines (1-based). Refuse anything else BEFORE writing.
  if exists (select 1 from jsonb_array_elements(v_line_credits) e
              where not (case when coalesce(e->>'line_index', '') ~ '^[0-9]{1,6}$'
                              then (e->>'line_index')::integer between 1 and jsonb_array_length(p_lines)
                              else false end)) then
    raise exception 'invalid_input';
  end if;

  select * into h from jsonb_to_record(p_header) as x(
    vendor_id uuid, location_id uuid, delivery_date date, invoice_number text, invoice_total numeric,
    notes text, note text, receipt_url text, received_by uuid, delivery_status text, purchase_order_id uuid);
  if h.vendor_id is null or h.location_id is null or h.delivery_date is null or h.received_by is null then
    raise exception 'invalid_input';
  end if;

  insert into public.vendor_deliveries
    (vendor_id, location_id, delivery_date, invoice_number, invoice_total, notes, note, receipt_url, received_by,
     delivery_status, purchase_order_id)
  values
    (h.vendor_id, h.location_id, h.delivery_date, h.invoice_number, h.invoice_total, h.notes, h.note, h.receipt_url,
     h.received_by, coalesce(h.delivery_status, 'complete'), h.purchase_order_id)
  returning id, created_at into v_id, v_created;
  -- The instant every creation line carries (the base table's created_at is nullable: never stamp a null).
  v_created := coalesce(v_created, now());

  -- One row at a time, in the order sent, so each line's new id is known by its position. Each line is stamped
  -- with the header's instant by THIS statement, not left to a column default that happens to agree.
  for v_line in select e.value from jsonb_array_elements(p_lines) with ordinality as e(value, ord) order by e.ord loop
    insert into public.vendor_delivery_items
      (delivery_id, vendor_item_id, qty_received, vendor_id, unit_price, observed_oz_per_each, notes, created_by,
       received_level_label, received_qty_at_level, resolved_oz, note, photo_url, expected_qty, discrepancy_type, created_at)
    select v_id, l.vendor_item_id, l.qty_received, l.vendor_id, l.unit_price, l.observed_oz_per_each, l.notes, l.created_by,
           l.received_level_label, l.received_qty_at_level, l.resolved_oz, l.note, l.photo_url, l.expected_qty, l.discrepancy_type, v_created
    from jsonb_to_record(v_line) as l(
      vendor_item_id uuid, qty_received numeric, vendor_id uuid, unit_price numeric, observed_oz_per_each numeric,
      notes text, created_by uuid, received_level_label text, received_qty_at_level numeric, resolved_oz numeric,
      note text, photo_url text, expected_qty numeric, discrepancy_type text)
    returning id into v_item;
    v_ids := v_ids || v_item;
  end loop;

  -- Credits for flagged lines (the 0168 (line, reason) index still arbitrates a duplicate pair).
  insert into public.vendor_credits
    (location_id, vendor_id, delivery_id, delivery_item_id, reason, sku_id, qty, amount_cents, created_by)
  select h.location_id, h.vendor_id, v_id, v_ids[c.line_index], c.reason, c.sku_id, c.qty, c.amount_cents, h.received_by
  from jsonb_to_recordset(v_line_credits) as c(line_index integer, reason text, sku_id uuid, qty numeric, amount_cents integer);

  -- Line-less credits: an ordered item that never came off the truck has no line to point at.
  insert into public.vendor_credits
    (location_id, vendor_id, delivery_id, delivery_item_id, reason, sku_id, qty, amount_cents, created_by)
  select h.location_id, h.vendor_id, v_id, null, c.reason, c.sku_id, c.qty, c.amount_cents, h.received_by
  from jsonb_to_recordset(v_missing_credits) as c(reason text, sku_id uuid, qty numeric, amount_cents integer);

  return jsonb_build_object('delivery_id', v_id, 'item_ids', to_jsonb(v_ids));
end $$;

-- ── 3. A VERDICT UNDER THE DELIVERY'S ROW LOCK (B114) ──────────────────────────────────────────────────────
create or replace function public.delivery_match_verdict(p_delivery uuid, p_kind text, p_verdict text, p_note text, p_receipt uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  d public.vendor_deliveries%rowtype;
  v_note text := nullif(btrim(p_note), '');
  v_state text;
begin
  if p_delivery is null or p_kind is null or p_kind not in ('attest', 'override') then
    raise exception 'invalid_input';
  end if;
  -- A verdict (attestation or override) is about ONE receipt, the one the person was looking at: it must say
  -- which. Null is never read as "whatever is linked now" (review W20-r2): that is how a page that showed
  -- receipt A marked its replacement B.
  if p_receipt is null then raise exception 'receipt_required'; end if;
  select * into d from public.vendor_deliveries where id = p_delivery for no key update;
  if not found then raise exception 'not_found'; end if;

  if p_kind = 'attest' then
    if p_verdict is null or p_verdict not in ('matched', 'discrepant') then raise exception 'invalid_verdict'; end if;
    if d.email_receipt_id is null then raise exception 'no_receipt'; end if;
    -- The receipt the person compared is no longer the one linked (unlinked and replaced while they looked):
    -- change nothing. Read AFTER the wait, like the terminal check below.
    if d.email_receipt_id <> p_receipt then raise exception 'receipt_changed'; end if;
    -- Re-attestable from counted_only / matched / discrepant; an override is terminal. Read AFTER the wait.
    if d.match_state = 'override' then raise exception 'already_overridden'; end if;
    v_state := p_verdict;
    update public.vendor_deliveries
       set match_state = p_verdict,
           note = case when p_verdict = 'discrepant' and v_note is not null
                       then case when note is null or note = '' then v_note else note || E'\n' || v_note end
                       else note end
     where id = d.id;
  else
    if v_note is null then raise exception 'note_required'; end if;
    -- An override was decided beside the receipt it names. That receipt replaced OR unlinked (none linked now)
    -- is a change: null-safe, under the lock.
    if d.email_receipt_id is distinct from p_receipt then raise exception 'receipt_changed'; end if;
    v_state := 'override';
    update public.vendor_deliveries
       set match_state = 'override',
           note = case when note is null or note = '' then v_note else note || E'\n' || v_note end
     where id = d.id;
  end if;

  return jsonb_build_object('prior_state', d.match_state, 'match_state', v_state,
    'location_id', d.location_id, 'receipt_id', d.email_receipt_id);
end $$;

-- ── 4. THE MANAGER UNLINK (owner decision W20-2 b) ─────────────────────────────────────────────────────────
create or replace function public.delivery_receipt_unlink(p_delivery uuid, p_receipt uuid, p_note text, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  d public.vendor_deliveries%rowtype;
  v_note text := nullif(btrim(p_note), '');
  v_released integer := 0;
  v_unlink uuid;
begin
  if p_delivery is null or p_actor is null then raise exception 'invalid_input'; end if;
  if v_note is null then raise exception 'note_required'; end if;
  if length(v_note) > 2000 then raise exception 'invalid_input'; end if;
  if not exists (select 1 from public.users u where u.id = p_actor and u.active) then raise exception 'forbidden'; end if;

  select * into d from public.vendor_deliveries where id = p_delivery for no key update;
  if not found then raise exception 'not_found'; end if;
  if d.email_receipt_id is null then raise exception 'no_receipt'; end if;
  -- The receipt the person was looking at is no longer the one linked: change nothing.
  if p_receipt is not null and d.email_receipt_id <> p_receipt then raise exception 'receipt_changed'; end if;

  -- Lock order: the delivery (above), then its receipt.
  perform 1 from public.email_receipts r where r.id = d.email_receipt_id for no key update;

  update public.vendor_deliveries
     set email_receipt_id = null,
         match_state = 'counted_only',
         note = case when note is null or note = '' then v_note else note || E'\n' || v_note end
   where id = d.id;
  -- Guarded on the pair, so a receipt that already points somewhere else is left alone.
  update public.email_receipts set linked_delivery_id = null
   where id = d.email_receipt_id and linked_delivery_id = d.id;
  get diagnostics v_released = row_count;

  insert into public.delivery_receipt_unlinks (delivery_id, receipt_id, location_id, prior_match_state, note, unlinked_by)
  values (d.id, d.email_receipt_id, d.location_id, d.match_state, v_note, p_actor)
  returning id into v_unlink;

  return jsonb_build_object('unlink_id', v_unlink, 'receipt_id', d.email_receipt_id, 'prior_state', d.match_state,
    'location_id', d.location_id, 'receipt_released', v_released = 1);
end $$;

-- ── 5. THE AUTOMATIC LINK, IN ONE TRANSACTION WITH THE UNLINK RECORD (review W20-r4) ───────────────────────
create or replace function public.delivery_receipt_auto_link(
  p_delivery uuid, p_receipt uuid, p_location uuid, p_vendor uuid, p_delivery_date date, p_parse_state text, p_received_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  d public.vendor_deliveries%rowtype;
  r public.email_receipts%rowtype;
begin
  -- The caller says what it chose on. A missing value is a caller bug, never "any".
  if p_delivery is null or p_receipt is null or p_location is null or p_vendor is null or p_delivery_date is null
     or p_parse_state is null or p_received_at is null then
    raise exception 'invalid_input';
  end if;

  -- Lock order: the delivery, then the receipt (delivery_receipt_unlink's order). An unlink and an automatic link
  -- of one delivery therefore run one after the other, and each reads what the other committed.
  select * into d from public.vendor_deliveries where id = p_delivery for no key update;
  if not found then return jsonb_build_object('linked', false, 'reason', 'delivery_changed'); end if;
  select * into r from public.email_receipts where id = p_receipt for no key update;
  if not found then return jsonb_build_object('linked', false, 'reason', 'receipt_changed'); end if;

  -- A pair a manager unlinked is never put back by automation. Read AFTER the waits, under both locks, in the
  -- transaction that writes the link: an unlink that committed while this call waited (or at any time before)
  -- is seen here, whatever the caller read earlier.
  if exists (select 1 from public.delivery_receipt_unlinks u where u.delivery_id = d.id and u.receipt_id = r.id) then
    return jsonb_build_object('linked', false, 'reason', 'pair_unlinked');
  end if;

  -- The delivery is still the one the caller chose, and has no receipt (nothing is ever replaced).
  if d.email_receipt_id is not null or d.location_id is distinct from p_location or d.vendor_id is distinct from p_vendor
     or d.delivery_date is distinct from p_delivery_date then
    return jsonb_build_object('linked', false, 'reason', 'delivery_changed');
  end if;
  -- The receipt is still the one the caller chose: same shop, vendor, parse state and instant, not flagged for a
  -- person, not linked. Only an INVOICE takes a delivery's one receipt slot by itself (B112). And no other
  -- delivery may already point at it (a one-sided leftover is a refusal here, not a unique-index error).
  if r.linked_delivery_id is not null or r.attribution_conflict is distinct from false
     or r.location_id is distinct from p_location or r.vendor_guess_id is distinct from p_vendor
     or r.parse_state is distinct from p_parse_state or r.received_at is distinct from p_received_at
     or r.doc_kind is distinct from 'invoice'
     or exists (select 1 from public.vendor_deliveries x where x.email_receipt_id = r.id) then
    return jsonb_build_object('linked', false, 'reason', 'receipt_changed');
  end if;

  -- Both sides, in this transaction: a failure of either rolls back both.
  update public.email_receipts set linked_delivery_id = d.id where id = r.id;
  update public.vendor_deliveries set email_receipt_id = r.id where id = d.id;

  return jsonb_build_object('linked', true, 'location_id', d.location_id);
end $$;

-- ── PRIVILEGE CEILINGS ─────────────────────────────────────────────────────────────────────────────────────
-- Functions: service_role only (the staff JWT is a PostgREST bearer; `authenticated` must never execute these).
-- Table: service_role SELECT only (append-only by grant; the definer function is the one writer).
revoke all on function public.record_delivery_atomic(jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.delivery_match_verdict(uuid,text,text,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.delivery_receipt_unlink(uuid,uuid,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.delivery_receipt_auto_link(uuid,uuid,uuid,uuid,date,text,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.record_delivery_atomic(jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.delivery_match_verdict(uuid,text,text,text,uuid) to service_role;
grant execute on function public.delivery_receipt_unlink(uuid,uuid,text,uuid) to service_role;
grant execute on function public.delivery_receipt_auto_link(uuid,uuid,uuid,uuid,date,text,timestamptz) to service_role;
revoke all on public.delivery_receipt_unlinks from public, anon, authenticated, service_role;
grant select on public.delivery_receipt_unlinks to service_role;

do $$
declare f regprocedure; r text; p text;
begin
  foreach f in array array[
      'public.record_delivery_atomic(jsonb,jsonb,jsonb,jsonb)'::regprocedure,
      'public.delivery_match_verdict(uuid,text,text,text,uuid)'::regprocedure,
      'public.delivery_receipt_unlink(uuid,uuid,text,uuid)'::regprocedure,
      'public.delivery_receipt_auto_link(uuid,uuid,uuid,uuid,date,text,timestamptz)'::regprocedure] loop
    assert not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE'),
      '0327: receiving RPC escape';
    assert has_function_privilege('service_role', f, 'EXECUTE'), '0327: service_role must execute the receiving RPCs';
    assert not exists (select 1 from pg_proc q, lateral aclexplode(q.proacl) a where q.oid = f and a.grantee = 0),
      '0327: receiving RPC PUBLIC escape';
    assert (select prosecdef from pg_proc where oid = f)
       and (select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'],
      '0327: receiving RPCs must be security definer with the pinned search_path';
  end loop;
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      assert has_table_privilege(r, 'public.delivery_receipt_unlinks', p) = (r = 'service_role' and p = 'SELECT'),
        '0327: delivery_receipt_unlinks privilege escape';
    end loop;
  end loop;
  assert not exists (select 1 from pg_class c, lateral aclexplode(c.relacl) a
                      where c.oid = 'public.delivery_receipt_unlinks'::regclass and a.grantee = 0),
    '0327: delivery_receipt_unlinks PUBLIC escape';
  assert (select relrowsecurity from pg_class where oid = 'public.delivery_receipt_unlinks'::regclass),
    '0327: delivery_receipt_unlinks must have RLS on';
  assert (select count(*) from pg_policies where schemaname = 'public' and tablename = 'delivery_receipt_unlinks') = 4,
    '0327: delivery_receipt_unlinks must carry exactly its four deny policies';
end $$;
commit;
