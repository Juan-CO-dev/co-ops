/**
 * Unit spine — the vendored co-scenes bundle (vendor/co-scenes/dist/).
 *
 * Every file the asset manifest names is present and matches its sha256; the
 * training entry the app imports exists and exports the two functions it
 * calls; and the version is pinned. A hand-edited or half-copied bundle fails
 * here. Re-vendor with scripts/vendor-co-scenes.ts.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CO_SCENES_TRAINING_URL } from "@/lib/training/co-scenes-shared";

const DIR = path.join("vendor", "co-scenes", "dist");
const manifest = JSON.parse(readFileSync(path.join(DIR, "asset-manifest.json"), "utf8")) as {
  entries: { training: string; data?: string };
  files: Record<string, string>;
  photos?: Record<string, string>;
};

describe("vendored co-scenes bundle", () => {
  it("every manifest file is present with its sha256", () => {
    const files = Object.entries(manifest.files);
    expect(files.length).toBeGreaterThan(0);
    for (const [rel, sha] of files) {
      const got = createHash("sha256").update(readFileSync(path.join(DIR, rel))).digest("hex");
      expect(got, rel).toBe(sha);
    }
  });

  it("the training entry is in the manifest and is what the app loads", () => {
    expect(manifest.files[manifest.entries.training]).toBeTruthy();
    expect(CO_SCENES_TRAINING_URL).toBe(`/api/training/co-scenes/${manifest.entries.training}`);
    const src = readFileSync(path.join(DIR, manifest.entries.training), "utf8");
    expect(src).toMatch(/as defineTrainingElement\b/);
    expect(src).toMatch(/as trainingSceneFactory\b/);
  });

  it("the version is pinned", () => {
    const version = readFileSync(path.join("vendor", "co-scenes", "VERSION"), "utf8");
    expect(version).toMatch(/^co-scenes [0-9a-f]{40} \(/);
    expect(version).toContain(manifest.entries.training);
    expect(existsSync(path.join(DIR, manifest.entries.training))).toBe(true);
  });
});

describe("the real-photo scene data (round 3)", () => {
  const dataName = manifest.entries.data!;
  const data = JSON.parse(readFileSync(path.join(DIR, dataName), "utf8")) as {
    steps: { key: string; ingredient: string | null; action: string }[];
    assets: { asset_id: string; sha256: string; url: string }[];
    inventory: string[];
  };

  it("the data file is a committed, hash-checked manifest file", () => {
    expect(manifest.files[dataName]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("every photo the scene uses is a manifest photo with the same sha256 (and nothing else is)", () => {
    const photos = manifest.photos ?? {};
    const used = data.assets.map((a) => {
      const name = a.url.replace(/^\.\/photos\//, "");
      expect(photos[name], a.asset_id).toBe(a.sha256);
      return name;
    });
    expect(used.sort()).toEqual(Object.keys(photos).sort());
  });

  it("the scene's steps are CO-OPS's steps: same keys, same order, same card lines", async () => {
    const { buildDefForSlug } = await import("@/lib/training/build-card-shared");
    const { buildCardForSlug } = await import("@/lib/training/build-cards");
    const def = buildDefForSlug("crunchy-boi")!;
    expect(data.steps.map((s) => s.key)).toEqual(def.steps.map((s) => s.key));
    // The scene's HUD shows its own action text; the step list must say the same thing.
    expect(def.steps.map((s) => s.action.en)).toEqual(data.steps.map((s) => s.action));
    const lines = buildCardForSlug("crunchy-boi")!.lines.map((l) => l.ingredient);
    expect(data.steps.filter((s) => s.ingredient).map((s) => s.ingredient).sort()).toEqual([...lines].sort());
  });
});
