-- Migration 0234_customer_profiles
-- AUTHORED 2026-10-08. NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod. Nothing writes until
-- CUSTOMER_PROFILES=1 is set after the apply (the app deploys before this migration).
--
-- Customer profiles + marketing consent (Juan 2026-10-07/08, GO-coops-customer-profiles):
--   "Profiles for INTERNAL tracking; contact data usable for marketing ONLY where the person opted in.
--    No workarounds."
--
-- A. customers: one row per person. Contact data lives in customer_identifiers (kind email|phone,
--    normalised: email lowercase, phone E.164), one owner per value, so a person can carry more than
--    one email/phone and a merge moves identifiers whole. Names are kept for the profile; a manager
--    sees names and stats, never an identifier (enforced in the app: every read is service-role).
-- B. Identity: an incoming order/import resolves by EMAIL first, then PHONE (strong, automatic). When
--    the email and the phone already belong to two different people we never merge two existing
--    profiles on our own: a high-confidence suggestion is filed for a manager. Full name + card
--    (brand + last4 only; Toast sends no PAN) is ONLY ever a suggestion (customer_merge_suggestions),
--    confirmed by a manager through customer_merge. Never an automatic merge on a name.
-- C. customer_orders: one link row per order (Toast order via its latest pointer, catering order,
--    ezCater order). No contact data on it; contact_masked says the channel hid the contact.
-- D. customer_consent_events: APPEND-ONLY (service_role SELECT + INSERT only). The current status of a
--    (customer, channel) is its latest event (effective_at, an opt-out wins a tie). subject_sha256 names
--    the exact email/phone the consent is about, so an export only ever uses the opted-in address.
-- E. customer_consent_imports (+ chunks, members): the Toast Web Marketing CSV path (and the seam for
--    a Toast API sync, source toast_marketing_api). begin -> chunk (<= 1000 rows, so no statement nears
--    the 8 s timeout) -> finish. Idempotent by (source, sha256 of the normalised rows): a completed
--    import replays, a half-applied one resumes. Diffed against the previous COMPLETED import (absence =
--    opted out unless the file carries a status column; a wave over 10% / 25 people needs a human yes).
--    The FIRST import of a source is the baseline and never shows as "newly opted in".
--    Juan 2026-10-09: the Toast marketing list is built ONLY from explicit opt-ins (not auto-fed from
--    transactions), so a listed row IS an explicit opt-in event, source toast_csv_import, dated by the
--    export date.
--    r1 (Astra BC-031 P1): replay identity = rows + export date + mode, and only the LATEST completed
--    import can replay; an older identical list is a NEW snapshot that diffs against the latest.
--    r1 (Astra BC-036): an import's events are PENDING until finish completes it (every consent read
--    counts only events of completed imports), so customer_consent_import_cancel neutralises a bad
--    half-applied import without touching the append-only history, and a corrected file can proceed.
--    r1 (Astra BC-031 P2): relay/placeholder addresses are refused in SQL too (customer_email_is_relay),
--    whatever path they arrive by.
--    r1 (Astra BC-037): identity resolution is serialised (one transaction-scoped advisory lock taken by
--    every identity writer), and an identifier owned by anyone else after the insert is a loud error,
--    never a silent second profile.
-- F. customer_suppressions: sha256 of every identifier a person asked us to delete. Ingest and import
--    skip a suppressed email/phone, so a deleted person is never silently re-created.
-- G. Delete-on-request (customer_erase) and retention (customer_retention_sweep): identifiers and
--    cards are deleted, names cleared, an opted_out event per channel appended (source
--    delete_request / retention), the order links stay as anonymous stats.
-- H. Marketing reads: customer_marketing_export returns ONLY rows whose latest event is opted_in, for
--    the subject address, never an erased or merged-away profile. It has no parameter that could widen
--    that; the app filters again before writing any file.
--
-- Every table: RLS on, no allow policy, explicit no_user_delete, no PostgREST-role grants. Every RPC is
-- SECURITY DEFINER with a pinned search_path and is executable by service_role only.
begin;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text check (full_name is null or length(full_name) between 1 and 200),
  first_name text check (first_name is null or length(first_name) between 1 and 100),
  last_name text check (last_name is null or length(last_name) between 1 and 100),
  -- Lowercased, single-spaced full name: the only thing a name suggestion compares.
  name_key text check (name_key is null or name_key = lower(name_key)),
  primary_location_id uuid references public.locations(id),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  sources text[] not null default '{}' check (sources <@ array['toast_pos','toast_online','toast_app','toast_third_party',
    'catering','ezcater','toast_csv_import','toast_marketing_api']::text[]),
  -- Channels that handed us a relay/masked contact we refused to store (e.g. 'doordash').
  masked_channels text[] not null default '{}',
  merged_into uuid references public.customers(id),
  merged_at timestamptz,
  merged_by uuid references public.users(id),
  erased_at timestamptz,
  erased_by uuid references public.users(id),
  erase_reason text check (erase_reason is null or erase_reason in ('delete_request','retention')),
  created_at timestamptz not null default now(),
  check (merged_into is null or merged_into <> id),
  check ((merged_into is null) = (merged_at is null)),
  check ((erased_at is null) = (erase_reason is null)),
  check (erased_at is null or (full_name is null and first_name is null and last_name is null and name_key is null))
);
create index customers_merged_into on public.customers(merged_into) where merged_into is not null;
create index customers_name_key on public.customers(name_key) where name_key is not null;
create index customers_last_seen on public.customers(last_seen_at);

create table public.customer_identifiers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  kind text not null check (kind in ('email','phone')),
  value text not null,
  value_sha256 text not null check (value_sha256 ~ '^[0-9a-f]{64}$'),
  source text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (kind, value),
  check (value_sha256 = encode(sha256(convert_to(value,'UTF8')),'hex')),
  check (kind <> 'email' or (value = lower(btrim(value)) and value ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  check (kind <> 'phone' or value ~ '^\+[1-9][0-9]{7,14}$')
);
create index customer_identifiers_customer on public.customer_identifiers(customer_id);

-- Card evidence for "likely same person" ONLY. Brand + last four. Never a PAN, never an expiry.
create table public.customer_cards (
  customer_id uuid not null references public.customers(id),
  brand text not null check (brand in ('VISA','MASTERCARD','AMEX','DISCOVER','JCB','DINERS','UNIONPAY','OTHER')),
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (customer_id, brand, last4)
);
create index customer_cards_card on public.customer_cards(brand, last4);

create table public.customer_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  location_id uuid not null references public.locations(id),
  source_kind text not null check (source_kind in ('toast','catering','ezcater')),
  toast_order_guid text,
  catering_order_id uuid references public.catering_orders(id),
  ezcater_order_id uuid references public.ezcater_orders(id),
  business_date date not null,
  channel text not null check (channel in ('dine_in','takeout','online','app','delivery','third_party','catering','unknown')),
  total_cents bigint,
  -- Item names + quantities for "favourite items" (<= 50 lines, no free text: notes are dropped upstream).
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items)='array' and jsonb_array_length(items) <= 50),
  contact_masked boolean not null default false,
  linked_at timestamptz not null default now(),
  check ((source_kind='toast') = (toast_order_guid is not null)),
  check ((source_kind='catering') = (catering_order_id is not null)),
  check ((source_kind='ezcater') = (ezcater_order_id is not null)),
  -- A Toast link names a captured order: the latest pointer is (location, guid) and is never deleted.
  foreign key (location_id, toast_order_guid) references public.toast_order_latest_pointers(location_id, order_guid),
  unique (location_id, toast_order_guid),
  unique (catering_order_id),
  unique (ezcater_order_id)
);
create index customer_orders_customer on public.customer_orders(customer_id, business_date);
create index customer_orders_location on public.customer_orders(location_id, business_date);

