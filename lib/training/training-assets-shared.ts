/**
 * training-assets-shared — the pure half of the training-photo storage path
 * (bucket name, object paths, the idempotent upload plan). Client-safe: no I/O.
 *
 * Photos live in the private `training-assets` bucket (0212), content-addressed:
 * the object path carries the photo's manifest name, and every manifest name
 * carries the photo's sha256 — so an object that exists under a name IS that
 * photo, and an upload never overwrites.
 */

export const TRAINING_ASSETS_BUCKET = "training-assets";
export const TRAINING_ASSETS_PREFIX = "co-scenes";
export const TRAINING_SIGNED_URL_TTL_SECONDS = 60;

/** A manifest photo name: `<asset id>-<sha256>.png`. */
const PHOTO_NAME = /^[A-Za-z0-9._-]+-([0-9a-f]{64})\.png$/;

export function trainingPhotoObjectPath(name: string): string {
  if (!PHOTO_NAME.test(name)) throw new Error(`training-assets: refusing photo name ${name}`);
  return `${TRAINING_ASSETS_PREFIX}/${name}`;
}

/** The sha256 a manifest photo name promises; null when the name does not carry one. */
export function shaInPhotoName(name: string): string | null {
  return PHOTO_NAME.exec(name)?.[1] ?? null;
}

export interface UploadPlan {
  upload: string[];
  skip: string[];
  /** Objects under the prefix the manifest does not name (left alone; reported). */
  stray: string[];
}

/**
 * Which manifest photos to upload. A name already in the bucket is skipped (the
 * name is content-addressed, so it is already the right bytes). Refuses a
 * manifest whose name and sha256 disagree.
 */
/**
 * Supabase `list(prefix)` returns names RELATIVE to the prefix on current
 * storage-api, but some versions have returned the full path. Normalise both to
 * the bare name so the plan never depends on which one this project runs.
 */
export function bareListedName(listed: string): string {
  const p = `${TRAINING_ASSETS_PREFIX}/`;
  const s = listed.replace(/^\/+/, "");
  return s.startsWith(p) ? s.slice(p.length) : s;
}

export function planTrainingUpload(photos: Readonly<Record<string, string>>, listed: readonly string[]): UploadPlan {
  const remote = listed.map(bareListedName);
  const have = new Set(remote);
  const upload: string[] = [];
  const skip: string[] = [];
  for (const [name, sha] of Object.entries(photos).sort(([a], [b]) => a.localeCompare(b))) {
    if (shaInPhotoName(name) !== sha) throw new Error(`training-assets: ${name} does not carry its manifest sha256`);
    (have.has(name) ? skip : upload).push(name);
  }
  const named = new Set(Object.keys(photos));
  return { upload, skip, stray: remote.filter((r) => !named.has(r)).sort() };
}
