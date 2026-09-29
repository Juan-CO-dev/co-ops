/** Pure import gates. No renderer, filesystem, or server dependencies. */
export const APPROVED_RENDERER_REVISION = "6dfa9784e19680e47dc7e38533139085c53cd94f";
export const MAX_IMPORT_BYTES = 12 * 1024 * 1024;
type Step = { n: number; key: string; ingredient: string | null; amount: string | null };
export interface ImportSidecar extends Record<string, unknown> {
  look: string; steps: Step[]; step_times: number[]; duration: number;
  poster: string; sources: { url: string; type: string; bytes: number; sha256: string }[];
  stamps: Record<string, unknown>;
}
export function assertRendererRevision(head: string, approved = APPROVED_RENDERER_REVISION): void {
  if (!/^[a-f0-9]{40}$/.test(head) || head !== approved) throw new Error("renderer HEAD is not the approved revision");
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => {
  if (object(a) && object(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
  return a === b;
};
export function validateTrainingSidecar(value: unknown, expected: { steps: readonly Step[]; stepTimes: readonly number[]; duration: number; stamps: Record<string, unknown> }): ImportSidecar {
  const bad = (why: string): never => { throw new Error(`training video: ${why}`); };
  if (!object(value)) return bad("missing sidecar");
  const s = value;
  if (s.format !== "co-scenes-video/1" || s.look !== "stage" || s.aspect !== "9:16" || s.width !== 720 || s.height !== 1280 || s.fps !== 30) bad("expected stage 720x1280 30 fps");
  if (s.dirty !== undefined && s.dirty !== false) bad("dirty render");
  if (!Array.isArray(s.illustrated) || s.illustrated.length) bad("illustrated food");
  if (s.duration !== expected.duration || s.frames !== Math.floor(expected.duration * 30 + 1e-9) + 1) bad("duration/frames");
  if (!Array.isArray(s.steps) || s.steps.length !== expected.steps.length) bad("step count");
  (s.steps as unknown[]).forEach((step, i) => {
    const exp = expected.steps[i]!;
    if (!object(step) || step.drawn === true || !["n", "key", "ingredient", "amount"].every(k => step[k] === exp[k as keyof Step])) bad(`step ${i + 1} differs from card`);
  });
  if (!Array.isArray(s.step_times) || s.step_times.length !== expected.stepTimes.length) bad("step times length");
  (s.step_times as unknown[]).forEach((t, i) => {
    if (typeof t !== "number" || !Number.isFinite(t) || Math.abs(t - expected.stepTimes[i]!) > 1 / 60 + 1e-9) bad(`step time ${i}`);
  });
  if (!object(s.stamps)) bad("missing stamps");
  for (const key of ["card_revision_sha", "scene_tree", "code_sha256", "display_sha256", "photo_manifest_sha256", "packages", "render", "env"]) {
    if (!expected.stamps[key] || !same((s.stamps as Record<string, unknown>)[key], expected.stamps[key])) bad(`stale ${key}`);
  }
  if (typeof s.poster !== "string" || !/^stage-720x1280-poster-[a-f0-9]{16}\.jpg$/.test(s.poster)) bad("poster filename");
  if (!Array.isArray(s.sources) || !s.sources.length) bad("sources missing");
  const mp4 = (s.sources as unknown[]).filter(v => object(v) && typeof v.type === "string" && v.type.startsWith("video/mp4"));
  if (mp4.length !== 1) bad("exactly one MP4 required");
  const source = mp4[0] as Record<string, unknown>;
  if (typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256) || source.url !== `stage-720x1280-${source.sha256.slice(0, 16)}.mp4` || !Number.isSafeInteger(source.bytes) || !(Number(source.bytes) > 0 && Number(source.bytes) <= MAX_IMPORT_BYTES)) bad("MP4 metadata");
  return s as ImportSidecar;
}
/** Parse top-level ISO BMFF boxes, including extended sizes; no scanning payloads for fake moov text. */
export function assertFaststart(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0, moov = -1, mdat = -1, ftyp = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 8) throw new Error("truncated MP4 box");
    let size = view.getUint32(offset); let header = 8;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (size === 1) {
      if (bytes.length - offset < 16) throw new Error("truncated extended MP4 box");
      size = Number(view.getBigUint64(offset + 8)); header = 16;
    } else if (size === 0) size = bytes.length - offset;
    if (!Number.isSafeInteger(size) || size < header || size > bytes.length - offset) throw new Error("invalid MP4 box size");
    if (type === "ftyp") ftyp = true;
    if (type === "moov" && moov < 0) moov = offset;
    if (type === "mdat" && mdat < 0) mdat = offset;
    offset += size;
  }
  if (!ftyp || moov < 0 || mdat < 0 || moov > mdat) throw new Error("MP4 requires faststart (moov before mdat)");
}
