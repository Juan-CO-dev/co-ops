import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { readCoScenesMedia } from "@/lib/training/co-scenes-files";

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
    await expect(readCoScenesMedia(asset, { status: 200, length: 6 })).rejects.toThrow(/unavailable/);
  } finally { unlinkSync(file); }
});
