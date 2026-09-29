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
    assets: { asset_id: string; sha256: string; url: string; edge?: unknown }[];
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

  // 2026-09-29 prod regression: the data file carried no `edge`, the vendored loader checks every photo against its
  // DECLARED edge class, so every photo "broke the asset law", the element failed in ~0.2 s on every device, and the
  // page showed only the step list. The loader's check is in the vendored chunk; the declaration must be in the data.
  it("every photo declares its asset-law edge class (the vendored loader refuses a photo without one)", () => {
    const chunks = Object.keys(manifest.files).filter((f) => f.endsWith(".js"));
    const loaderChecksEdge = chunks.some((f) => {
      const src = readFileSync(path.join(DIR, f), "utf8");
      return src.includes("breaks the asset law") && /edge:[A-Za-z_$][\w$]*\.edge\b/.test(src);
    });
    expect(loaderChecksEdge, "the vendored loader passes each photo's declared edge to the asset-law check").toBe(true);
    const missing = data.assets.filter((a) => a.edge !== "hard" && a.edge !== "rim" && a.edge !== "soft").map((a) => a.asset_id);
    expect(missing).toEqual([]);
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

describe("the vendored element is the single-Play build (co-scenes v0.2.0-m2)", () => {
  // The browser behaviour (Play advances, any input pauses, reduced motion still steps) is
  // tested in co-scenes; this pins that CO-OPS vendors THAT build and not the retired
  // separate player (m4-web-training-r3's src/web/player.ts, `.btn.play`).
  const entry = readFileSync(path.join(DIR, manifest.entries.training), "utf8");

  it("one Play button, driven by the controller's training pacing", () => {
    expect(entry.match(/class="play"/g)).toHaveLength(1);
    expect(entry).not.toMatch(/class="btn play"/);
    expect(entry).toMatch(/playTraining/);
    expect(entry).toMatch(/aria-pressed/);
    expect(entry).toMatch(/"Reproducir"/);
    // hold = the step's beat capped at 4 s, + 2.5 s reading; reduced motion reads only
    expect(entry).toMatch(/holdMs\(\w+\)\{if\(this\.s\.reducedMotion\|\|!this\.scene\)return 2500/);
    expect(entry).toMatch(/4e3/);
  });

  it("the version pin names co-scenes v0.2.0-m2 + the training-data edge fix (fd6e3b4, parent main 67afe59)", () => {
    // Rebuilt at fd6e3b4 the code files are byte-identical to 67afe59's; only the scene data file changed
    // (each photo's declared edge class). Re-pin to main once the co-scenes branch is merged there.
    expect(readFileSync(path.join("vendor", "co-scenes", "VERSION"), "utf8")).toMatch(
      /^co-scenes fd6e3b4[0-9a-f]{33} \(fix\/training-data-edge\)/,
    );
  });
});
