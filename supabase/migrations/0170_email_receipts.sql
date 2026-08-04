-- 0170: delivery-intake P2 — email-receipt ledger + storage + inference baselines (spec D4/D6)
-- Adds the vendor-claim side of the two-way match (email_receipts table + receipts storage
-- bucket) and the inferred on-hand baseline table (sku_inferred_baselines). Also adds:
--   - vendor_deliveries.email_receipt_id FK (both-ways link; set from the receipt side too)
--   - locations.receipt_email_address (dormant until Resend DNS verified)
-- Storage: `receipts` bucket is private, deny-by-default, service-role only — mirrors the
-- `photos` bucket posture from 0164 (no storage.objects policies; drop-if-exists for
-- convergence in case a rejected draft ever ran). 15 MB limit; PDF + EML + image types.
-- Parsing deferred to P4; match verdicts are manager attestation on a visual compare (P2).

-- ── (1) EMAIL RECEIPT LEDGER ─────────────────────────────────────────────────────────────

create table if not exists public.email_receipts (
  id                  uuid primary key default gen_random_uuid(),
  location_id         uuid null references public.locations(id),   -- null until linked/attributed
  source              text not null check (source in ('inbound','upload')),
  from_address        text null,
  subject             text null,
  received_at         timestamptz not null default now(),
  raw_storage_path    text null,             -- bucket path of the raw .eml, when inbound
  attachment_paths    jsonb not null default '[]'::jsonb,  -- bucket paths of stored attachments
  parse_state         text not null default 'unparsed'
                        check (parse_state in ('unparsed','parsed','failed')),  -- parsing lands P4
  parsed_json         jsonb null,
  linked_delivery_id  uuid null references public.vendor_deliveries(id),
  vendor_guess_id     uuid null references public.vendors(id),  -- from_address matched against vendor_contacts
  created_by          uuid null references public.users(id),    -- null for inbound (machine)
  created_at          timestamptz not null default now()
);

create index if not exists email_receipts_unlinked_ix
  on public.email_receipts (location_id, received_at)
  where linked_delivery_id is null;

create index if not exists email_receipts_delivery_ix
  on public.email_receipts (linked_delivery_id);

alter table public.email_receipts enable row level security;
revoke all on public.email_receipts from anon, authenticated;
revoke all on public.email_receipts from public;

-- ── (2) FOREIGN KEY ADDITIONS ─────────────────────────────────────────────────────────────

-- Both-ways link: receipt row carries linked_delivery_id (above); delivery row carries
-- email_receipt_id so a joined read on vendor_deliveries can surface the receipt without
-- a join through email_receipts first.
alter table public.vendor_deliveries
  add column if not exists email_receipt_id uuid null references public.email_receipts(id);

-- Dormant until Resend DNS is verified. Inbound routing uses the to-address to attribute
-- the receipt to a location.
alter table public.locations
  add column if not exists receipt_email_address text null;

-- ── (3) INFERRED BASELINE TABLE ───────────────────────────────────────────────────────────

-- Lazily-persisted tier for SKUs that have no census anchor. Computed ONCE per (location,
-- SKU) from trailing 28-day consumption lanes, covering 7 days forward. Never regenerated
-- (spec D6 — `on conflict do nothing` in the writer). SKUs with zero consumption get NO
-- row (advisory-null stays — never fabricate).
create table if not exists public.sku_inferred_baselines (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references public.locations(id),
  sku_id       uuid not null references public.vendor_items(id),
  inferred_oz  numeric not null,
  computed_at  timestamptz not null default now(),
  basis        jsonb not null,  -- { method, window_days, coverage_days, daily_avg_oz, lanes: {production_oz, direct_oz} }
  unique (location_id, sku_id)  -- computed once; `on conflict do nothing` is the write idiom
);

alter table public.sku_inferred_baselines enable row level security;
revoke all on public.sku_inferred_baselines from anon, authenticated;
revoke all on public.sku_inferred_baselines from public;

-- ── (4) PRIVATE RECEIPTS STORAGE BUCKET (deny-by-default; no object policies) ────────────
-- Mirrors the `photos` bucket posture from 0164 exactly:
--   - private (public=false), 15 MB limit, explicit allowed MIME list
--   - NO storage.objects policies — with RLS on and no permissive policy matching
--     bucket_id='receipts', every non-service role is denied by default
--   - service-role (lib/email-receipts.ts) is the sole reader/writer; it bypasses RLS
--   - signed URLs are minted server-side after an app-layer location-bind check
--   - The DROP POLICY IF EXISTS block below makes a re-run converge on the no-policy
--     state if a rejected draft ever ran (idempotency; mirrors 0164's pattern)
-- MANUAL FALLBACK: if the storage.* DDL cannot run via the migration runner, create the
-- bucket manually in the dashboard (name=receipts, Public=OFF, 15 MB, MIME list below)
-- and confirm NO storage.objects policies match bucket_id='receipts'.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false, 15728640,
  array[
    'application/pdf',
    'message/rfc822',
    'text/plain',
    'text/html',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic'
  ]
)
on conflict (id) do nothing;

-- No storage.objects policies for user roles. Deny-by-default is the correct posture.
-- These drops make re-runs converge on the no-policy state (mirrors 0164's convention).
drop policy if exists receipts_objects_no_user_select on storage.objects;
drop policy if exists receipts_objects_no_user_insert on storage.objects;
drop policy if exists receipts_objects_no_user_update on storage.objects;
drop policy if exists receipts_objects_no_user_delete on storage.objects;
