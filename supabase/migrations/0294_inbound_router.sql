-- 0294: ledger-first inbound mail routing and per-shop vendor accounts.
-- AUTHORED 2026-11-07. NOT APPLIED. CC applies to sim, then prod on Juan's word.
-- WHAT/WHY: Resend webhooks contain metadata only. Record their stable email id
-- before routing/fetching; retain retry state independently of receipt parsing.
-- BACKWARD COMPATIBLE: additive only; existing receipts and vendors.account_number
-- keep their contracts. locations.receipt_email_address remains the primary receiving
-- address AND PO reply-to. Parsed accountNumber stays in parsed_json with its source
-- extraction (no second mutable copy). No tenant addresses or accounts are seeded.
-- ROLLOUT: apply BEFORE the app merges. Leave RESEND_INBOUND_SECRET unset until DNS,
-- receiving permission, aliases and copy rules are ready. No outbound mail is added.
-- VERIFY SQL (after apply, by CC):
-- select tablename, policyname from pg_policies where tablename in
--   ('inbound_messages','inbound_address_aliases','vendor_location_accounts');
-- select grantee,table_name,privilege_type from information_schema.role_table_grants
-- where table_schema='public' and table_name in
--   ('inbound_messages','inbound_address_aliases','vendor_location_accounts')
--   and grantee in ('anon','authenticated','PUBLIC'); -- zero rows
-- select has_table_privilege('service_role','public.inbound_messages','DELETE'); -- false
-- select conname,pg_get_constraintdef(oid) from pg_constraint
--   where conrelid='public.inbound_messages'::regclass; -- provider_email_id UNIQUE
-- ROLLBACK: revert the app and unset RESEND_INBOUND_SECRET; preserve all ledger rows.
-- Do not drop these tables or delete history. A later reviewed migration can retire
-- unused schema after confirming every in-flight delivery has been accounted for.

begin;

create table public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'resend' check (provider in ('resend')),
  provider_email_id text not null unique,
  message_id text null,
  from_address text null,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  received_for text[] not null default '{}',
  subject text null,
  lane text not null default 'noise' check (lane in ('vendor_receipt','catering','noise')),
  location_id uuid null references public.locations(id),
  route_reason text not null default 'unresolved' check (route_reason in
    ('unresolved','shop_address','shop_alias','catering_address','ambiguous','unknown_address')),
  content_state text not null default 'pending' check (content_state in ('pending','fetched','failed','blocked_config','skipped')),
  fetch_attempts integer not null default 0 check (fetch_attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text null check (last_error in ('provider_auth','provider_error','untrusted_url','invalid_size','storage','ledger','routing')),
  lease_token uuid null,
  email_receipt_id uuid null references public.email_receipts(id),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Unresolved rows include a process that died between ledger INSERT and routing.
create index inbound_messages_retry_ix on public.inbound_messages(next_attempt_at,created_at)
  where content_state in ('pending','failed','blocked_config');
create index inbound_messages_received_ix on public.inbound_messages(received_at desc);

create table public.inbound_address_aliases (
  id uuid primary key default gen_random_uuid(),
  address text not null unique check (address = lower(address) and address = btrim(address)
    and address ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'),
  lane text not null check (lane in ('vendor_receipt','catering')),
  location_id uuid null references public.locations(id),
  active boolean not null default true,
  created_by uuid null references public.users(id),
  updated_by uuid null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lane = 'vendor_receipt' and location_id is not null)
    or (lane = 'catering' and location_id is null))
);

create table public.vendor_location_accounts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id),
  location_id uuid not null references public.locations(id),
  active boolean not null default true,
  account_number text not null check (length(btrim(account_number)) between 1 and 200
    and account_number = btrim(account_number)),
  created_by uuid null references public.users(id),
  updated_by uuid null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index vendor_location_accounts_active_number_ix
  on public.vendor_location_accounts(vendor_id,account_number) where active;
create unique index vendor_location_accounts_active_shop_ix
  on public.vendor_location_accounts(vendor_id,location_id) where active;

alter table public.email_receipts
  add column inbound_message_id uuid null unique references public.inbound_messages(id),
  add column attributed_by text null check (attributed_by in ('address','account','both','manual')),
  add column attribution_conflict boolean not null default false,
  add column account_location_id uuid null references public.locations(id),
  add column account_vendor_id uuid null references public.vendors(id);

-- Service role may update processing/config state, but cannot delete history.
-- Explicitly revoke its default grants too: BYPASSRLS does not bypass privileges.
alter table public.inbound_messages enable row level security;
alter table public.inbound_address_aliases enable row level security;
alter table public.vendor_location_accounts enable row level security;
revoke all on public.inbound_messages, public.inbound_address_aliases,
  public.vendor_location_accounts from public, anon, authenticated, service_role;
grant select, insert on public.inbound_messages to service_role;
grant update (lane, location_id, route_reason, content_state, fetch_attempts,
  next_attempt_at, last_error, lease_token, email_receipt_id)
  on public.inbound_messages to service_role;
grant select, insert, update on public.inbound_address_aliases,
  public.vendor_location_accounts to service_role;
create policy inbound_messages_no_user_delete on public.inbound_messages for delete using (false);
create policy inbound_address_aliases_no_user_delete on public.inbound_address_aliases for delete using (false);
create policy vendor_location_accounts_no_user_delete on public.vendor_location_accounts for delete using (false);

comment on table public.inbound_messages is
  'Ledger-first Resend metadata; all strings are untrusted plain text. Unique provider email id prevents duplicate ingest. Processing state is service-role only; no deletes.';
comment on table public.inbound_address_aliases is
  'Configured recipient aliases, exact normalized address matches; deactivate rather than delete.';
comment on column public.email_receipts.inbound_message_id is
  'Unique receipt per inbound message, allowing retry recovery after a partial fetch/store/link.';

commit;
