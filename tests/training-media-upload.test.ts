import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { uploadTrainingAssets } from "@/scripts/upload-training-assets";
import { trainingMediaType } from "@/lib/training/training-assets-shared";

it.each([["mp4", "video/mp4"], ["jpg", "image/jpeg"], ["png", "image/png"]])("uploads %s with correct MIME", async (ext, type) => {
  const b = new Uint8Array([1, 2, 3]); const sha = createHash("sha256").update(b).digest("hex");
  const name = `test-${sha}.${ext}`; const upload = vi.fn();
  await uploadTrainingAssets({ photos: { [name]: sha }, readPhoto: () => b, storage: { list: async () => [], upload }, dryRun: false });
  expect(trainingMediaType(name)).toBe(type);
  expect(upload).toHaveBeenCalledWith(`co-scenes/${name}`, b, type);
});
it("keeps the PNG 2 MiB limit before any storage operation", async () => {
  const b = new Uint8Array(2 * 1024 * 1024 + 1); const sha = createHash("sha256").update(b).digest("hex");
  const storage = { list: vi.fn(async () => []), upload: vi.fn() };
  await expect(uploadTrainingAssets({ photos: { [`test-${sha}.png`]: sha }, readPhoto: () => b, storage, dryRun: false })).rejects.toThrow(/size/);
  expect(storage.list).not.toHaveBeenCalled(); expect(storage.upload).not.toHaveBeenCalled();
});
