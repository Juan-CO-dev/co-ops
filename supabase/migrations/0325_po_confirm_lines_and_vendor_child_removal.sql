-- Migration 0325_po_confirm_lines_and_vendor_child_removal
-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word).
-- Provenance: CO-OPS bug audit wave W19 (purchase orders and vendor order emails), bugs B108, B109, B110, B191
--   (found at 7494f738). Plan: the W19 build plan; owner decision W19-1 (a + note).
--
-- WHAT
--   1. purchase_orders.email_send_uncertain_at (B108, owner decision W19-1 a + note). A vendor order email whose
--      provider answer was UNCLEAR (a lost response, a 5xx) may have reached the vendor. The app now sends with a
--      per-confirmation Resend idempotency key (a retry cannot duplicate it), puts the PO back to confirmed, and
--      stamps this column the first time; the PO panel shows "email unconfirmed" while it is set and the vendor has
--      not confirmed (ack null). Nullable, no default, no backfill.
--   1b. purchase_orders.email_attempt_key / email_attempt_at (B108 fix round 1). Resend keeps an idempotency key for
--      24 hours only, so a retry two days after a lost response would be a NEW email. The app records the FIRST send
--      attempt for a confirmation (its idempotency key + when) BEFORE calling the provider, clears it again on a
--      definite rejection (nothing went out), and refuses a same-key retry past 23 hours (409 send_window_expired:
--      staff check with the vendor). A reopened + re-confirmed PO has a new key and replaces the record. Nullable,
--      no default, no backfill. Written by lib/po-email.ts only.
--   2. Trigger po_lines_draft_only (B109, B110). A purchase order's lines may change only while the PO is a DRAFT.
--      Before every INSERT / UPDATE of a po_lines row it takes FOR SHARE on the parent PO (so it waits for a
--      concurrent confirm / reopen holding the row) and refuses 'po_not_draft' (P0001) when the PO is past draft and
--      the write is an insert or changes an ORDER field (sku, qty, unit label, note). confirmPO's advisory columns
--      (price_cents_at_order, guide_position_snapshot, guide_section_snapshot) stay writable after the flip. Moving
--      a line to another PO is refused 'po_line_move_refused' (append-only; no writer does it).
--   3. confirm_purchase_order(po, expected_lines, snapshot, actor, confirmed_at, cutoff) (B109). The confirm flip:
--      locks the PO row (FOR NO KEY UPDATE), refuses 'po_not_found' / 'not_draft', re-reads po_lines and refuses
--      'lines_changed' unless they are EXACTLY the lines the app built the snapshot from (id, sku, qty, unit label),
--      then writes status + snapshot + confirmer + confirmed_at + cutoff in one statement. It NEVER writes po_lines
--      (an editor holds a line row lock while it waits for the PO lock in the trigger; a line write here would
--      deadlock with it). So a concurrent edit either commits first (the RPC sees it: lines_changed, the confirmer
--      reloads) or waits and is refused after the flip (po_not_draft → the editor is told). The window where a
--      saved edit silently missed the confirmed snapshot (B109) and the copied text diverged from it (B110) closes.
--   4. remove_vendor_contact(contact, actor) and remove_vendor_ordering_detail(detail, actor) (B191). Lock the
--      vendor row (FOR NO KEY UPDATE), count the vendor's active children, refuse 'last_contact' /
--      'last_ordering_detail' at a count of 1 or less, deactivate, refuse 'not_found' when nothing was active.
--      Two concurrent removals of a vendor's last two contacts now serialize; the second is refused.
--
-- EXISTING ROWS: nothing is rewritten. The trigger and the RPCs act on future writes only. The pre-flight below
--   REPORTS (NOTICE, read-only) for CC: confirmed-or-later POs whose po_lines differ from their confirmed snapshot
--   (past B109/B110 races), po_lines whose SKU belongs to another vendor than the PO (past B111 merges), and
--   vendors with zero active contacts or ordering details (past B191 races or legacy rows). Fixing any of them is a
--   data decision, not part of this file.
--
-- APP COMPATIBILITY: the app works before and after this file.
--   Before: confirmPO, removeVendorContact and removeVendorOrderingDetail fall back to their pre-0325 statements
--   when the RPC is missing (PGRST202 / 42883) — the races stay open until this is applied; the unconfirmed-email
--   mark is not written or shown, and (fix round 2) the AUTOMATIC VENDOR EMAIL SEND IS REFUSED 503
--   attempt_not_recorded, nothing sent: without the attempt record a retry could duplicate an order past Resend's
--   24 h key. Copy / mark-placed by hand still work.
--   After, with OLD code still deployed: the old confirm is a plain guarded UPDATE (still works; the race stays open
--   for that deployment), and an old updateDraftLines that loses the race gets a 500 instead of a named 409 (it
--   was a silent wrong success before). REQUIRED ORDER (fix round 2): apply this file, THEN merge / deploy the W19
--   PR (house rule: migration right before merge). Before deploying, reconcile with the vendor any PO whose email
--   send failed under the old code and is still confirmed: the old code sent no key and kept no attempt record.
-- ROLLBACK: drop trigger po_lines_draft_only on public.po_lines; drop the four functions; the three columns are
--   harmless (the app reads them tolerantly). The app falls back by itself when the RPCs are gone.
--
-- DEPENDS ON: 0092 (vendor_contacts, vendor_ordering_details), 0174 (purchase_orders, po_lines), 0190
--   (po_lines_po_sku_uq), 0205 (po_lines.guide_section_snapshot). Re-applies cleanly (idempotent).
--
-- PRE-FLIGHT (MCP, read-only, before apply): the DO block below refuses without the tables / index and prints the
--   three report counts as NOTICEs. After apply, verify information_schema.routine_privileges for the four
--   functions: service_role EXECUTE only (the CEILINGS block asserts it too).
--
-- SIM PROOF (two sessions, sim only, run by CC): scripts/sim-0325-po-lock-check-management.mjs.
-- OFFLINE PROOF: node scripts/sql-harness-0325.mjs (PGlite), pinned by tests/po-confirm-lines-migration.test.ts.
begin;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.purchase_orders') is null or to_regclass('public.po_lines') is null
     or to_regclass('public.vendors') is null or to_regclass('public.vendor_items') is null then
    raise exception '0325: 0174 (purchase_orders, po_lines) must be applied first';
  end if;
  if to_regclass('public.vendor_contacts') is null or to_regclass('public.vendor_ordering_details') is null then
    raise exception '0325: 0092 (vendor_contacts, vendor_ordering_details) must be applied first';
  end if;
  if to_regclass('public.po_lines_po_sku_uq') is null then
    raise exception '0325: 0190 (po_lines_po_sku_uq) must be applied first';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'po_lines'
                  and column_name = 'guide_section_snapshot') then
    raise exception '0325: 0205 (po_lines.guide_section_snapshot) must be applied first';
  end if;
  raise notice '0325 report: % confirmed-or-later PO(s) whose po_lines differ from confirmed_snapshot (B109/B110)',
    (select count(distinct po.id) from public.purchase_orders po
       join public.po_lines l on l.po_id = po.id
      where po.status <> 'draft' and po.confirmed_snapshot is not null
        and not exists (
          select 1 from jsonb_array_elements(case when jsonb_typeof(po.confirmed_snapshot -> 'lines') = 'array'
                                                  then po.confirmed_snapshot -> 'lines' else '[]'::jsonb end) e
           where e ->> 'skuId' = l.sku_id::text
             and jsonb_typeof(e -> 'qty') = 'number' and (e ->> 'qty')::numeric = l.order_qty));
  raise notice '0325 report: % po_lines row(s) whose SKU belongs to another vendor than the PO (B111)',
    (select count(*) from public.po_lines l join public.purchase_orders po on po.id = l.po_id
       join public.vendor_items s on s.id = l.sku_id
      where s.vendor_id is distinct from po.vendor_id);
  raise notice '0325 report: % vendor(s) with zero active contacts, % with zero active ordering details (B191)',
    (select count(*) from public.vendors v where not exists
       (select 1 from public.vendor_contacts c where c.vendor_id = v.id and c.active)),
    (select count(*) from public.vendors v where not exists
       (select 1 from public.vendor_ordering_details d where d.vendor_id = v.id and d.active));
