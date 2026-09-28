/**
 * Upload the "Learn the build" photos to the private `training-assets` bucket (0212).
 *
 * SERVICE ROLE. Runs against whatever project .env.local points at — prod only on
 * Juan's word (docs/runbooks/training-assets.md). Never run it against a project
 * whose 0212 has not been applied.
 *
 *   - The vendored co-scenes manifest (vendor/co-scenes/dist/asset-manifest.json)
 *     is the source of truth: exactly its `photos` are uploaded.
 *   - Every photo's bytes are sha256-checked against the manifest BEFORE upload.
 *   - Idempotent: object paths are content-addressed (the name carries the sha256),
 *     so a name already in the bucket is skipped and nothing is ever overwritten
 *     (`upsert: false`).
 *   - `--dry-run` reads the bucket listing and prints the plan; it writes nothing.
 *
 * Run:
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/upload-training-assets.ts [--dry-run] [--from <dir>]
 * `--from` defaults to vendor/co-scenes/photos (filled by scripts/vendor-co-scenes.ts).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  planTrainingUpload,
  TRAINING_ASSETS_BUCKET,
  TRAINING_ASSETS_PREFIX,
  trainingPhotoObjectPath,
  type UploadPlan,
} from "@/lib/training/training-assets-shared";

/** The slice of the Supabase storage API this script uses (mocked in tests). */
export interface TrainingStorage {
  list(prefix: string): Promise<string[]>;
  upload(objectPath: string, bytes: Uint8Array): Promise<void>;
}

export interface UploadResult extends UploadPlan {
  dryRun: boolean;
}

export async function uploadTrainingAssets(opts: {
  photos: Readonly<Record<string, string>>;
  readPhoto(name: string): Uint8Array;
  storage: TrainingStorage;
  dryRun: boolean;
}): Promise<UploadResult> {
  // Verify EVERY photo before any upload, so a bad local copy uploads nothing.
  const bytes = new Map<string, Uint8Array>();
  for (const [name, sha] of Object.entries(opts.photos)) {
    const b = opts.readPhoto(name);
    if (createHash("sha256").update(b).digest("hex") !== sha) {
      throw new Error(`upload-training-assets: ${name} does not match its manifest sha256`);
    }
    bytes.set(name, b);
  }
  const plan = planTrainingUpload(opts.photos, await opts.storage.list(TRAINING_ASSETS_PREFIX));
  if (!opts.dryRun) {
    for (const name of plan.upload) await opts.storage.upload(trainingPhotoObjectPath(name), bytes.get(name)!);
  }
  return { ...plan, dryRun: opts.dryRun };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fromIdx = args.indexOf("--from");
  const from = fromIdx >= 0 ? args[fromIdx + 1] : path.join("vendor", "co-scenes", "photos");
  if (!from) throw new Error("--from needs a directory");

  const manifest = JSON.parse(readFileSync(path.join("vendor", "co-scenes", "dist", "asset-manifest.json"), "utf8")) as {
    photos?: Record<string, string>;
  };
  const photos = manifest.photos ?? {};
  if (!Object.keys(photos).length) throw new Error("upload-training-assets: the vendored manifest lists no photos");

  const { getServiceRoleClient } = await import("@/lib/supabase-server");
  const bucket = getServiceRoleClient().storage.from(TRAINING_ASSETS_BUCKET);
  const storage: TrainingStorage = {
    async list(prefix) {
      const names: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await bucket.list(prefix, { limit: 1000, offset });
        if (error) throw new Error(`list: ${error.message} (is 0212 applied on this project?)`);
        names.push(...(data ?? []).map((o) => o.name));
        if (!data || data.length < 1000) return names;
      }
    },
    async upload(objectPath, b) {
      const { error } = await bucket.upload(objectPath, b, { contentType: "image/png", upsert: false });
      if (error) throw new Error(`upload ${objectPath}: ${error.message}`);
    },
  };

  const r = await uploadTrainingAssets({ photos, readPhoto: (n) => readFileSync(path.join(from, n)), storage, dryRun });
  console.log(
    `${dryRun ? "[dry-run] " : ""}training-assets: ${r.upload.length} to upload, ${r.skip.length} already present` +
      (r.stray.length ? `, ${r.stray.length} stray object(s) not in the manifest (left alone)` : ""),
  );
  for (const n of r.upload) console.log(`  ${dryRun ? "would upload" : "uploaded"} ${n}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