create table public.customer_consent_imports (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('toast_csv_import','toast_marketing_api')),
  rows_sha256 text not null check (rows_sha256 ~ '^[0-9a-f]{64}$'),
  export_date date not null,
  is_baseline boolean not null,
  explicit_status boolean not null,
  chunk_count integer not null check (chunk_count between 1 and 100),
  status text not null default 'running' check (status in ('running','completed','failed','cancelled')),
  rows_total integer not null default 0 check (rows_total >= 0),
  new_opt_ins integer not null default 0 check (new_opt_ins >= 0),
  opt_outs integer not null default 0 check (opt_outs >= 0),
  unchanged integer not null default 0 check (unchanged >= 0),
  stale integer not null default 0 check (stale >= 0),
  suppressed integer not null default 0 check (suppressed >= 0),
  new_customers integer not null default 0 check (new_customers >= 0),
  masked integer not null default 0 check (masked >= 0),
  actor_id uuid references public.users(id),
  cancelled_by uuid references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  check ((status = 'running') = (finished_at is null)),
  check ((status = 'cancelled') = (cancelled_by is not null))
);
-- No uniqueness on the rows hash: the same list on a later date is a NEW snapshot (r1 BC-031).
create index customer_consent_imports_order on public.customer_consent_imports(source, status, export_date desc, created_at desc);
create unique index customer_consent_imports_one_running on public.customer_consent_imports(source) where status = 'running';

-- One row per applied chunk (<= 1000 rows each, so no statement nears the 8 s timeout). A retried chunk
-- replays its stored counts instead of being applied twice.
create table public.customer_consent_import_chunks (
  import_id uuid not null references public.customer_consent_imports(id),
  chunk_index integer not null check (chunk_index >= 0),
  rows_total integer not null, new_opt_ins integer not null, opt_outs integer not null, unchanged integer not null,
  stale integer not null, suppressed integer not null, new_customers integer not null, masked integer not null,
  primary key (import_id, chunk_index)
);

-- Who was subscribed (or explicitly unsubscribed) in each import: the "last import" a diff runs against.
create table public.customer_consent_import_members (
  import_id uuid not null references public.customer_consent_imports(id),
  customer_id uuid not null references public.customers(id),
  status text not null check (status in ('opted_in','opted_out')),
  primary key (import_id, customer_id)
);

create table public.customer_consent_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  channel text not null check (channel in ('email','sms')),
  status text not null check (status in ('opted_in','opted_out')),
  source text not null check (source in ('toast_marketing_api','toast_csv_import','toast_order','catering_portal','delete_request','retention')),
  -- The exact address this consent is about (sha256 of the normalised value); null = the whole channel
  -- (a delete request / retention opt-out covers every address).
  subject_sha256 text check (subject_sha256 is null or subject_sha256 ~ '^[0-9a-f]{64}$'),
  effective_at timestamptz not null,
  import_run_id uuid references public.customer_consent_imports(id),
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by uuid references public.users(id),
  check (status = 'opted_out' or subject_sha256 is not null),
  check ((source in ('toast_csv_import','toast_marketing_api')) = (import_run_id is not null))
);
create index customer_consent_events_customer on public.customer_consent_events(customer_id, channel, effective_at desc);
create index customer_consent_events_import on public.customer_consent_events(import_run_id) where import_run_id is not null;

create table public.customer_merge_suggestions (
  id uuid primary key default gen_random_uuid(),
  customer_a uuid not null references public.customers(id),
  customer_b uuid not null references public.customers(id),
  confidence numeric(3,2) not null check (confidence > 0 and confidence <= 1),
  reasons text[] not null check (cardinality(reasons) > 0 and reasons <@ array['same_full_name','similar_name','shared_card','same_shop','email_phone_split']::text[]),
  status text not null default 'open' check (status in ('open','confirmed','dismissed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.users(id),
  check (customer_a < customer_b),
  check ((status = 'open') = (decided_at is null)),
  unique (customer_a, customer_b)
);
create index customer_merge_suggestions_open on public.customer_merge_suggestions(status, confidence desc) where status = 'open';

create table public.customer_suppressions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('email','phone')),
  value_sha256 text not null check (value_sha256 ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('delete_request','retention')),
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  unique (kind, value_sha256)
);

-- The current consent per (person, channel): the latest event over the person and everyone merged into
-- them. An opt-out wins a tie on effective_at; recorded_at then id break what is left.
create view public.customer_consent_current with (security_invoker=true) as
select distinct on (r.root_id, e.channel)
  r.root_id as customer_id, e.channel, e.status, e.source, e.subject_sha256, e.effective_at, e.import_run_id, e.id as event_id
from public.customer_consent_events e
join (select id, coalesce(merged_into, id) as root_id from public.customers) r on r.id = e.customer_id
-- An import's events count only once the import COMPLETED (pending while running; never if cancelled).
where e.import_run_id is null
   or exists(select 1 from public.customer_consent_imports i where i.id = e.import_run_id and i.status = 'completed')
order by r.root_id, e.channel, e.effective_at desc, (e.status = 'opted_out') desc, e.recorded_at desc, e.id desc;

-- ───────────────────────────── private helpers (no grants) ─────────────────────────────

create function public.customer_sha256(p_value text) returns text
language sql immutable set search_path = pg_catalog, public as $$
  select encode(sha256(convert_to(p_value,'UTF8')),'hex')
$$;

create function public.customer_root(p_id uuid) returns uuid
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(merged_into, id) from public.customers where id = p_id
$$;

