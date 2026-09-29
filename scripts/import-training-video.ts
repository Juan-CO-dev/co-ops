/** Import an existing reviewed renderer artifact; never render, upload, or read credentials. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildDefForSlug, buildSteps } from "@/lib/training/build-card-shared";
import { BUILD_SHEET_PATH, exportBuildCard } from "@/lib/training/build-card-export";
import { assertFaststart, assertRendererRevision, MAX_IMPORT_BYTES, validateTrainingSidecar } from "@/lib/training/video-import-shared";
import type { CoScenesManifest } from "@/lib/training/co-scenes-shared";

const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
export function verifyVideoBytes(bytes: Uint8Array, expected: { sha256?: string; bytes?: number; hashPrefix?: string }): string {
  const hash = sha(bytes);
  if (!bytes.length || bytes.length > MAX_IMPORT_BYTES || (expected.bytes !== undefined && bytes.length !== expected.bytes) || (expected.sha256 !== undefined && hash !== expected.sha256) || (expected.hashPrefix !== undefined && !hash.startsWith(expected.hashPrefix))) throw new Error("media bytes do not match declared hash/size");
  return hash;
}
/** O_EXCL protects a new path; every existing destination is compared, never replaced. */
export function immutableWrite(file: string, bytes: Uint8Array): void {
  try { writeFileSync(file, bytes, { flag: "wx" }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    if (!readFileSync(file).equals(Buffer.from(bytes))) throw new Error(`existing artifact differs: ${path.basename(file)}`);
  }
  if (!readFileSync(file).equals(Buffer.from(bytes))) throw new Error("artifact readback differs");
}
function boundedRead(file: string): Buffer {
  if (statSync(file).size > MAX_IMPORT_BYTES) throw new Error("artifact exceeds 12 MiB");
  return readFileSync(file);
}
function argumentsFor(args: readonly string[]): { sidecar: string; renderer: string; assets: string } {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!, value = args[++i];
    if (!["--sidecar", "--renderer", "--assets"].includes(key) || values[key] || !value || value.startsWith("--")) throw new Error("expected --sidecar <json> --renderer <checkout> --assets <approved-directory>");
    values[key] = path.resolve(value);
  }
  if (!values["--sidecar"] || !values["--renderer"] || !values["--assets"]) throw new Error("--sidecar, --renderer and --assets are required");
  return { sidecar: values["--sidecar"], renderer: values["--renderer"], assets: values["--assets"] };
}
export async function importTrainingVideo(args: readonly string[]): Promise<string> {
  const opts = argumentsFor(args);
  const git = (...a: string[]) => execFileSync("git", ["-C", opts.renderer, ...a], { encoding: "utf8" }).trim();
  assertRendererRevision(git("rev-parse", "HEAD"));
  // Check tracked code before loading renderer modules, then computeStamps checks the precise closure too.
  if (git("status", "--porcelain", "--untracked-files=no")) throw new Error("renderer checkout is dirty");
  const load = (rel: string) => import(pathToFileURL(path.join(opts.renderer, rel)).href);
  const stampModule = await load("src/node/video-stamps.ts");
  const { STAGE_NARRATIVE: narrative } = await load("src/scene/crunchy/timeline.ts");
  const { stepTime } = await load("src/scene/crunchy/narrative.ts");
  const { encoderLabel } = await load("web/render-video.ts");
  const { REVISION: three } = await load("node_modules/three/build/three.module.js");
  const csvPath = path.resolve(BUILD_SHEET_PATH);
  const def = buildDefForSlug("crunchy-boi")!;
  const card = exportBuildCard(readFileSync(csvPath, "utf8"), def.item);
  const steps = buildSteps(def, card, "en");
  const assetManifestPath = path.join(opts.assets, "assets.json");
  const assetManifest: unknown = JSON.parse(readFileSync(assetManifestPath, "utf8"));
  if (!Array.isArray(assetManifest) || !assetManifest.length) throw new Error("approved asset manifest is empty");
  for (const asset of assetManifest as { path?: unknown; sha256?: unknown }[]) {
    if (!asset || typeof asset.path !== "string" || typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("invalid approved asset entry");
    const file = path.resolve(opts.assets, asset.path);
    if (!file.startsWith(opts.assets + path.sep)) throw new Error("asset path escapes approved directory");
    if (sha(readFileSync(file)) !== asset.sha256) throw new Error("approved source asset hash mismatch");
  }
  const current = await stampModule.computeStamps({ repoRoot: opts.renderer, cardCsv: csvPath, item: def.item, manifestPath: assetManifestPath, render: { width: 720, height: 1280, fps: 30, three, encoder: encoderLabel({ look: "stage", width: 720 }) } });
  if (current.dirty.length) throw new Error("renderer import closure is dirty");
  const originalBytes = boundedRead(opts.sidecar);
  if (path.basename(opts.sidecar) !== `stage-720x1280-video-${sha(originalBytes).slice(0, 16)}.json`) throw new Error("sidecar hash16 filename mismatch");
  const original: unknown = JSON.parse(originalBytes.toString("utf8"));
  const sidecar = validateTrainingSidecar(original, { steps, stepTimes: [0, ...steps.map(s => stepTime(narrative, s.n))], duration: narrative.duration, stamps: current.stamps });
  const source = sidecar.sources.find(s => s.type.startsWith("video/mp4"))!;
  const mp4Path = path.join(path.dirname(opts.sidecar), source.url);
  const mp4 = boundedRead(mp4Path), poster = boundedRead(path.join(path.dirname(opts.sidecar), sidecar.poster));
  const mp4Hash = verifyVideoBytes(mp4, source);
  const posterHash = verifyVideoBytes(poster, { hashPrefix: sidecar.poster.slice(-20, -4) });
  if (poster[0] !== 0xff || poster[1] !== 0xd8 || poster[2] !== 0xff || poster.at(-2) !== 0xff || poster.at(-1) !== 0xd9) throw new Error("poster is not JPEG");
  assertFaststart(mp4);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", mp4Path], { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 })) as { streams: { codec_type: string; codec_name: string; width: number; height: number; avg_frame_rate: string; nb_frames: string }[] };
  const videoStreams = probe.streams.filter(s => s.codec_type === "video");
  const v = videoStreams[0];
  if (videoStreams.length !== 1 || !v || v.codec_name !== "h264" || v.width !== 720 || v.height !== 1280 || v.avg_frame_rate !== "30/1" || Number(v.nb_frames) !== sidecar.frames || probe.streams.some(s => s.codec_type === "audio")) throw new Error("ffprobe: expected silent H.264 720x1280 30 fps with declared frames");
  const sourceName = `training-${mp4Hash}.mp4`, posterName = `poster-${posterHash}.jpg`;
  const derived = JSON.stringify({ ...sidecar, sources: [{ ...source, url: `media/${sourceName}` }], poster: `media/${posterName}`, renderer_original: original, renderer_revision: git("rev-parse", "HEAD") }, null, 2) + "\n";
  const derivedHash = sha(derived), derivedName = `training-video-${derivedHash}.json`;
  const dist = path.resolve("vendor/co-scenes/dist"), media = path.resolve("vendor/co-scenes/photos");
  const manifestPath = path.join(dist, "asset-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CoScenesManifest;
  if (Object.hasOwn(manifest.files, derivedName) && manifest.files[derivedName] !== derivedHash) throw new Error("manifest sidecar hash collision");
  // Preflight every collision before any output write.
  for (const [file, bytes] of [[path.join(media, sourceName), mp4], [path.join(media, posterName), poster], [path.join(dist, derivedName), Buffer.from(derived)]] as const) {
    if (existsSync(file) && !readFileSync(file).equals(bytes)) throw new Error(`existing artifact differs: ${path.basename(file)}`);
  }
  mkdirSync(media, { recursive: true });
  immutableWrite(path.join(media, sourceName), mp4);
  immutableWrite(path.join(media, posterName), poster);
  immutableWrite(path.join(dist, derivedName), Buffer.from(derived));
  manifest.files[derivedName] = derivedHash;
  manifest.video = { sidecar: derivedName, source: { name: sourceName, sha256: mp4Hash, bytes: mp4.length, contentType: "video/mp4" }, poster: { name: posterName, sha256: posterHash, bytes: poster.length, contentType: "image/jpeg" } };
  const out = JSON.stringify(manifest, null, 2) + "\n";
  writeFileSync(manifestPath, out);
  if (readFileSync(manifestPath, "utf8") !== out) throw new Error("manifest readback differs");
  return derivedName;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  importTrainingVideo(process.argv.slice(2)).then(name => console.log(`Imported ${name}; no upload performed.`)).catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
}