end $$;

-- ── 1. THE UNCONFIRMED-EMAIL MARK (B108) ────────────────────────────────────────────────────────
alter table public.purchase_orders add column if not exists email_send_uncertain_at timestamptz null;
comment on column public.purchase_orders.email_send_uncertain_at is
  'W19/B108: first time a vendor order email got an unclear provider answer (it may have reached the vendor). Shown as "email unconfirmed" until ack is filled. Written by lib/po-email.ts only.';
alter table public.purchase_orders add column if not exists email_attempt_key text null;
alter table public.purchase_orders add column if not exists email_attempt_at timestamptz null;
comment on column public.purchase_orders.email_attempt_key is
  'W19/B108 fix round 1: the Resend idempotency key of the confirmation whose first vendor-email attempt email_attempt_at records. Written by lib/po-email.ts only.';
comment on column public.purchase_orders.email_attempt_at is
  'W19/B108 fix round 1: when the first vendor-email attempt for email_attempt_key started (before the provider call). A same-key retry past 23 h is refused: Resend keeps keys 24 h only. Cleared on a definite rejection. Written by lib/po-email.ts only.';

-- ── 2. PO LINES CHANGE ONLY WHILE THE PO IS A DRAFT (B109, B110) ────────────────────────────────
create or replace function public.po_lines_draft_only()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_status text;
begin
  if tg_op = 'UPDATE' and new.po_id is distinct from old.po_id then
    raise exception 'po_line_move_refused' using errcode = 'P0001';
  end if;
  -- FOR SHARE conflicts with confirm_purchase_order's / reopen's row lock: this write waits for them, then sees the
  -- committed status. The FK check's KEY SHARE alone would not.
  select po.status into v_status from public.purchase_orders po where po.id = new.po_id for share;
  if v_status is null then
    raise exception 'po_not_found' using errcode = 'P0001';
  end if;
  if v_status <> 'draft' then
    if tg_op = 'INSERT' then
      raise exception 'po_not_draft' using errcode = 'P0001';
    end if;
    if new.sku_id is distinct from old.sku_id
       or new.order_qty is distinct from old.order_qty
       or new.order_unit_label is distinct from old.order_unit_label
       or new.note is distinct from old.note then
      raise exception 'po_not_draft' using errcode = 'P0001';
    end if;
  end if;
  -- price_cents_at_order / guide_*_snapshot stay writable: confirmPO's advisory freeze after the flip.
  return new;