-- Relay / placeholder addresses a marketplace or a hurried till hands us: never a person's email. The
-- domain list is MASKED_EMAIL_DOMAINS in lib/customers/identity-shared.ts (pinned equal by a test).
create function public.customer_email_is_relay(p_email text) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select split_part(p_email,'@',2) = any(array['doordash.com','ubereats.com','uber.com','grubhub.com','seamless.com','postmates.com',
      'caviar.com','ezcater.com','marketplace.amazon.com','relay.toasttab.com','toasttab.com']::text[])
    or exists(select 1 from unnest(array['doordash.com','ubereats.com','uber.com','grubhub.com','seamless.com','postmates.com',
      'caviar.com','ezcater.com','marketplace.amazon.com','relay.toasttab.com','toasttab.com']::text[]) d
      where split_part(p_email,'@',2) like '%.' || d)
    or split_part(p_email,'@',2) ~ '(^|\.)(relay|masked|anonymi[sz]ed|proxy)\.'
    or split_part(p_email,'@',1) ~ '^(relay|masked)[+.-]'
    or split_part(p_email,'@',1) ~ '^(no-?e?mail|none|na|n/a|noreply|no-reply|test|null|x+)$'
$$;

-- Every identity writer takes this ONE transaction-scoped lock first (r1 BC-037): two captures of the
-- same new email can no longer both see "no owner" and create two people. Re-entrant within a txn.
create function public.customer_identity_lock() returns void
language sql volatile set search_path = pg_catalog, public as $$
  select pg_advisory_xact_lock(hashtextextended('customer-identity',0))
$$;

-- Resolve (or create) the person behind one contact record. Email first, then phone. Returns null when
-- there is nothing to identify by or every identifier is suppressed.
create function public.customer_resolve(
  p_email text, p_phone text, p_full_name text, p_first_name text, p_last_name text,
  p_location_id uuid, p_seen_at timestamptz, p_source text, p_masked_channel text,
  out customer_id uuid, out created boolean, out suppressed boolean)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email,''))),'');
  v_phone text := nullif(btrim(coalesce(p_phone,'')),'');
  v_by_email uuid; v_by_phone uuid; v_a uuid; v_b uuid; v_name text; v_owner uuid;
begin
  created := false; suppressed := false; customer_id := null;
  perform public.customer_identity_lock();
  -- A relay or placeholder address is not the person's: never stored, never consent (r1 BC-031 P2).
  if v_email is not null and public.customer_email_is_relay(v_email) then v_email := null; end if;
  if v_email is not null and exists(select 1 from public.customer_suppressions s where s.kind='email' and s.value_sha256=public.customer_sha256(v_email)) then
    v_email := null; suppressed := true;
  end if;
  if v_phone is not null and exists(select 1 from public.customer_suppressions s where s.kind='phone' and s.value_sha256=public.customer_sha256(v_phone)) then
    v_phone := null; suppressed := true;
  end if;
  if v_email is null and v_phone is null then return; end if;
  -- A suppressed email on the same record means the PERSON asked to be deleted: never attach them by phone.
  if suppressed then return; end if;

  if v_email is not null then
    select public.customer_root(i.customer_id) into v_by_email from public.customer_identifiers i where i.kind='email' and i.value=v_email;
  end if;
  if v_phone is not null then
    select public.customer_root(i.customer_id) into v_by_phone from public.customer_identifiers i where i.kind='phone' and i.value=v_phone;
  end if;
  customer_id := coalesce(v_by_email, v_by_phone);
  v_name := nullif(regexp_replace(btrim(coalesce(p_full_name,'')),'\s+',' ','g'),'');

  if customer_id is null then
    insert into public.customers(full_name, first_name, last_name, name_key, primary_location_id, first_seen_at, last_seen_at, sources, masked_channels)
    values (v_name, nullif(btrim(coalesce(p_first_name,'')),''), nullif(btrim(coalesce(p_last_name,'')),''), lower(v_name), p_location_id,
      coalesce(p_seen_at, now()), coalesce(p_seen_at, now()), array[p_source],
      case when p_masked_channel is null then '{}'::text[] else array[p_masked_channel] end)
    returning id into customer_id;
    created := true;
  else
    update public.customers c set
      full_name = coalesce(c.full_name, v_name),
      first_name = coalesce(c.first_name, nullif(btrim(coalesce(p_first_name,'')),'')),
      last_name = coalesce(c.last_name, nullif(btrim(coalesce(p_last_name,'')),'')),
      name_key = coalesce(c.name_key, lower(v_name)),
      primary_location_id = coalesce(c.primary_location_id, p_location_id),
      first_seen_at = least(c.first_seen_at, coalesce(p_seen_at, c.first_seen_at)),
      last_seen_at = greatest(c.last_seen_at, coalesce(p_seen_at, c.last_seen_at)),
      sources = case when p_source = any(c.sources) then c.sources else c.sources || p_source end,
      masked_channels = case when p_masked_channel is null or p_masked_channel = any(c.masked_channels) then c.masked_channels
                             else c.masked_channels || p_masked_channel end
    where c.id = customer_id;
  end if;

  -- The email and the phone belong to two different people already: file it, never merge it.
  if v_by_email is not null and v_by_phone is not null and v_by_email <> v_by_phone then
    v_a := least(v_by_email, v_by_phone); v_b := greatest(v_by_email, v_by_phone);
    insert into public.customer_merge_suggestions(customer_a, customer_b, confidence, reasons)
    values (v_a, v_b, 0.90, array['email_phone_split']) on conflict (customer_a, customer_b) do nothing;
  end if;

  if v_email is not null then
    insert into public.customer_identifiers(customer_id, kind, value, value_sha256, source, first_seen_at, last_seen_at)
    values (customer_id, 'email', v_email, public.customer_sha256(v_email), p_source, coalesce(p_seen_at, now()), coalesce(p_seen_at, now()))
    on conflict (kind, value) do update set last_seen_at = greatest(customer_identifiers.last_seen_at, excluded.last_seen_at);
    -- Reconcile (r1 BC-037): the email must now belong to THIS person, or nothing attaches to anyone.
    select public.customer_root(i.customer_id) into v_owner from public.customer_identifiers i where i.kind='email' and i.value=v_email;
    if v_owner is distinct from customer_id then raise exception 'customer_identity_conflict'; end if;
  end if;
  if v_phone is not null then
    insert into public.customer_identifiers(customer_id, kind, value, value_sha256, source, first_seen_at, last_seen_at)
    values (customer_id, 'phone', v_phone, public.customer_sha256(v_phone), p_source, coalesce(p_seen_at, now()), coalesce(p_seen_at, now()))
    on conflict (kind, value) do update set last_seen_at = greatest(customer_identifiers.last_seen_at, excluded.last_seen_at);
    -- A phone already owned by someone else stays theirs (the split is a suggestion above); a phone that
    -- resolved this person must be theirs.
    if v_by_email is null then
      select public.customer_root(i.customer_id) into v_owner from public.customer_identifiers i where i.kind='phone' and i.value=v_phone;
      if v_owner is distinct from customer_id then raise exception 'customer_identity_conflict'; end if;
    end if;
  end if;
end $$;

-- ───────────────────────────── writers (service_role) ─────────────────────────────

