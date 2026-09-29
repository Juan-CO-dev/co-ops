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
   - The route does NOT check that an object exists before signing it; storage only checks when the URL is fetched.
     A photo not yet uploaded therefore returns a 302 to a signed URL that storage then answers with 400 or 404.
   - This fails closed: the page's photo preload treats any non-OK response, or any sha256 mismatch, as "no real
     photo". The route itself only 404s when the manifest does not list the name or when signing fails.

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

## Import a reviewed stage video (no rendering or upload)

CC supplies the genuine renderer sidecar, H.264 MP4 and JPEG poster from clean co-scenes revision
`6dfa9784e19680e47dc7e38533139085c53cd94f`: stage, 720x1280, 30 fps, empty illustrated intervals.
No placeholder video is registered. Use the renderer's original environment, dependencies and approved
real-photo asset directory: the importer recomputes the complete code/card/assets/package/render/environment
stamps, so copying the files to a different rendering environment can correctly refuse the import.

```powershell
npx tsx scripts/import-training-video.ts --sidecar <renderer-output-sidecar.json> --renderer <co-scenes-checkout> --assets <approved-track-C-assets-directory>
```

The importer reads this checkout's build sheet in place, requires the actual renderer HEAD (the informational
`scene_commit` is the last scene edit, not HEAD), validates every step's number/key/ingredient/amount, and compares
stage beat completion times within half a 30 fps frame. It verifies full MP4 hash and size (12 MiB maximum),
poster/sidecar hash16 filenames, JPEG signature, faststart atom order, and ffprobe's H.264/dimensions/frame rate.
`ffprobe` must be on PATH. It never re-encodes food pixels.

Media are copied byte-for-byte into ignored `vendor/co-scenes/photos/`, with full SHA-256 names. The derived,
committed sidecar retains the original renderer JSON under `renderer_original` and rewrites playback URLs to
the authenticated `media/` route. The manifest's optional `video` entry holds source and poster metadata;
its `files` map hashes the derived sidecar. Existing media and sidecars must be byte-identical or import refuses;
manifest hash collisions also refuse. A repeat import is safe. Commit only the manifest and derived JSON.

After CC reviews/applies the new training-video bucket migration, run the uploader's dry run, then the authorized
upload. The MP4/poster use private same-origin streaming and never signed-URL redirects. On the PR preview,
Safari playback and seeking (`bytes=0-1` gives 206 and exactly two bytes), reduced motion, language remount,
scene failure retention, ready-only swap and revoked-session refusal are release gates. A unit pass does not
replace this genuine-artifact/device verification.

Migration `0213_training_video_media.sql` is staged only. It sets the bucket's single object-size cap to 12 MiB
and adds JPEG/MP4 to PNG. The uploader continues to enforce 2 MiB for PNG and 12 MiB for JPEG/MP4, sends each
file's correct MIME, and never overwrites (`upsert: false`). The bucket stays private with no new object policies.
GET supports single MP4 byte ranges; unsupported multipart/malformed ranges return a full 200. If-Range matches
only the exact quoted full SHA-256 ETag; a mismatch returns 200. HEAD ignores Range, returns full-length headers
without a body, and uses the same session/manifest gate. JPEG is full-body only. Genuine uploaded media must be
verified in the preview because mocked upstream responses do not prove Storage's deployed range behavior.
