/**
 * The guard and the shape of scripts/sim-0278-lock-check.mjs (Astra's review of 011eda11, NIT: the two-session proof).
 * The script is NEVER run against a database here (it needs the sim and CC runs it). As in tests/sim-lock-check-guard.test.ts,
 * a COPY of the script runs beside a FAKE `pg` that reports when it is loaded and exits 97 instead of connecting:
 * a refusal must exit 2 with no client loaded; an accepted sim URL must reach the connect with the checked config.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SIM_PROJECT_REF } from "@/lib/sim-isolation-shared";

const SCRIPT = "scripts/sim-0278-lock-check.mjs";
const source = readFileSync(SCRIPT, "utf8");
const box = mkdtempSync(join(tmpdir(), "simlock0278-"));
copyFileSync(SCRIPT, join(box, "lock-check.mjs"));
copyFileSync("scripts/sim-0270-0271-lock-check-lib.mjs", join(box, "sim-0270-0271-lock-check-lib.mjs"));
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

describe("sim-0278-lock-check: the guard", () => {
  it("refuses no URL, a PROD URL and a foreign host — exit 2, no client loaded", () => {
    for (const [url, msg] of [
      [undefined, "SIM_DATABASE_URL is not set"],
      ["postgres://postgres:x@db.bgcvurheqzylyfehqgzh.supabase.co:5432/postgres", "names the PROD project"],
      [`postgres://postgres:${SIM_PROJECT_REF}@db.someotherproject.supabase.co:5432/postgres`, "refusing:"],
    ] as const) {
      const r = run(url);
      expect(r.status, `${url}\n${r.stderr}`).toBe(2);
      expect(r.stderr).toContain(msg);
      expect(r.stderr).not.toContain("FAKE_PG_LOADED");
    }
  });
  it("accepts the sim direct host and hands pg the checked config, never the raw string", () => {
    const r = run(`postgres://postgres:pw@db.${SIM_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`);
    expect(r.status, r.stderr).toBe(97);
    expect(r.stderr).toContain(`"host":"db.${SIM_PROJECT_REF}.supabase.co"`);
    expect(r.stderr).not.toContain("connectionString");
  });
});

describe("sim-0278-lock-check: what it proves (static pins; the run is CC's, on the sim)", () => {
  it("both 0278 writers race, the loser waits on the ADVISORY lock, and is refused person_settings_moved", () => {
    expect(source).toContain("public.save_schedule_person_settings(");
    expect(source).toContain("public.merge_schedule_person_positions(");
    expect(source).toContain('waits.includes("advisory")');
    expect(source.match(/person_settings_moved\/\.test\(rB\.error\)/g)?.length).toBe(2);
  });
  it("append-only: never deletes or updates a settings row; restores the pre-run values and prints the fixture ids", () => {
    expect(source).not.toMatch(/\bdelete\s+from\b/i);
    expect(source).not.toMatch(/\bupdate\s+public\.schedule_person_settings\b/i);
    expect(source).not.toMatch(/\btruncate\b/i);
    expect(source).toContain("fixture rows (schedule_person_settings");
    expect(source).toContain("restore:");
  });
});