end $$;

drop trigger if exists po_lines_draft_only on public.po_lines;
create trigger po_lines_draft_only before insert or update on public.po_lines
  for each row execute function public.po_lines_draft_only();

-- ── 3. THE CONFIRM FLIP, BOUND TO THE LINES IT FROZE (B109) ─────────────────────────────────────
create or replace function public.confirm_purchase_order(
  p_po_id uuid, p_expected_lines jsonb, p_snapshot jsonb, p_actor uuid, p_confirmed_at timestamptz, p_cutoff timestamptz
) returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_status text;
begin
  select po.status into v_status from public.purchase_orders po where po.id = p_po_id for no key update;
  if v_status is null then raise exception 'po_not_found' using errcode = 'P0001'; end if;
  if v_status <> 'draft' then raise exception 'not_draft' using errcode = 'P0001'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
     or p_expected_lines is null or jsonb_typeof(p_expected_lines) <> 'array' then
    raise exception 'invalid_confirm_payload' using errcode = 'P0001';
  end if;
  -- The lines must be EXACTLY those the snapshot was built from: same count, every expected row present with the
  -- same sku, qty and unit label (a line inserted or edited since the app read them refuses).
  if (select count(*) from public.po_lines l where l.po_id = p_po_id) <> jsonb_array_length(p_expected_lines)
     or exists (
       select 1 from jsonb_to_recordset(p_expected_lines) as e(id uuid, sku_id uuid, order_qty numeric, order_unit_label text)
         left join public.po_lines l on l.id = e.id and l.po_id = p_po_id
        where e.id is null or l.id is null or l.sku_id is distinct from e.sku_id
           or l.order_qty is distinct from e.order_qty or l.order_unit_label is distinct from e.order_unit_label) then
    raise exception 'lines_changed' using errcode = 'P0001';
  end if;
  update public.purchase_orders
     set status = 'confirmed', confirmed_snapshot = p_snapshot, confirmed_by = p_actor,
         confirmed_at = p_confirmed_at, cutoff_at_confirm = p_cutoff
   where id = p_po_id and status = 'draft';
  if not found then raise exception 'not_draft' using errcode = 'P0001'; end if;
  -- NEVER write po_lines here (lock order: an editor holds its line row, then waits for this PO row).
