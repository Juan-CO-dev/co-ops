-- Migration 0212_training_assets_bucket
-- STAGED in the "Learn the build" PR; NOT applied. Prod apply is Juan's word only
-- (a new storage bucket is a prod change). Apply BEFORE running
-- scripts/upload-training-assets.ts against that project. Runbook:
-- docs/runbooks/training-assets.md.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────────────
-- The private `training-assets` Storage bucket: the real food photos the
-- "Learn the build" scene (/training/build/[item]) shows — track C's derived
-- cut-outs of the Crunchy Boi build, PNG only.
--
-- Juan's ruling 2026-09-28: training photos go through the SAME private-storage
-- path as receipts and checklist photos. So this mirrors 0164 (`photos`) and 0170
-- (`receipts`) exactly:
--   - private (public=false), explicit MIME list (image/png), 2 MB per object
--   - NO storage.objects policies — with RLS on and no permissive policy matching
--     bucket_id='training-assets', every non-service role is denied by default
--   - service-role is the sole reader/writer: scripts/upload-training-assets.ts
--     writes (content-addressed, idempotent); lib/training/training-assets.ts mints
--     60 s signed URLs ONLY after requireSession in
--     app/api/training/co-scenes/[...path]/route.ts
--   - the DROP POLICY IF EXISTS block makes a re-run converge on the no-policy state
--
-- WHY ITS OWN BUCKET, not a prefix in `photos`: `photos` objects are location-scoped
-- (photos/{locationId}/…) and every read is authorised by a public.photos registry
-- row + a location-bind check. Training photos belong to no location and have no
-- registry row — the vendored co-scenes asset manifest (sha256 per name) is their
-- registry. Putting them under `photos` would make lib/photos.ts's invariant ("every
-- object has a row") false. One private bucket per domain is the house pattern
-- (`photos` 0164, `receipts` 0170).
--
-- MANUAL FALLBACK: if storage.* DDL cannot run via the migration runner, create the
-- bucket in the dashboard (name=training-assets, Public=OFF, 2 MB, MIME image/png) and
-- confirm NO storage.objects policies match bucket_id='training-assets'.
--
-- APPLY-FIRST-SAFE: nothing reads this bucket until the photos are uploaded; the route
-- falls back to the drawn look (and then the plain step list) when a photo is absent.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('training-assets', 'training-assets', false, 2097152, array['image/png'])
on conflict (id) do nothing;

drop policy if exists training_assets_objects_no_user_select on storage.objects;
drop policy if exists training_assets_objects_no_user_insert on storage.objects;
drop policy if exists training_assets_objects_no_user_update on storage.objects;
drop policy if exists training_assets_objects_no_user_delete on storage.objects;

-- VERIFY (read-only, after apply):
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'training-assets';
--   select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
--     and (qual like '%training-assets%' or with_check like '%training-assets%');   -- expect 0 rows
