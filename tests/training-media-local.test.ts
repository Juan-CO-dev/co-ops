import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync, statSync, utimesSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { readCoScenesMedia } from "@/lib/training/co-scenes-files";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, open: vi.fn(original.open) };
});

it("hash-checks local bytes before streaming an exact range and refuses corruption", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const rel = `test-local-${sha}.mp4`;
  const dir = path.resolve("vendor/co-scenes/photos");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, rel);
  writeFileSync(file, bytes, { flag: "wx" });
  const asset = { rel, store: "photos" as const, sha256: sha, bytes: bytes.length, contentType: "video/mp4" };
  try {
    const read = await readCoScenesMedia(asset, { status: 206, start: 2, end: 4, length: 3 });
    expect([...new Uint8Array(await new Response(read!.body).arrayBuffer())]).toEqual([3, 4, 5]);
    writeFileSync(file, new Uint8Array(6));
    await expect(readCoScenesMedia(asset, { status: 200, length: 6 })).resolves.toBeNull();
    writeFileSync(file, new Uint8Array(2));
    await expect(readCoScenesMedia(asset, { status: 200, length: 6 })).resolves.toBeNull();
  } finally { unlinkSync(file); }
});

it("reuses a verified handle identity across seeks but rehashes changed bytes even with restored mtime", async () => {
  const bytes = new Uint8Array([9, 8, 7, 6]);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const rel = `test-cache-${sha}.mp4`;
  const file = path.resolve("vendor/co-scenes/photos", rel);
  writeFileSync(file, bytes, { flag: "wx" });
  const asset = { rel, store: "photos" as const, sha256: sha, bytes: bytes.length, contentType: "video/mp4" };
  const { open: originalOpen } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const reads: ReturnType<typeof vi.spyOn>[] = [];
  const opened = vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    reads.push(vi.spyOn(handle, "read"));
    return handle;
  });
  try {
    for (const start of [0, 2]) {
      const result = await readCoScenesMedia(asset, { status: 206, start, end: start + 1, length: 2 });
      expect([...new Uint8Array(await new Response(result!.body).arrayBuffer())]).toEqual([...bytes.slice(start, start + 2)]);
    }
    expect(reads[0]!.mock.calls.length).toBeGreaterThan(0);
    // Both requests stream their range; only the first also reads the full file.
    expect(reads[0]!.mock.calls.length).toBeGreaterThan(reads[1]!.mock.calls.length);
    const before = statSync(file);
    writeFileSync(file, new Uint8Array(4));
    utimesSync(file, before.atime, before.mtime);
    await expect(readCoScenesMedia(asset, { status: 200, length: 4 })).resolves.toBeNull();
    expect(reads[2]!.mock.calls.length).toBeGreaterThan(0);
    writeFileSync(file, bytes);
    const repaired = await readCoScenesMedia(asset, { status: 200, length: 4 });
    expect([...new Uint8Array(await new Response(repaired!.body).arrayBuffer())]).toEqual([...bytes]);
  } finally { opened.mockImplementation(originalOpen); unlinkSync(file); }
});
