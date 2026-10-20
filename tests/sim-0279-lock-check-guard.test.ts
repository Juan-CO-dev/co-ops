/**
 * The guard and the shape of scripts/sim-0279-lock-check.mjs (Astra's review of c649ed52: the lock order and Add user vs a stale actor).
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

const SCRIPT = "scripts/sim-0279-lock-check.mjs";
const source = readFileSync(SCRIPT, "utf8");
const box = mkdtempSync(join(tmpdir(), "simlock0279-"));
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

describe("sim-0279-lock-check: the guard", () => {
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

describe("sim-0279-lock-check: what it proves (static pins; the run is CC's, on the sim)", () => {
  it("(X,Y) and (Y,X) at the same time, both ways round: no deadlock, one passes and one is refused by name; the held case waits", () => {
    expect(source).toContain("select public.user_admin_lock($1::uuid, $2::uuid) as r");
    expect(source).toContain('r.code === "40P01"');
    expect(source).toContain("check(deadlocks === 0");
    expect(source).toContain("B's user_admin_lock(Y, X) WAITS on a lock");
  });
  it("Astra BC-030/042: each racing session rolls back as soon as ITS OWN statement settles (never after Promise.all)", () => {
    expect(source).toContain('const settleThenRollback = (c, sql, params) => race(c, sql, params).then(async (r) => { await c.query("rollback")');
    const loop = source.slice(source.indexOf("for (let i = 0; i < ROUNDS; i++)"), source.indexOf("check(deadlocks === 0"));
    expect(loop).toContain("Promise.all([settleThenRollback(first[0]");
    expect(loop).toContain("settleThenRollback(second[0]");
    expect(loop).not.toMatch(/\.query\("rollback"\)/);
  });
  it("Add user vs a stale actor: demoted and deactivated inside a held transaction, the create waits, then is refused; nothing inserted", () => {
    expect(source).toContain("public.admin_user_create(");
    expect(source).toContain("admin_user_set_role($1::uuid, $2::uuid, 'employee')");
    expect(source).toContain("admin_user_set_active($1::uuid, $2::uuid, false)");
    expect(source).toContain("nothing was inserted");
  });
  it("never deletes; restores the actor and prints the fixture", () => {
    expect(source).not.toMatch(/delete\s+from/i);
    expect(source).not.toMatch(/truncate/i);
    expect(source).toContain("restore: G is back to");
    expect(source).toContain("fixture: M ");
  });
});
