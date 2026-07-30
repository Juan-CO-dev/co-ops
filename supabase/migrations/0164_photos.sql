-- Migration 0164_photos
-- STAGED in PR; prod apply deferred to Juan's go — but apply BEFORE merging the code
-- (the #191 apply-first protocol). The NEW code (lib/photos.ts, /api/photos POST + GET)
-- READS/WRITES the photos table + the `photos` storage bucket; the OLD code never
-- touches either, so applying 0164 before merge is a no-op on the running app and
-- cannot break anything (see APPLY-FIRST-SAFE below).
-- Canonical reference: docs/ROADMAP.md NOW #1 (Photo uploader seam) + the orchestrator's
--                      adjudicated build brief (2026-07-29). Closes the checklist
--                      expects_photo broken-promise + the receiving photo/receipt stubs.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────────────
--  (1) public.photos — the canonical photo REGISTRY. One row per uploaded file. The
--      binary lives in Supabase Storage (bucket `photos`); this table is the metadata
--      + location-bind authority the GET /api/photos/[id] route checks before minting a
--      short-lived signed URL. checklist_completions.photo_id (uuid, exists since an
--      earlier migration) points here; receiving stores the canonical app URL
--      /api/photos/{id} in the EXISTING vendor_delivery_items.photo_url /
--      vendor_deliveries.receipt_url TEXT columns (FORK 1 ruling — no DDL there).
--  (2) The `photos` Storage bucket (private) + restrictive storage.objects policies
--      denying all non-service-role access. Service-role (lib/photos.ts) is the sole
--      writer; reads happen through short-lived signed URLs minted server-side after a
--      location-bind check — the client never touches Storage directly.
--
-- ── APPLY-FIRST-SAFE ────────────────────────────────────────────────────────────────
-- Additive table + additive bucket + additive policies. No column drops, no backfill,
-- no changes to any table the running app reads today. checklist_completions.photo_id
-- already exists and is already NULL on every row; nothing dereferences a photos row
-- until the new code ships.
--
-- ── MANUAL FALLBACK (if the storage.* DDL cannot run via the migration runner) ───────
-- Some Supabase setups restrict DDL on the `storage` schema to the dashboard/API. If
-- the bucket + storage-policy block below errors on apply, run the table block alone,
-- then create the bucket + policies MANUALLY:
--   1. Dashboard → Storage → New bucket → name `photos`, Public = OFF, file-size limit
--      8 MB, allowed MIME: image/jpeg, image/png, image/webp, image/heic.
--      (Or via SQL editor as the postgres/service role — the exact statements below.)
--   2. Confirm the four restrictive storage.objects policies exist for bucket_id='photos'
--      (SELECT/INSERT/UPDATE/DELETE all USING/ WITH CHECK false for the anon+authenticated
--      roles). Service-role bypasses RLS, so lib/photos.ts still works.
-- The `on conflict do nothing` + `drop policy if exists` guards make the block
-- idempotent — safe to re-run once the bucket exists.

-- ── (1) THE PHOTO REGISTRY ────────────────────────────────────────────────────────
CREATE TABLE public.photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path  text        NOT NULL,               -- object path within the `photos` bucket
  uploaded_by   uuid        NOT NULL REFERENCES public.users(id),
  location_id   uuid        NOT NULL REFERENCES public.locations(id),
  byte_size     integer     NOT NULL CHECK (byte_size > 0),
  content_type  text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX photos_location_idx ON public.photos (location_id);
CREATE INDEX photos_uploaded_by_idx ON public.photos (uploaded_by);

COMMENT ON TABLE public.photos IS
  'Canonical photo REGISTRY (photo uploader seam, 0164). One row per uploaded file; the binary lives in the private `photos` Storage bucket at storage_path. Location-bind authority for GET /api/photos/[id] (service-role mints a short-lived signed URL only when the actor is bound to location_id). Referenced by checklist_completions.photo_id and by /api/photos/{id} URLs stored in vendor_delivery_items.photo_url / vendor_deliveries.receipt_url.';

-- Deny-all RLS triad (house pattern, mirrors sku_count_events / sku_pack_levels):
-- end users NEVER read or write photos directly. lib/photos.ts (service-role, which
-- bypasses RLS) is the sole authority; the app-layer location-bind check in
-- GET /api/photos/[id] is what actually gates reads.
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY photos_no_user_select ON public.photos FOR SELECT USING (false);
CREATE POLICY photos_no_user_insert ON public.photos FOR INSERT WITH CHECK (false);
CREATE POLICY photos_no_user_update ON public.photos FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY photos_no_user_delete ON public.photos FOR DELETE USING (false);

-- ── (2) THE PRIVATE STORAGE BUCKET + RESTRICTIVE OBJECT POLICIES ────────────────────
-- Private bucket (public=false). See MANUAL FALLBACK above if this block cannot run
-- via the migration runner.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'photos', 'photos', false, 8388608,
  ARRAY['image/jpeg','image/png','image/webp','image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- storage.objects already has RLS enabled by Supabase. Add RESTRICTIVE policies that
-- deny every non-service-role operation on the `photos` bucket. (Service-role bypasses
-- RLS entirely, so lib/photos.ts upload + createSignedUrl keep working.) DROP-IF-EXISTS
-- first so the block is idempotent on re-run.
DROP POLICY IF EXISTS photos_objects_no_user_select ON storage.objects;
DROP POLICY IF EXISTS photos_objects_no_user_insert ON storage.objects;
DROP POLICY IF EXISTS photos_objects_no_user_update ON storage.objects;
DROP POLICY IF EXISTS photos_objects_no_user_delete ON storage.objects;

CREATE POLICY photos_objects_no_user_select ON storage.objects
  FOR SELECT USING (bucket_id <> 'photos');
CREATE POLICY photos_objects_no_user_insert ON storage.objects
  FOR INSERT WITH CHECK (bucket_id <> 'photos');
CREATE POLICY photos_objects_no_user_update ON storage.objects
  FOR UPDATE USING (bucket_id <> 'photos') WITH CHECK (bucket_id <> 'photos');
CREATE POLICY photos_objects_no_user_delete ON storage.objects
  FOR DELETE USING (bucket_id <> 'photos');