end $$;

-- ── 4. VENDOR CHILD REMOVAL, SERIALIZED PER VENDOR (B191) ───────────────────────────────────────
create or replace function public.remove_vendor_contact(p_contact_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_vendor uuid; v_active integer;
begin
  select c.vendor_id into v_vendor from public.vendor_contacts c where c.id = p_contact_id;
  if v_vendor is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  perform 1 from public.vendors v where v.id = v_vendor for no key update;   -- serializes removals for this vendor
  select count(*) into v_active from public.vendor_contacts c where c.vendor_id = v_vendor and c.active;
  if v_active <= 1 then raise exception 'last_contact' using errcode = 'P0001'; end if;
  update public.vendor_contacts set active = false, updated_by = p_actor, updated_at = now()
   where id = p_contact_id and active;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
end $$;

create or replace function public.remove_vendor_ordering_detail(p_detail_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_vendor uuid; v_active integer;
begin
  select d.vendor_id into v_vendor from public.vendor_ordering_details d where d.id = p_detail_id;
  if v_vendor is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  perform 1 from public.vendors v where v.id = v_vendor for no key update;   -- serializes removals for this vendor
  select count(*) into v_active from public.vendor_ordering_details d where d.vendor_id = v_vendor and d.active;
  if v_active <= 1 then raise exception 'last_ordering_detail' using errcode = 'P0001'; end if;
  update public.vendor_ordering_details set active = false, updated_by = p_actor, updated_at = now()
   where id = p_detail_id and active;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
end $$;

-- ── CEILINGS ────────────────────────────────────────────────────────────────────────────────────
do $$
declare f regprocedure;
begin
  -- The trigger function is never called directly by anyone (a trigger fires without an EXECUTE check).
  revoke all on function public.po_lines_draft_only() from public, anon, authenticated, service_role;
  assert not has_function_privilege('anon', 'public.po_lines_draft_only()', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.po_lines_draft_only()', 'EXECUTE'), '0325 trigger fn escape';
  foreach f in array array[
    'public.confirm_purchase_order(uuid,jsonb,jsonb,uuid,timestamptz,timestamptz)'::regprocedure,
    'public.remove_vendor_contact(uuid,uuid)'::regprocedure,
    'public.remove_vendor_ordering_detail(uuid,uuid)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
    assert not has_function_privilege('anon', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE'), '0325 RPC escape';
    assert has_function_privilege('service_role', f, 'EXECUTE'), '0325 RPC service grant';
    assert not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid = f and a.grantee = 0), '0325 PUBLIC RPC escape';
    assert (select prosecdef from pg_proc where oid = f), '0325 RPC definer';
  end loop;
  -- The PO tables keep 0174's posture: nothing for the PostgREST user roles.
  assert not has_table_privilege('anon', 'public.purchase_orders', 'SELECT')
     and not has_table_privilege('authenticated', 'public.purchase_orders', 'UPDATE')
     and not has_table_privilege('authenticated', 'public.po_lines', 'INSERT'), '0325 PO table escape';
end $$;
commit;
