/**
 * Upload "Learn the build" photos and optional video/poster to the private bucket (0212/0213).
 *
 * SERVICE ROLE. Runs against whatever project .env.local points at — prod only on
 * Juan's word (docs/runbooks/training-assets.md). Never run it against a project
 * whose 0212 has not been applied.
 *
 *   - The vendored co-scenes manifest (vendor/co-scenes/dist/asset-manifest.json)
 *     is the source of truth: its `photos` plus optional `video` media are uploaded.
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
  trainingMediaType,
  type UploadPlan,
} from "@/lib/training/training-assets-shared";
import { validTrainingMedia, type CoScenesManifest } from "@/lib/training/co-scenes-shared";

/** The slice of the Supabase storage API this script uses (mocked in tests). */
export interface TrainingStorage {
  list(prefix: string): Promise<string[]>;
  upload(objectPath: string, bytes: Uint8Array, contentType: string): Promise<void>;
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
    const type = trainingMediaType(name);
    const b = opts.readPhoto(name);
    const limit = type === "image/png" ? 2 * 1024 * 1024 : 12 * 1024 * 1024;
    if (!b.length || b.length > limit) throw new Error(`upload-training-assets: ${name} exceeds size limit`);
    if (createHash("sha256").update(b).digest("hex") !== sha) {
      throw new Error(`upload-training-assets: ${name} does not match its manifest sha256`);
    }
    bytes.set(name, b);
  }
  const plan = planTrainingUpload(opts.photos, await opts.storage.list(TRAINING_ASSETS_PREFIX));
  if (!opts.dryRun) {
    for (const name of plan.upload) await opts.storage.upload(trainingPhotoObjectPath(name), bytes.get(name)!, trainingMediaType(name));
  }
  return { ...plan, dryRun: opts.dryRun };
}

/** `[--dry-run] [--from <dir>]`; refuses unknown flags and a flag given as the directory. */
export function parseUploadArgs(args: readonly string[]): { dryRun: boolean; from: string } {
  let dryRun = false;
  let from = path.join("vendor", "co-scenes", "photos");
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--dry-run") dryRun = true;
    else if (a === "--from") {
      const v = args[++i];
      if (!v || v.startsWith("-")) throw new Error("--from needs a directory");
      from = v;
    } else throw new Error(`unknown argument ${a}`);
  }
  return { dryRun, from };
}

async function main() {
  const { dryRun, from } = parseUploadArgs(process.argv.slice(2));

  const manifest = JSON.parse(readFileSync(path.join("vendor", "co-scenes", "dist", "asset-manifest.json"), "utf8")) as CoScenesManifest;
  const photos = { ...manifest.photos };
  if (manifest.video) {
    if (!validTrainingMedia(manifest.video.source, "video/mp4") || !validTrainingMedia(manifest.video.poster, "image/jpeg")) throw new Error("invalid video manifest");
    for (const asset of [manifest.video.source, manifest.video.poster]) photos[asset.name] = asset.sha256;
  }
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
    async upload(objectPath, b, contentType) {
      const { error } = await bucket.upload(objectPath, b, { contentType, upsert: false });
      if (error) throw new Error(`upload ${objectPath}: ${error.message}`);
    },
  };

  const readPhoto = (n: string) => {
    try {
      return readFileSync(path.join(from, n));
    } catch {
      throw new Error(`upload-training-assets: ${n} is not in ${from} — run scripts/vendor-co-scenes.ts first (or pass --from)`);
    }
  };
  const r = await uploadTrainingAssets({ photos, readPhoto, storage, dryRun });
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
