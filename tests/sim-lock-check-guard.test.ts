/**
 * Scheduling Phase 1 — the guard of scripts/sim-0270-0271-lock-check.mjs (CC's chunk F ruling (d)).
 *
 * The script is NEVER run here (it needs the sim and CC runs it). What is proven: it refuses before it imports a
 * database client or opens a connection — with no URL, with a URL naming the PROD project, and with any URL that
 * does not name the SIM project — and its sim ref is the one lib/sim-isolation-shared.ts names. Each refusal is
 * exit code 2 with a plain message; no `pg` is needed to reach it.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIM_PROJECT_REF } from "@/lib/sim-isolation-shared";

const SCRIPT = "scripts/sim-0270-0271-lock-check.mjs";
const source = readFileSync(SCRIPT, "utf8");

function run(url: string | undefined) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.SIM_DATABASE_URL;
  if (url !== undefined) env.SIM_DATABASE_URL = url;
  return spawnSync(process.execPath, [SCRIPT], { env, encoding: "utf8", timeout: 30_000 });
}

describe("the sim lock check refuses anything that is not the sim", () => {
  it("no SIM_DATABASE_URL → exit 2", () => {
    const r = run(undefined);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("SIM_DATABASE_URL is not set");
  });

  it("a URL naming the PROD project → exit 2, even if it also names the sim", () => {
    for (const url of [
      "postgres://postgres.bgcvurheqzylyfehqgzh:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
      `postgres://postgres:x@db.bgcvurheqzylyfehqgzh.supabase.co:5432/postgres?note=${SIM_PROJECT_REF}`,
    ]) {
      const r = run(url);
      expect(r.status, url).toBe(2);
      expect(r.stderr).toContain("names the PROD project");
    }
  });

  it("any other URL that does not name the SIM project → exit 2", () => {
    for (const url of ["postgres://postgres:x@localhost:5432/postgres", "postgres://postgres:x@db.someotherproject.supabase.co:5432/postgres"]) {
      const r = run(url);
      expect(r.status, url).toBe(2);
      expect(r.stderr).toContain("does not name the SIM project");
    }
  });

  it("the script's sim ref is lib/sim-isolation-shared's; the guard runs before the pg import; nothing is deleted", () => {
    expect(source).toContain(`const SIM_PROJECT = "${SIM_PROJECT_REF}";`);
    const guard = source.indexOf("if (!URL.includes(SIM_PROJECT))");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(source.indexOf('await import("pg")'));
    expect(source.indexOf("new pg.Client")).toBeGreaterThan(guard);
    expect(source).not.toMatch(/\bdelete\s+from\b|\btruncate\b/i);
  });
});