-- One captured Toast day page: rows were normalised by lib/customers (email lowercased, phone E.164,
-- relay contacts already dropped, items without notes, cards = brand + last4). Only orders whose
-- latest pointer exists are linked (capture publishes the pointer before this runs).
create function public.customer_ingest_orders(p_location_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_row jsonb; v_res record; v_linked int := 0; v_skipped int := 0; v_suppressed int := 0; v_created int := 0;
  v_customers uuid[] := '{}'; v_card jsonb; v_seen timestamptz;
begin
  if p_location_id is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'customer_ingest_invalid';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if not exists(select 1 from public.toast_order_latest_pointers p where p.location_id=p_location_id and p.order_guid=v_row->>'order_guid') then
      v_skipped := v_skipped + 1; continue;
    end if;
    v_seen := coalesce((v_row->>'seen_at')::timestamptz, ((v_row->>'business_date')::date)::timestamptz);
    select * into v_res from public.customer_resolve(v_row->>'email', v_row->>'phone', v_row->>'full_name', v_row->>'first_name', v_row->>'last_name',
      p_location_id, v_seen, v_row->>'source', v_row->>'masked_channel');
    if v_res.suppressed then v_suppressed := v_suppressed + 1; end if;
    if v_res.customer_id is null then v_skipped := v_skipped + 1; continue; end if;
    if v_res.created then v_created := v_created + 1; end if;
    insert into public.customer_orders(customer_id, location_id, source_kind, toast_order_guid, business_date, channel, total_cents, items, contact_masked)
    values (v_res.customer_id, p_location_id, 'toast', v_row->>'order_guid', (v_row->>'business_date')::date, v_row->>'channel',
      (v_row->>'total_cents')::bigint, coalesce(v_row->'items','[]'::jsonb), coalesce((v_row->>'contact_masked')::boolean, false))
    on conflict (location_id, toast_order_guid) do update set
      business_date = excluded.business_date, channel = excluded.channel, total_cents = excluded.total_cents,
      items = excluded.items, contact_masked = excluded.contact_masked;
    for v_card in select value from jsonb_array_elements(coalesce(v_row->'cards','[]'::jsonb)) loop
      insert into public.customer_cards(customer_id, brand, last4, first_seen_at, last_seen_at)
      values (v_res.customer_id, v_card->>'brand', v_card->>'last4', v_seen, v_seen)
      on conflict (customer_id, brand, last4) do update set
        first_seen_at = least(customer_cards.first_seen_at, excluded.first_seen_at),
        last_seen_at = greatest(customer_cards.last_seen_at, excluded.last_seen_at);
    end loop;
    v_linked := v_linked + 1;
    if not v_res.customer_id = any(v_customers) then v_customers := v_customers || v_res.customer_id; end if;
  end loop;
  return jsonb_build_object('linked', v_linked, 'skipped', v_skipped, 'suppressed', v_suppressed, 'created', v_created,
    'customer_ids', to_jsonb(v_customers));
end $$;

-- Catering (the house book) and ezCater orders. The caller reads the existing ledgers; this only links.
create function public.customer_link_catering(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row jsonb; v_res record; v_linked int := 0; v_skipped int := 0; v_created int := 0; v_kind text; v_seen timestamptz;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'customer_ingest_invalid'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_kind := v_row->>'kind';
    if v_kind not in ('catering','ezcater') then raise exception 'customer_ingest_invalid'; end if;
    v_seen := ((v_row->>'business_date')::date)::timestamptz;
    select * into v_res from public.customer_resolve(v_row->>'email', v_row->>'phone', v_row->>'full_name', null, null,
      (v_row->>'location_id')::uuid, v_seen, v_kind, v_row->>'masked_channel');
    if v_res.customer_id is null then v_skipped := v_skipped + 1; continue; end if;
    if v_res.created then v_created := v_created + 1; end if;
    if v_kind = 'catering' then
      insert into public.customer_orders(customer_id, location_id, source_kind, catering_order_id, business_date, channel, total_cents, items, contact_masked)
      values (v_res.customer_id, (v_row->>'location_id')::uuid, 'catering', (v_row->>'order_id')::uuid, (v_row->>'business_date')::date, 'catering',
        (v_row->>'total_cents')::bigint, '[]'::jsonb, coalesce((v_row->>'contact_masked')::boolean,false))
      on conflict (catering_order_id) do update set business_date = excluded.business_date, total_cents = excluded.total_cents;
    else
      insert into public.customer_orders(customer_id, location_id, source_kind, ezcater_order_id, business_date, channel, total_cents, items, contact_masked)
      values (v_res.customer_id, (v_row->>'location_id')::uuid, 'ezcater', (v_row->>'order_id')::uuid, (v_row->>'business_date')::date, 'catering',
        (v_row->>'total_cents')::bigint, '[]'::jsonb, coalesce((v_row->>'contact_masked')::boolean,false))
      on conflict (ezcater_order_id) do update set business_date = excluded.business_date, total_cents = excluded.total_cents;
    end if;
    v_linked := v_linked + 1;
  end loop;
  return jsonb_build_object('linked', v_linked, 'skipped', v_skipped, 'created', v_created);
end $$;

-- A name + card (or other) suggestion computed by the pure scorer in lib/customers. Never a merge.
create function public.customer_suggest_merge(p_a uuid, p_b uuid, p_confidence numeric, p_reasons text[])
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_a uuid := public.customer_root(p_a); v_b uuid := public.customer_root(p_b); v_lo uuid; v_hi uuid; v_n int;
begin
  if v_a is null or v_b is null or v_a = v_b then return false; end if;
  v_lo := least(v_a, v_b); v_hi := greatest(v_a, v_b);
  insert into public.customer_merge_suggestions(customer_a, customer_b, confidence, reasons)
  values (v_lo, v_hi, p_confidence, p_reasons) on conflict (customer_a, customer_b) do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- The latest consent event of a person (and everyone merged into them) on one channel. Index-backed.
create function public.customer_consent_latest(p_root uuid, p_channel text,
  out status text, out subject_sha256 text, out effective_at timestamptz)
language sql stable security definer set search_path = pg_catalog, public as $$
  select e.status, e.subject_sha256, e.effective_at from public.customer_consent_events e
  where e.customer_id in (select c.id from public.customers c where c.id = p_root or c.merged_into = p_root) and e.channel = p_channel
    and (e.import_run_id is null
         or exists(select 1 from public.customer_consent_imports i where i.id = e.import_run_id and i.status = 'completed'))
  order by e.effective_at desc, (e.status = 'opted_out') desc, e.recorded_at desc, e.id desc limit 1
$$;

-- The Toast marketing list (CSV now; the API sync later through the SAME three calls). The app sends
-- the normalised list in chunks: begin -> chunk x N -> finish. Idempotent by (source, sha256 of the
-- normalised rows): a completed import replays its summary; a running one resumes (done chunks replay).
-- With p_explicit_status the file says opted_in/opted_out per row; without it, being listed = subscribed
-- and a person listed (opted_in) in the previous COMPLETED import but absent now = opted out.
create function public.customer_consent_import_begin(
  p_actor_id uuid, p_source text, p_rows_sha256 text, p_export_date date, p_explicit_status boolean, p_chunk_count integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_existing public.customer_consent_imports%rowtype; v_last public.customer_consent_imports%rowtype; v_id uuid;
begin
  if p_source is null or p_source not in ('toast_csv_import','toast_marketing_api') or p_export_date is null or p_explicit_status is null
     or p_rows_sha256 is null or p_rows_sha256 !~ '^[0-9a-f]{64}$' or p_chunk_count is null or p_chunk_count not between 1 and 100 then
    raise exception 'consent_import_invalid';
  end if;
  if p_export_date > (now() at time zone 'America/New_York')::date + 1 then raise exception 'consent_import_future_date'; end if;
  perform pg_advisory_xact_lock(hashtextextended('customer-consent-import',0));
  -- A half-applied import of this source: resume it if it is THIS snapshot, otherwise refuse (cancel it first).
  select * into v_existing from public.customer_consent_imports where source = p_source and status = 'running' for update;
  if found then
    if v_existing.rows_sha256 = p_rows_sha256 and v_existing.export_date = p_export_date
       and v_existing.explicit_status = p_explicit_status and v_existing.chunk_count = p_chunk_count then
      return jsonb_build_object('import_id', v_existing.id, 'state', 'resumed');
    end if;
    raise exception 'consent_import_busy';
  end if;
  select * into v_last from public.customer_consent_imports where source = p_source and status = 'completed'
  order by export_date desc, created_at desc limit 1;
  if found and p_export_date < v_last.export_date then raise exception 'consent_import_older_than_last'; end if;
  -- Replay ONLY when this exact snapshot (rows + export date + mode) is the LATEST completed import. The
  -- same rows seen before an intervening import are a new snapshot and must diff (r1 BC-031 P1).
  if found and v_last.rows_sha256 = p_rows_sha256 and v_last.export_date = p_export_date and v_last.explicit_status = p_explicit_status then
    return jsonb_build_object('import_id', v_last.id, 'state', 'completed');
  end if;
  insert into public.customer_consent_imports(source, rows_sha256, export_date, is_baseline, explicit_status, chunk_count, actor_id)
  values (p_source, p_rows_sha256, p_export_date, v_last.id is null, p_explicit_status, p_chunk_count, p_actor_id) returning id into v_id;
  return jsonb_build_object('import_id', v_id, 'state', 'started');
end $$;

create function public.customer_consent_import_chunk(p_actor_id uuid, p_import_id uuid, p_chunk_index integer, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_imp public.customer_consent_imports%rowtype; v_done public.customer_consent_import_chunks%rowtype;
  v_row jsonb; v_res record; v_email text; v_status text; v_cur record; v_effective timestamptz;
  v_new_in int := 0; v_out int := 0; v_same int := 0; v_stale int := 0; v_supp int := 0; v_created int := 0; v_total int := 0;
  v_masked int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('customer-consent-import',0));
  select * into v_imp from public.customer_consent_imports where id = p_import_id for update;
  if not found then raise exception 'consent_import_not_found'; end if;
  if v_imp.status <> 'running' then raise exception 'consent_import_not_running'; end if;
  if p_chunk_index is null or p_chunk_index < 0 or p_chunk_index >= v_imp.chunk_count or p_rows is null
     or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'consent_import_invalid';
  end if;
  select * into v_done from public.customer_consent_import_chunks where import_id = p_import_id and chunk_index = p_chunk_index;
  if found then return to_jsonb(v_done) || jsonb_build_object('replay', true); end if;
  -- Evidence is dated by the export, at the start of that day (ET).
  v_effective := (v_imp.export_date::timestamp at time zone 'America/New_York');
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_total := v_total + 1;
    v_email := nullif(lower(btrim(coalesce(v_row->>'email',''))),'');
    if v_email is null then raise exception 'consent_import_invalid'; end if;
    v_status := case when v_imp.explicit_status then v_row->>'status' else 'opted_in' end;
    if v_status is null or v_status not in ('opted_in','opted_out') then raise exception 'consent_import_invalid'; end if;
    -- A relay/placeholder address is never stored nor opted in (r1 BC-031 P2).
    if public.customer_email_is_relay(v_email) then v_masked := v_masked + 1; continue; end if;
    select * into v_res from public.customer_resolve(v_email, v_row->>'phone',
      nullif(btrim(concat_ws(' ', v_row->>'first_name', v_row->>'last_name')),''), v_row->>'first_name', v_row->>'last_name',
      null, v_effective, v_imp.source, null);
    if v_res.customer_id is null then v_supp := v_supp + 1; continue; end if;
    if v_res.created then v_created := v_created + 1; end if;
    insert into public.customer_consent_import_members(import_id, customer_id, status) values (p_import_id, v_res.customer_id, v_status)
    on conflict (import_id, customer_id) do update set status = case when excluded.status = 'opted_out' then 'opted_out' else customer_consent_import_members.status end;
    select * into v_cur from public.customer_consent_latest(v_res.customer_id, 'email');
    if v_cur.status = v_status and (v_status = 'opted_out' or v_cur.subject_sha256 = public.customer_sha256(v_email)) then
      v_same := v_same + 1; continue;
    end if;
    -- Newer evidence already exists (e.g. an unsubscribe recorded after this export was taken).
    if v_cur.effective_at > v_effective then v_stale := v_stale + 1; continue; end if;
    insert into public.customer_consent_events(customer_id, channel, status, source, subject_sha256, effective_at, import_run_id, recorded_by)
    values (v_res.customer_id, 'email', v_status, v_imp.source, public.customer_sha256(v_email), v_effective, p_import_id, p_actor_id);
    if v_status = 'opted_in' then v_new_in := v_new_in + 1; else v_out := v_out + 1; end if;
  end loop;
  insert into public.customer_consent_import_chunks(import_id, chunk_index, rows_total, new_opt_ins, opt_outs, unchanged, stale, suppressed, new_customers, masked)
  values (p_import_id, p_chunk_index, v_total, v_new_in, v_out, v_same, v_stale, v_supp, v_created, v_masked) returning * into v_done;
  return to_jsonb(v_done) || jsonb_build_object('replay', false);
end $$;

-- Every chunk applied: infer absences (no explicit status), refuse a suspiciously large opt-out wave
-- unless the importer confirmed it, total the counts, complete the import.
create function public.customer_consent_import_finish(p_actor_id uuid, p_import_id uuid, p_allow_large_opt_out boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_imp public.customer_consent_imports%rowtype; v_last public.customer_consent_imports%rowtype; v_member record; v_cur record;
  v_effective timestamptz; v_absent int := 0; v_absent_stale int := 0; v_prev int := 0; v_sum record;
begin
  perform pg_advisory_xact_lock(hashtextextended('customer-consent-import',0));
  select * into v_imp from public.customer_consent_imports where id = p_import_id for update;
  if not found then raise exception 'consent_import_not_found'; end if;
  if v_imp.status = 'completed' then
    return jsonb_build_object('import_id', v_imp.id, 'replay', true, 'rows_total', v_imp.rows_total, 'new_opt_ins', v_imp.new_opt_ins,
      'opt_outs', v_imp.opt_outs, 'unchanged', v_imp.unchanged, 'stale', v_imp.stale, 'suppressed', v_imp.suppressed,
      'new_customers', v_imp.new_customers, 'masked', v_imp.masked, 'baseline', v_imp.is_baseline);
  end if;
  if v_imp.status <> 'running' then raise exception 'consent_import_not_running'; end if;
  if (select count(*) from public.customer_consent_import_chunks where import_id = p_import_id) <> v_imp.chunk_count then
    raise exception 'consent_import_incomplete';
  end if;
  v_effective := (v_imp.export_date::timestamp at time zone 'America/New_York');
  select * into v_last from public.customer_consent_imports where source = v_imp.source and status = 'completed' and id <> v_imp.id
  order by export_date desc, created_at desc limit 1;
  if not v_imp.explicit_status and v_last.id is not null then
    select count(*) into v_prev from public.customer_consent_import_members where import_id = v_last.id and status = 'opted_in';
    for v_member in
      select public.customer_root(m.customer_id) as customer_id from public.customer_consent_import_members m
      where m.import_id = v_last.id and m.status = 'opted_in'
      except
      select public.customer_root(n.customer_id) from public.customer_consent_import_members n where n.import_id = v_imp.id
    loop
      select * into v_cur from public.customer_consent_latest(v_member.customer_id, 'email');
      if v_cur.status is distinct from 'opted_in' then continue; end if;
      if v_cur.effective_at > v_effective then v_absent_stale := v_absent_stale + 1; continue; end if;
      insert into public.customer_consent_import_members(import_id, customer_id, status) values (v_imp.id, v_member.customer_id, 'opted_out')
      on conflict (import_id, customer_id) do nothing;
      insert into public.customer_consent_events(customer_id, channel, status, source, subject_sha256, effective_at, import_run_id, recorded_by)
      values (v_member.customer_id, 'email', 'opted_out', v_imp.source, v_cur.subject_sha256, v_effective, v_imp.id, p_actor_id);
      v_absent := v_absent + 1;
    end loop;
    -- A file that silently lost a big part of the list (one shop's export, a filtered view) must not
    -- unsubscribe those people without a human saying so. Raising rolls back this step only.
    if v_absent > 25 and v_absent * 10 > v_prev and not coalesce(p_allow_large_opt_out, false) then
      raise exception 'consent_import_large_opt_out';
    end if;
  end if;
  select coalesce(sum(c.rows_total),0) as r, coalesce(sum(c.new_opt_ins),0) as i, coalesce(sum(c.opt_outs),0) as o,
    coalesce(sum(c.unchanged),0) as u, coalesce(sum(c.stale),0) as s, coalesce(sum(c.suppressed),0) as p, coalesce(sum(c.new_customers),0) as n,
    coalesce(sum(c.masked),0) as m
  into v_sum from public.customer_consent_import_chunks c where c.import_id = v_imp.id;
  update public.customer_consent_imports set status = 'completed', finished_at = clock_timestamp(), rows_total = v_sum.r,
    new_opt_ins = v_sum.i, opt_outs = v_sum.o + v_absent, unchanged = v_sum.u, stale = v_sum.s + v_absent_stale,
    suppressed = v_sum.p, new_customers = v_sum.n, masked = v_sum.m where id = v_imp.id;
  return jsonb_build_object('import_id', v_imp.id, 'replay', false, 'rows_total', v_sum.r, 'new_opt_ins', v_sum.i,
    'opt_outs', v_sum.o + v_absent, 'absent_opt_outs', v_absent, 'unchanged', v_sum.u, 'stale', v_sum.s + v_absent_stale,
    'suppressed', v_sum.p, 'new_customers', v_sum.n, 'masked', v_sum.m, 'baseline', v_imp.is_baseline);
end $$;

-- Cancel a half-applied import (r1 BC-036): a wrong file that hit the opt-out-wave guard, or a run that
-- died. Its events were never counted (pending) and now never will be; its members never become the
-- diff baseline. Nothing is deleted: the append-only history keeps what was attempted. A corrected file
-- can then begin.
create function public.customer_consent_import_cancel(p_actor_id uuid, p_import_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_imp public.customer_consent_imports%rowtype; v_events int;
begin
  perform pg_advisory_xact_lock(hashtextextended('customer-consent-import',0));
  select * into v_imp from public.customer_consent_imports where id = p_import_id for update;
  if not found then raise exception 'consent_import_not_found'; end if;
  if v_imp.status = 'cancelled' then return jsonb_build_object('import_id', v_imp.id, 'changed', false); end if;
  if v_imp.status <> 'running' then raise exception 'consent_import_not_running'; end if;
  if p_actor_id is null then raise exception 'consent_import_invalid'; end if;
  update public.customer_consent_imports set status = 'cancelled', finished_at = clock_timestamp(), cancelled_by = p_actor_id where id = v_imp.id;
  select count(*) into v_events from public.customer_consent_events where import_run_id = v_imp.id;
  return jsonb_build_object('import_id', v_imp.id, 'changed', true, 'neutralised_events', v_events);
end $$;

-- A manager confirms a suggestion: p_keep survives, the other is merged into it (identifiers, cards,
-- orders move; consent events stay where they were and are read through merged_into).
create function public.customer_merge(p_actor_id uuid, p_suggestion_id uuid, p_keep uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_s public.customer_merge_suggestions%rowtype; v_keep uuid; v_gone uuid; v_k public.customers%rowtype; v_g public.customers%rowtype;
begin
  perform public.customer_identity_lock();
  select * into v_s from public.customer_merge_suggestions where id = p_suggestion_id for update;
  if not found then raise exception 'suggestion_not_found'; end if;
  if v_s.status <> 'open' then raise exception 'suggestion_already_decided'; end if;
  if p_keep not in (v_s.customer_a, v_s.customer_b) then raise exception 'merge_invalid'; end if;
  v_keep := public.customer_root(p_keep);
  v_gone := public.customer_root(case when p_keep = v_s.customer_a then v_s.customer_b else v_s.customer_a end);
  if v_keep = v_gone then
    update public.customer_merge_suggestions set status = 'confirmed', decided_at = now(), decided_by = p_actor_id where id = p_suggestion_id;
    return jsonb_build_object('kept', v_keep, 'merged', v_gone, 'changed', false);
  end if;
  select * into v_k from public.customers where id = v_keep for update;
  select * into v_g from public.customers where id = v_gone for update;
  if v_k.erased_at is not null or v_g.erased_at is not null then raise exception 'merge_erased'; end if;
  update public.customer_identifiers set customer_id = v_keep where customer_id = v_gone;
  update public.customer_orders set customer_id = v_keep where customer_id = v_gone;
  insert into public.customer_cards(customer_id, brand, last4, first_seen_at, last_seen_at)
  select v_keep, brand, last4, first_seen_at, last_seen_at from public.customer_cards where customer_id = v_gone
  on conflict (customer_id, brand, last4) do update set first_seen_at = least(customer_cards.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(customer_cards.last_seen_at, excluded.last_seen_at);
  delete from public.customer_cards where customer_id = v_gone;
  update public.customers set merged_into = v_keep where merged_into = v_gone;
  update public.customers c set
    full_name = coalesce(c.full_name, v_g.full_name), first_name = coalesce(c.first_name, v_g.first_name),
    last_name = coalesce(c.last_name, v_g.last_name), name_key = coalesce(c.name_key, v_g.name_key),
    primary_location_id = coalesce(c.primary_location_id, v_g.primary_location_id),
    first_seen_at = least(c.first_seen_at, v_g.first_seen_at), last_seen_at = greatest(c.last_seen_at, v_g.last_seen_at),
    sources = array(select distinct unnest(c.sources || v_g.sources) order by 1),
    masked_channels = array(select distinct unnest(c.masked_channels || v_g.masked_channels) order by 1)
  where c.id = v_keep;
  update public.customers set merged_into = v_keep, merged_at = now(), merged_by = p_actor_id where id = v_gone;
  update public.customer_merge_suggestions set status = 'confirmed', decided_at = now(), decided_by = p_actor_id where id = p_suggestion_id;
  return jsonb_build_object('kept', v_keep, 'merged', v_gone, 'changed', true);
end $$;

create function public.customer_merge_dismiss(p_actor_id uuid, p_suggestion_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_n int;
begin
  update public.customer_merge_suggestions set status = 'dismissed', decided_at = now(), decided_by = p_actor_id
  where id = p_suggestion_id and status = 'open';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    if not exists(select 1 from public.customer_merge_suggestions where id = p_suggestion_id) then raise exception 'suggestion_not_found'; end if;
    raise exception 'suggestion_already_decided';
  end if;
  return true;
end $$;

-- Delete on request (and the retention sweep's per-person step): the person and everyone merged into
-- them lose identifiers, cards and names; their hashes are suppressed; an opt-out is appended per channel.
create function public.customer_erase(p_actor_id uuid, p_customer_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_root uuid; v_ids uuid[]; v_idents int; v_channel text;
begin
  perform public.customer_identity_lock();
  v_root := public.customer_root(p_customer_id);
  if v_root is null then raise exception 'customer_not_found'; end if;
  if p_reason not in ('delete_request','retention') then raise exception 'erase_invalid'; end if;
  if exists(select 1 from public.customers where id = v_root and erased_at is not null) then
    return jsonb_build_object('customer_id', v_root, 'changed', false);
  end if;
  select array_agg(id) into v_ids from public.customers where id = v_root or merged_into = v_root;
  perform 1 from public.customers where id = any(v_ids) for update;
  insert into public.customer_suppressions(kind, value_sha256, reason, created_by)
  select kind, value_sha256, p_reason, p_actor_id from public.customer_identifiers where customer_id = any(v_ids)
  on conflict (kind, value_sha256) do nothing;
  foreach v_channel in array array['email','sms'] loop
    insert into public.customer_consent_events(customer_id, channel, status, source, subject_sha256, effective_at, recorded_by)
    values (v_root, v_channel, 'opted_out', p_reason, null, clock_timestamp(), p_actor_id);
  end loop;
  delete from public.customer_identifiers where customer_id = any(v_ids);
  get diagnostics v_idents = row_count;
  delete from public.customer_cards where customer_id = any(v_ids);
  update public.customer_merge_suggestions set status = 'dismissed', decided_at = now(), decided_by = p_actor_id
  where status = 'open' and (customer_a = any(v_ids) or customer_b = any(v_ids));
  update public.customers set full_name = null, first_name = null, last_name = null, name_key = null,
    erased_at = now(), erased_by = p_actor_id, erase_reason = p_reason where id = any(v_ids);
  return jsonb_build_object('customer_id', v_root, 'changed', true, 'identifiers_deleted', v_idents);
end $$;

-- Retention: a person not seen since p_cutoff whose CURRENT status is not opted in on any channel is
-- erased (bounded batch; the caller loops). Opted-in people keep their profile while consent stands.
create function public.customer_retention_sweep(p_actor_id uuid, p_cutoff timestamptz, p_limit integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid; v_n int := 0;
begin
  if p_cutoff is null or p_cutoff > now() - interval '365 days' or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'retention_invalid';
  end if;
  for v_id in
    select c.id from public.customers c
    where c.merged_into is null and c.erased_at is null and c.last_seen_at < p_cutoff
      and not exists(select 1 from public.customer_consent_current k where k.customer_id = c.id and k.status = 'opted_in')
      and not exists(select 1 from public.customers m where m.merged_into = c.id and m.last_seen_at >= p_cutoff)
    order by c.last_seen_at limit p_limit
  loop
    perform public.customer_erase(p_actor_id, v_id, 'retention');
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('erased', v_n);
end $$;

-- ───────────────────────────── reads (service_role) ─────────────────────────────

-- The ONLY marketing read. Latest event opted_in, the subject address only, live people only.
-- There is deliberately no parameter that could include anyone else.
create function public.customer_marketing_export(p_channel text)
returns table(customer_id uuid, value text, first_name text, last_name text, opted_in_at timestamptz, source text, status text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select k.customer_id, i.value, c.first_name, c.last_name, k.effective_at, k.source, k.status
  from public.customer_consent_current k
  join public.customers c on c.id = k.customer_id and c.merged_into is null and c.erased_at is null
  join public.customer_identifiers i on i.value_sha256 = k.subject_sha256
    and i.kind = case p_channel when 'email' then 'email' when 'sms' then 'phone' end
    and public.customer_root(i.customer_id) = k.customer_id
  where k.channel = p_channel and k.status = 'opted_in'
    and not exists(select 1 from public.customer_suppressions s where s.kind = i.kind and s.value_sha256 = i.value_sha256)
  order by k.effective_at, k.customer_id
$$;

-- "Newly opted in": the current status is an opt-in made after p_since, and it is a CHANGE (not the
-- baseline import that first loaded the list).
create function public.customer_newly_opted_in(p_since timestamptz, p_limit integer)
returns table(customer_id uuid, full_name text, opted_in_at timestamptz, source text, previous_status text, had_orders boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  select k.customer_id, c.full_name, k.effective_at, k.source,
    coalesce((select e.status from public.customer_consent_events e join public.customers x on x.id = e.customer_id
              where coalesce(x.merged_into, x.id) = k.customer_id and e.channel = 'email' and e.id <> k.event_id
                and (e.import_run_id is null or exists(select 1 from public.customer_consent_imports ci where ci.id = e.import_run_id and ci.status = 'completed'))
                and (e.effective_at, e.recorded_at) < (k.effective_at, (select recorded_at from public.customer_consent_events where id = k.event_id))
              order by e.effective_at desc, e.recorded_at desc limit 1), 'none'),
    exists(select 1 from public.customer_orders o where o.customer_id = k.customer_id)
  from public.customer_consent_current k
  join public.customers c on c.id = k.customer_id and c.merged_into is null and c.erased_at is null
  left join public.customer_consent_imports im on im.id = k.import_run_id
  where k.channel = 'email' and k.status = 'opted_in' and k.effective_at >= p_since and coalesce(im.is_baseline, false) = false
  order by k.effective_at desc, k.customer_id
  limit least(greatest(coalesce(p_limit, 200), 1), 1000)
$$;

-- Profile list for a set of shops (null = every shop): live people with an order there, newest first.
create function public.customer_profile_page(p_location_ids uuid[], p_search text, p_limit integer, p_offset integer)
returns table(customer_id uuid, full_name text, last_order date, total_rows bigint)
language sql stable security definer set search_path = pg_catalog, public as $$
  with people as (
    select o.customer_id, max(o.business_date) as last_order
    from public.customer_orders o
    where p_location_ids is null or o.location_id = any(p_location_ids)
    group by o.customer_id
  )
  select p.customer_id, c.full_name, p.last_order, count(*) over ()
  from people p join public.customers c on c.id = p.customer_id and c.merged_into is null and c.erased_at is null
  where p_search is null or c.name_key like '%' || lower(replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')) || '%'
  order by p.last_order desc, p.customer_id
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
$$;

-- Card-sharing candidates for the name + card scorer (names only, never an identifier).
create function public.customer_card_candidates(p_customer_ids uuid[])
returns table(customer_id uuid, other_id uuid, name_key text, other_name_key text, same_shop boolean, shared_cards integer)
language sql stable security definer set search_path = pg_catalog, public as $$
  select a.customer_id, b.customer_id, ca.name_key, cb.name_key,
    coalesce(ca.primary_location_id = cb.primary_location_id, false), count(*)::int
  from public.customer_cards a
  join public.customer_cards b on b.brand = a.brand and b.last4 = a.last4 and b.customer_id <> a.customer_id
  join public.customers ca on ca.id = a.customer_id and ca.merged_into is null and ca.erased_at is null
  join public.customers cb on cb.id = b.customer_id and cb.merged_into is null and cb.erased_at is null
  where a.customer_id = any(p_customer_ids)
  group by a.customer_id, b.customer_id, ca.name_key, cb.name_key, ca.primary_location_id, cb.primary_location_id
  limit 500
$$;

-- ───────────────────────────── RLS + grants ─────────────────────────────
do $$ declare t text; begin
  foreach t in array array['customers','customer_identifiers','customer_cards','customer_orders','customer_consent_imports',
    'customer_consent_import_members','customer_consent_import_chunks','customer_consent_events','customer_merge_suggestions','customer_suppressions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for delete using (false)', t || '_no_user_delete', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;
end $$;
-- Consent is append-only: the writers are the definer RPCs; service_role may only read every table.
revoke all on public.customer_consent_current from public, anon, authenticated, service_role;
grant select on public.customer_consent_current to service_role;

revoke all on function public.customer_sha256(text), public.customer_root(uuid),
  public.customer_resolve(text,text,text,text,text,uuid,timestamptz,text,text),
  public.customer_consent_latest(uuid,text), public.customer_email_is_relay(text), public.customer_identity_lock()
  from public, anon, authenticated, service_role;
revoke all on function public.customer_ingest_orders(uuid,jsonb), public.customer_link_catering(jsonb),
  public.customer_suggest_merge(uuid,uuid,numeric,text[]), public.customer_consent_import_begin(uuid,text,text,date,boolean,integer),
  public.customer_consent_import_chunk(uuid,uuid,integer,jsonb), public.customer_consent_import_finish(uuid,uuid,boolean),
  public.customer_consent_import_cancel(uuid,uuid),
  public.customer_merge(uuid,uuid,uuid), public.customer_merge_dismiss(uuid,uuid), public.customer_erase(uuid,uuid,text),
  public.customer_retention_sweep(uuid,timestamptz,integer), public.customer_marketing_export(text),
  public.customer_newly_opted_in(timestamptz,integer), public.customer_profile_page(uuid[],text,integer,integer),
  public.customer_card_candidates(uuid[]) from public, anon, authenticated;
grant execute on function public.customer_ingest_orders(uuid,jsonb), public.customer_link_catering(jsonb),
  public.customer_suggest_merge(uuid,uuid,numeric,text[]), public.customer_consent_import_begin(uuid,text,text,date,boolean,integer),
  public.customer_consent_import_chunk(uuid,uuid,integer,jsonb), public.customer_consent_import_finish(uuid,uuid,boolean),
  public.customer_consent_import_cancel(uuid,uuid),
  public.customer_merge(uuid,uuid,uuid), public.customer_merge_dismiss(uuid,uuid), public.customer_erase(uuid,uuid,text),
  public.customer_retention_sweep(uuid,timestamptz,integer), public.customer_marketing_export(text),
  public.customer_newly_opted_in(timestamptz,integer), public.customer_profile_page(uuid[],text,integer,integer),
  public.customer_card_candidates(uuid[]) to service_role;

do $$ begin
  if exists(select 1 from information_schema.role_table_grants where table_schema='public'
    and table_name in ('customers','customer_identifiers','customer_cards','customer_orders','customer_consent_imports',
      'customer_consent_import_members','customer_consent_import_chunks','customer_consent_events','customer_merge_suggestions','customer_suppressions','customer_consent_current')
    and (grantee in ('PUBLIC','anon','authenticated') or (grantee='service_role' and privilege_type <> 'SELECT'))) then
    raise exception '0234: table grant escaped';
  end if;
  if exists(select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name like 'customer\_%'
    and grantee in ('PUBLIC','anon','authenticated')) then
    raise exception '0234: RPC grant escaped';
  end if;
  if exists(select 1 from information_schema.routine_privileges where routine_schema='public'
    and routine_name in ('customer_resolve','customer_root','customer_sha256','customer_consent_latest','customer_email_is_relay','customer_identity_lock') and grantee = 'service_role') then
    raise exception '0234: private helper granted';
  end if;
end $$;
commit;
