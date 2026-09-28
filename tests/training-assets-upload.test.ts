/**
 * Unit spine — the training-photo upload (scripts/upload-training-assets.ts) and
 * its pure plan (lib/training/training-assets-shared.ts), against MOCKED storage.
 * Pins: every photo is sha256-checked BEFORE any upload (a bad copy uploads
 * nothing); content-addressed names make it idempotent (present → skipped, never
 * overwritten); --dry-run writes nothing; object paths are prefixed and refuse a
 * name that does not carry a sha256.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { uploadTrainingAssets, type TrainingStorage } from "@/scripts/upload-training-assets";
import {
  planTrainingUpload,
  shaInPhotoName,
  TRAINING_ASSETS_BUCKET,
  trainingPhotoObjectPath,
} from "@/lib/training/training-assets-shared";

const bytesOf = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const A = bytesOf("photo-a");
const B = bytesOf("photo-b");
const nameA = `cb-p-a-${sha(A)}.png`;
const nameB = `cb-p-b-${sha(B)}.png`;
const photos = { [nameA]: sha(A), [nameB]: sha(B) };
const files: Record<string, Uint8Array> = { [nameA]: A, [nameB]: B };

function mockStorage(remote: string[]): TrainingStorage & { uploads: string[] } {
  const uploads: string[] = [];
  return {
    uploads,
    list: vi.fn(async () => remote),
    upload: vi.fn(async (p: string) => {
      uploads.push(p);
    }),
  };
}

describe("training-assets paths + plan", () => {
  it("bucket and content-addressed object paths", () => {
    expect(TRAINING_ASSETS_BUCKET).toBe("training-assets");
    expect(trainingPhotoObjectPath(nameA)).toBe(`co-scenes/${nameA}`);
    expect(shaInPhotoName(nameA)).toBe(sha(A));
    expect(() => trainingPhotoObjectPath("../x.png")).toThrow(/refusing/);
    expect(() => trainingPhotoObjectPath("plain.png")).toThrow(/refusing/);
  });

  it("present names are skipped, strays reported, a name/sha disagreement refused", () => {
    expect(planTrainingUpload(photos, [nameA, "old.png"])).toEqual({ upload: [nameB], skip: [nameA], stray: ["old.png"] });
    expect(() => planTrainingUpload({ [nameA]: sha(B) }, [])).toThrow(/does not carry its manifest sha256/);
  });
});

describe("uploadTrainingAssets (mocked storage)", () => {
  it("uploads only what is missing, under the prefix", async () => {
    const storage = mockStorage([nameA]);
    const r = await uploadTrainingAssets({ photos, readPhoto: (n) => files[n]!, storage, dryRun: false });
    expect(r.upload).toEqual([nameB]);
    expect(storage.uploads).toEqual([`co-scenes/${nameB}`]);
  });

  it("is idempotent: a second run uploads nothing", async () => {
    const storage = mockStorage([nameA, nameB]);
    const r = await uploadTrainingAssets({ photos, readPhoto: (n) => files[n]!, storage, dryRun: false });
    expect(r.upload).toEqual([]);
    expect(storage.uploads).toEqual([]);
  });

  it("--dry-run plans but writes nothing", async () => {
    const storage = mockStorage([]);
    const r = await uploadTrainingAssets({ photos, readPhoto: (n) => files[n]!, storage, dryRun: true });
    expect(r).toMatchObject({ dryRun: true, upload: [nameA, nameB] });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("a local copy that fails its sha256 uploads NOTHING (checked before any upload)", async () => {
    const storage = mockStorage([]);
    await expect(
      uploadTrainingAssets({ photos, readPhoto: (n) => (n === nameB ? bytesOf("tampered") : files[n]!), storage, dryRun: false }),
    ).rejects.toThrow(/does not match its manifest sha256/);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.list).not.toHaveBeenCalled();
  });
});
