# vendor/co-scenes — the "Learn the build" scene

The interactive Crunchy Boi on `/training/build/crunchy-boi` is co-scenes' `<crunchy-build>` element running track C's
real-photo scene (C1, stage-show; Juan approved round 3). This folder is the vendored copy.

| Path | What | In git? |
|---|---|---|
| `VERSION` | the co-scenes commit + branch this copy was built from | yes |
| `dist/asset-manifest.json` | **the source of truth**: `entries` (training entry, scene data), `files` (code/data → sha256), `photos` (photo name → sha256) | yes |
| `dist/*.js`, `dist/chunks/*.js` | the hashed element + scene bundle | yes |
| `dist/crunchy-data-*.json` | scene data: steps, baked layout, the photo list (CO-OPS names/amounts, generated from the build sheet in place) | yes |
| `dist/card-display.json` | co-scenes' display table (mirrored in `lib/training/build-card-shared.ts`; a test keeps them equal) | yes |
| `photos/*.png` | LOCAL dev store of the real food photos (track C's derived cut-outs, byte-for-byte); deploys use the `training-assets` bucket | **NO — git-ignored (photo rule)** |

Nothing here is under `public/`. Every file is served only by `app/api/training/co-scenes/[...path]/route.ts`, behind
full session validation: code/data with `Cache-Control: private, no-cache` + a strong ETag (the manifest sha256);
photos as a 302 to a 60 s signed URL (or, locally, from the dev store, re-hashed on read).

## Refreshing it

1. In co-scenes (the web integration branch), build the training bundle from co-scenes `main` (v0.2.0-m2 = 67afe59 at this refresh), reading the CO-OPS sheet in place:
   `CO_SCENES_CARD_CSV=<co-ops>/docs/seed/source/sandwich-build-sheet.csv CO_SCENES_CRUNCHY_ASSETS=<track C .crunchy-assets> npx tsx web/build-training-web.ts`
2. In CO-OPS: `npx tsx scripts/vendor-co-scenes.ts <co-scenes>/web/dist-training <commit sha> <branch>`.
   It copies `files` into `dist/` and `photos` into the git-ignored `photos/`, checking every sha256.
3. Upload new photos to the bucket (`docs/runbooks/training-assets.md`).
4. `npx vitest run tests/co-scenes-vendor.test.ts tests/co-scenes-route.test.ts tests/training-assets-upload.test.ts tests/training-build-card.test.ts`.

## How a deploy gets the photos (Juan, 2026-09-28: "use that same sort of path" as receipts)

A private Supabase Storage bucket, `training-assets` (migration 0212, staged; applied only on Juan's word). The route
302s to a 60 s signed URL after `requireSession`; `scripts/upload-training-assets.ts` uploads the manifest's photos
(sha256-checked, content-addressed, idempotent, `--dry-run`). Full steps: `docs/runbooks/training-assets.md`.
Until the bucket is populated, a deploy shows the drawn studio look (marked "Illustrated"), then the plain step list.
