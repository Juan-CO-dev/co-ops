/**
 * Unit spine — the vendored co-scenes bundle (public/vendor/co-scenes/).
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

const DIR = path.join("public", "vendor", "co-scenes");
const manifest = JSON.parse(readFileSync(path.join(DIR, "asset-manifest.json"), "utf8")) as {
  entries: { training: string };
  files: Record<string, string>;
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
    expect(CO_SCENES_TRAINING_URL).toBe(`/vendor/co-scenes/${manifest.entries.training}`);
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
