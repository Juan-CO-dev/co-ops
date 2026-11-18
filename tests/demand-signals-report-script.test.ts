// Item 4 PR 1: the replay report script is read-only; with no env it reads nothing.
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { main, MAX_RANGE_DAYS, parseArgs } from "../scripts/demand-replay-report";

afterEach(() => vi.unstubAllEnvs());

it("args: a decision range and an .md file are required; the range is bounded; anything else refuses", () => {
  expect(parseArgs(["--from=2026-09-01", "--to=2026-09-30", "--out=r.md"])).toEqual({ from: "2026-09-01", to: "2026-09-30", out: "r.md", surfaces: ["labor", "pars", "prep"] });
  expect(parseArgs(["--from=2026-09-01", "--to=2026-09-30", "--out=r.md", "--surfaces=labor"])?.surfaces).toEqual(["labor"]);
  expect(MAX_RANGE_DAYS).toBe(120);
  for (const bad of [
    [], ["--from=2026-09-01", "--to=2026-09-30"], ["--from=2026-09-30", "--to=2026-09-01", "--out=r.md"], ["--from=2026-02-30", "--to=2026-03-01", "--out=r.md"],
    ["--from=2026-01-01", "--to=2026-06-01", "--out=r.md"], ["--from=2026-09-01", "--to=2026-09-30", "--out=r.txt"],
    ["--from=2026-09-01", "--to=2026-09-30", "--out=r.md", "--apply"], ["--from=2026-09-01", "--to=2026-09-30", "--out=r.md", "--surfaces=labor,weather"],
  ]) expect(parseArgs(bad)).toBeNull();
});
it("without env it exits 2 before any client exists", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await main(["--from=2026-09-01", "--to=2026-09-30", "--out=r.md"])).toBe(2);
  expect(await main(["--apply"])).toBe(2);
  err.mockRestore();
});
it("writes one local file and nothing else: no table write, no demand writer, no holdout claim, no outside call", () => {
  const src = readFileSync("scripts/demand-replay-report.ts", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|demand_holdout_claim|demand_forecast_record|\bfetch\(/);
  expect(src.match(/writeFileSync\(/g)!.length).toBe(1);
  expect([...src.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1])).toEqual(["locations"]);
});
