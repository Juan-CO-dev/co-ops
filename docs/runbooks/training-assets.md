# Runbook — "Learn the build" training photos

The Crunchy Boi build on `/training/build/crunchy-boi` runs co-scenes track C's real-photo scene. Its code and scene
data are vendored and committed under `vendor/co-scenes/dist/`. **The photos are never committed and never under
`public/`.** Juan, 2026-09-28: *"we will have photos of receipts and stuff like that. So use that same sort of path."*
So they live in a private Supabase Storage bucket, the same way as receipts (0170) and checklist photos (0164).

## How a photo reaches a phone

1. The page loads the bundle and the scene data through `GET /api/training/co-scenes/…`. That route runs
   `requireSession`, the full check.
2. For each photo, the scene asks the same route for `photos/<name>`. After `requireSession` and a check that the
   vendored manifest lists that name, the route:
   - 302s to a **60 s signed URL** for `training-assets/co-scenes/<name>`, minted by the service role
     (`lib/training/training-assets.ts`), with `Cache-Control: no-store`.
   - Locally only, if the git-ignored dev store `vendor/co-scenes/photos/` has the file, it serves it instead, re-hashed.
3. The page sha256-checks every photo against the manifest before use. Track C's loader checks it again.
4. If any photo is missing or wrong, the scene falls back to the drawn studio look (marked "Illustrated"). If that also
   fails, the page falls back to the plain step list. The page never breaks.

## One-time setup per Supabase project (Juan's word first for PROD)

1. **Apply `supabase/migrations/0212_training_assets_bucket.sql`.** This creates the private bucket with no object
   policies. It is a prod change, so it runs only on Juan's go. Verify with the read-only queries at the foot of the
   migration.
2. **Dry run the upload:**
   `npx tsx --conditions=react-server --env-file=.env.local scripts/upload-training-assets.ts --dry-run`
3. **Upload for real:** run the same command without `--dry-run`.
   - Every photo is checked against its manifest sha256 before anything uploads.
   - Names are content-addressed, so a re-run skips what is already there and never overwrites.
4. **Smoke test on the PR preview:** open `/training/build/crunchy-boi` on a phone.
   - The real sub shows, and there is no "Illustrated" badge.

## When co-scenes ships a new scene

1. Rebuild the training bundle in co-scenes:
   `CO_SCENES_CARD_CSV=<co-ops>/docs/seed/source/sandwich-build-sheet.csv CO_SCENES_CRUNCHY_ASSETS=<track C .crunchy-assets> npx tsx web/build-training-web.ts`
2. Vendor it into CO-OPS:
   `npx tsx scripts/vendor-co-scenes.ts <co-scenes>/web/dist-training <sha> <branch>`
   - This refreshes `dist/` (commit it) and the local dev store (never committed).
3. Re-run the upload (step 3 above). Only the new photos go up.
4. Run the tests:
   `npx vitest run tests/co-scenes-vendor.test.ts tests/co-scenes-route.test.ts tests/training-assets-upload.test.ts tests/training-build-card.test.ts`

## Notes

- **CSP.** The security policy is **report-only**. The page checks each photo and then hands it to the scene as a
  `blob:` URL. That fetch, plus the signed-URL redirect to `*.supabase.co`, will show up in CSP reports under
  `connect-src` until both origins are added. `/api/photos` redirects have the same gap under `img-src`. Add both before
  CSP is ever enforced.
- **Stray objects.** The upload script reports objects under `co-scenes/` that the manifest no longer names and leaves
  them alone. Removing them is a separate, deliberate step.
