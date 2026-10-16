/**
 * Scheduling Phase 1 — the guard and the cleanup of scripts/sim-0270-0271-lock-check.mjs (CC's chunk F ruling (d);
 * Astra's chunk G review #2 and #3, the final fix round).
 *
 * The script is NEVER run against a database here (it needs the sim and CC runs it). Every spawn below runs a COPY
 * of the script beside a FAKE `pg` that reports, on stderr, when it is loaded, when a client is built (with its
 * config) and when a connection is attempted — and then exits 97 instead of connecting. So:
 *   - a refusal must exit 2 with NO "FAKE_PG_LOADED" line: no client loaded, nothing connected;
 *   - an accepted sim URL must reach "FAKE_PG_CONNECT" with the explicit, checked config (host, user, port) — the
 *     raw connection string is never handed to the client.
 * The guard PARSES the URL (#2, BC-060): a sim ref in the password, application_name or a path proves nothing.
 * The cleanup (#3, BC-033) counts a failed retirement, re-queries, and names what is still live.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SIM_PROJECT_REF } from "@/lib/sim-isolation-shared";
// @ts-expect-error — a plain .mjs script module, no types
import { retireLockFixture, simDatabaseTarget, SIM_PROJECT, SIM_POOLER_HOSTS } from "../scripts/sim-0270-0271-lock-check-lib.mjs";

const SCRIPT = "scripts/sim-0270-0271-lock-check.mjs";
const LIB = "scripts/sim-0270-0271-lock-check-lib.mjs";
const source = readFileSync(SCRIPT, "utf8");
const SIM = SIM_PROJECT_REF;
const POOLER = "aws-0-us-east-1.pooler.supabase.com";

// A sandbox: the script + its lib + a fake `pg` that never connects.
const box = mkdtempSync(join(tmpdir(), "simlock-"));
copyFileSync(SCRIPT, join(box, "lock-check.mjs"));
copyFileSync(LIB, join(box, "sim-0270-0271-lock-check-lib.mjs"));
mkdirSync(join(box, "node_modules", "pg"), { recursive: true });
writeFileSync(join(box, "node_modules", "pg", "package.json"), JSON.stringify({ name: "pg", type: "module", main: "index.js" }));
writeFileSync(join(box, "node_modules", "pg", "index.js"), [
  'process.stderr.write("FAKE_PG_LOADED\\n");',
  "class Client {",
  '  constructor(config) { process.stderr.write("FAKE_PG_CLIENT " + JSON.stringify(config) + "\\n"); }',
  '  async connect() { process.stderr.write("FAKE_PG_CONNECT\\n"); process.exit(97); }',
  "}",
  "export default { Client };",
].join("\n"));
afterAll(() => rmSync(box, { recursive: true, force: true }));

function run(url: string | undefined) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.SIM_DATABASE_URL;
  delete env.NODE_OPTIONS;
  if (url !== undefined) env.SIM_DATABASE_URL = url;
  return spawnSync(process.execPath, [join(box, "lock-check.mjs")], { env, encoding: "utf8", timeout: 30_000, cwd: box });
}
function expectRefused(url: string | undefined, message: string) {
  const r = run(url);
  expect(r.status, `${url}\n${r.stderr}`).toBe(2);
  expect(r.stderr).toContain(message);
  expect(r.stderr, "no client may be loaded on a refusal").not.toContain("FAKE_PG_LOADED");
  expect(r.stderr).not.toContain("FAKE_PG_CONNECT");
}

describe("the guard refuses anything that is not the sim — exit 2, no client loaded, nothing connected", () => {
  it("no SIM_DATABASE_URL", () => expectRefused(undefined, "SIM_DATABASE_URL is not set"));

  it("a URL naming the PROD project — including a prod host with the SIM tenant user", () => {
    for (const url of [
      "postgres://postgres.bgcvurheqzylyfehqgzh:x@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
      `postgres://postgres:x@db.bgcvurheqzylyfehqgzh.supabase.co:5432/postgres?note=${SIM}`,
      `postgres://postgres.${SIM}:x@db.bgcvurheqzylyfehqgzh.supabase.co:5432/postgres`,
    ]) expectRefused(url, "names the PROD project");
  });

  it("the sim ref in the PASSWORD, in application_name, in a PATH, or as the user on a foreign host", () => {
    for (const url of [
      `postgres://postgres:${SIM}@db.someotherproject.supabase.co:5432/postgres`,
      `postgres://postgres:x@evil.example.com:5432/postgres?application_name=${SIM}`,
      `postgres://postgres:x@evil.example.com:5432/${SIM}`,
      `postgres://postgres:x@db.someotherproject.supabase.co:5432/postgres/${SIM}`,
      `postgres://postgres.${SIM}:x@evil.example.com:5432/postgres`,
      `postgres://postgres.${SIM}:x@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
      "postgres://postgres:x@localhost:5432/postgres",
    ]) expectRefused(url, "refusing:");
  });

  it("multi-host strings", () => {
    for (const url of [
      `postgres://postgres:x@db.${SIM}.supabase.co:5432,evil.example.com:5432/postgres`,
      `postgres://postgres:x@evil.example.com,db.${SIM}.supabase.co/postgres`,
    ]) expectRefused(url, "refusing:");
  });

  it("options / host / hostaddr (and any other) query overrides on the sim host", () => {
    for (const q of ["options=-c%20search_path%3Devil", "host=evil.example.com", "hostaddr=10.0.0.1", `application_name=${SIM}`]) {
      expectRefused(`postgres://postgres:x@db.${SIM}.supabase.co:5432/postgres?${q}`, "query override");
    }
  });

  it("the right host with the wrong user, port, database or protocol", () => {
    for (const url of [
      `postgres://postgres:x@${POOLER}:5432/postgres`, // the pooler needs the sim tenant user
      `postgres://postgres.${SIM}:x@${POOLER}:6543/postgres`, // transaction mode breaks the per-session pid checks
      `postgres://someone:x@db.${SIM}.supabase.co:5432/postgres`,
      `postgres://postgres:x@db.${SIM}.supabase.co:5432/other`,
      `mysql://postgres:x@db.${SIM}.supabase.co:5432/postgres`,
    ]) expectRefused(url, "refusing:");
  });
});

describe("the guard accepts the sim and hands the client ONLY the checked destination", () => {
  it("the direct host as postgres, and each approved pooler host as the sim tenant — reaching connect with that config", () => {
    const cases = [
      { url: `postgres://postgres:pw@db.${SIM}.supabase.co:5432/postgres`, host: `db.${SIM}.supabase.co`, user: "postgres" },
      ...SIM_POOLER_HOSTS.map((h: string) => ({ url: `postgresql://postgres.${SIM}:pw@${h}:5432/postgres?sslmode=require`, host: h, user: `postgres.${SIM}` })),
    ];
    for (const c of cases) {
      const r = run(c.url);
      expect(r.status, r.stderr).toBe(97);
      expect(r.stderr).toContain("FAKE_PG_CONNECT");
      const line = r.stderr.split("\n").find((l) => l.startsWith("FAKE_PG_CLIENT "))!;
      const config = JSON.parse(line.slice("FAKE_PG_CLIENT ".length));
      expect(config).toMatchObject({ host: c.host, user: c.user, port: 5432, database: "postgres" });
      expect(config).not.toHaveProperty("connectionString");
    }
  });

  it("pure: the lib's verdicts match (and the sim ref is lib/sim-isolation-shared's)", () => {
    expect(SIM_PROJECT).toBe(SIM_PROJECT_REF);
    expect(simDatabaseTarget(`postgres://postgres:pw@db.${SIM}.supabase.co/postgres`)).toMatchObject({ ok: true, via: "direct" });
    expect(simDatabaseTarget(`postgres://postgres:${SIM}@db.x.supabase.co:5432/postgres`).ok).toBe(false);
  });
});

describe("the script's order and its append-only cleanup", () => {
  it("the guard runs before the pg import, the client gets the checked config, nothing is deleted", () => {
    const guard = source.indexOf("simDatabaseTarget(process.env.SIM_DATABASE_URL)");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(source.indexOf('await import("pg")'));
    expect(source).not.toMatch(/\.includes\(SIM_PROJECT\)/);
    expect(source).not.toMatch(/connectionString/);
    expect(source).toMatch(/new pg\.Client\(target\.config\)/);
    expect(source + readFileSync(LIB, "utf8")).not.toMatch(/\bdelete\s+from\b|\btruncate\b/i);
  });

  it("a failed retirement counts as a failure, and the re-query names what is still live", async () => {
    const days = ["d1", "d2"], criterion = "c1";
    const w = {
      async query(sql: string) {
        if (sql.startsWith("update public.pm_reports")) throw new Error("permission denied");
        if (sql.startsWith("update public.pm_criteria")) return { rows: [], rowCount: 1 };
        if (sql.includes("from public.pm_reports")) return { rows: [{ id: "d1" }, { id: "d2" }] };
        if (sql.includes("from public.pm_criteria")) return { rows: [] };
        throw new Error(`unexpected ${sql}`);
      },
    };
    const r = await retireLockFixture(w, { days, criterion });
    expect(r.failures).toBeGreaterThan(0);
    expect(r.errors.join(" ")).toContain("cleanup (days): permission denied");
    expect(r.stillLive).toEqual({ days: ["d1", "d2"], criterion: null });
  });

  it("an update that 'succeeds' but leaves a row live is still a failure; a clean retirement is not", async () => {
    const live = { async query(sql: string) { return sql.includes("from public.pm_criteria") ? { rows: [{ id: "c1" }] } : { rows: [] }; } };
    expect(await retireLockFixture(live, { days: ["d1"], criterion: "c1" })).toMatchObject({ failures: 1, stillLive: { days: [], criterion: "c1" } });
    const clean = { async query() { return { rows: [] }; } };
    expect(await retireLockFixture(clean, { days: ["d1"], criterion: "c1" })).toEqual({ failures: 0, errors: [], stillLive: { days: [], criterion: null } });
  });

  it("the script adds cleanup failures to the run's failures (exit 1) and prints the live ids, not 'retired'", () => {
    expect(source).toMatch(/failures \+= cleanup\.failures/);
    expect(source).toContain("still LIVE");
    expect(source).not.toContain("fixture (retired)");
    expect(source.indexOf("if (failures > 0)")).toBeLessThan(source.indexOf("if (refused)"));
  });

  it("the header says retired 2099 rows REMAIN on sim and how to recognise them (CC ruling 3)", () => {
    expect(source).toMatch(/REMAIN on the sim/);
    expect(source).toMatch(/2099/);
  });
});
