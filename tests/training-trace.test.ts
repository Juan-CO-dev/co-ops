import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const script = path.resolve("scripts/check-training-trace.mjs");
const assets = ["bundle.js", "chunks/shared.js", "data.json"];

function fixture(omitted?: string, extra: string[] = []) {
  const root = mkdtempSync(path.join(os.tmpdir(), "training-trace-"));
  roots.push(root);
  const dist = path.join(root, "vendor/co-scenes/dist");
  const trace = path.join(root, ".next/server/app/api/training/co-scenes/[...path]/route.js.nft.json");
  mkdirSync(path.join(dist, "chunks"), { recursive: true });
  mkdirSync(path.dirname(trace), { recursive: true });
  writeFileSync(path.join(dist, "asset-manifest.json"), JSON.stringify({ files: Object.fromEntries(assets.map((name) => [name, "hash"])) }));
  for (const name of assets) writeFileSync(path.join(dist, name), "fixture");
  const files = ["asset-manifest.json", ...assets].filter((name) => name !== omitted)
    .map((name) => path.relative(path.dirname(trace), path.join(dist, name)));
  files.push(...extra.map((name) => path.relative(path.dirname(trace), path.join(root, name))));
  writeFileSync(trace, JSON.stringify({ version: 1, files }));
  return { root, trace };
}

function run(root: string) {
  return spawnSync(process.execPath, [script, root], { encoding: "utf8" });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("training deployment trace gate", () => {
  it("passes only when the manifest and every dist asset are traced", () => {
    const result = run(fixture().root);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("3 manifest assets");
  });

  it.each(["asset-manifest.json", ...assets])("fails if %s is omitted even when other dist files remain", (missing) => {
    const result = run(fixture(missing).root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Missing traced asset: vendor/co-scenes/dist/${missing}`);
  });

  it.each(["photo.png", "video.mp4", "poster.jpg"])("refuses ignored local media %s", (name) => {
    const result = run(fixture(undefined, [`vendor/co-scenes/photos/${name}`]).root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Ignored media traced: vendor/co-scenes/photos/${name}`);
  });

  it("fails rather than skipping when no build trace exists", () => {
    const { root, trace } = fixture();
    rmSync(trace);
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Training trace check failed:");
  });
});
