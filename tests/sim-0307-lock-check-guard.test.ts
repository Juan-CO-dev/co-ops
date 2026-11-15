/**
 * The guard and the shape of scripts/sim-0307-lock-check.mjs (audit W07, review round 1: the two-session proof that
 * the reset-link issuer and the link consumers QUEUE with the retirers). The script is NEVER run against a database
 * here (it needs the sim and CC runs it). As in tests/sim-0279-lock-check-guard.test.ts, a COPY of the script runs
 * beside a FAKE `pg` that reports when it is loaded and exits 97 instead of connecting: a refusal must exit 2 with no
 * client loaded; an accepted sim URL must reach the connect with the checked config.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { emailConfirmConsumeCall, passwordResetConsumeCall, passwordResetIssueCall } from "@/lib/auth-lockout-shared";
import { SIM_PROJECT_REF } from "@/lib/sim-isolation-shared";

const SCRIPT = "scripts/sim-0307-lock-check.mjs";
const source = readFileSync(SCRIPT, "utf8");
const box = mkdtempSync(join(tmpdir(), "simlock0307-"));
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

describe("sim-0307-lock-check: the guard", () => {
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

describe("sim-0307-lock-check: what it proves, and that it cannot change an account (static pins; the run is CC's, on the sim)", () => {
  /** The named arguments a statement in the script passes, in order. */
  const namedArgs = (fn: string) => {
    const at = source.indexOf(`select public.${fn}(`);
    expect(at, fn).toBeGreaterThan(-1);
    return [...source.slice(at, source.indexOf(") as r", at)).matchAll(/\b(p_[a-z_]+) =>/g)].map((m) => m[1]!);
  };

  it("calls the three functions with exactly the arguments the app sends", () => {
    expect(namedArgs("auth_password_reset_issue")).toEqual(Object.keys(passwordResetIssueCall({ userId: "u", email: "e", seenPasswordHash: null, tokenHash: "t", expiresAt: "x" }).args));
    expect(namedArgs("auth_password_reset_consume")).toEqual(Object.keys(passwordResetConsumeCall({ tokenHash: "t", passwordHash: "p" }).args));
    expect(namedArgs("auth_email_confirm_consume")).toEqual(Object.keys(emailConfirmConsumeCall({ tokenHash: "t", passwordHash: "p" }).args));
    expect(source).toContain('const GATE = "select public.user_admin_lock($1::uuid, $2::uuid) as r";');
  });

  it("a retirer's gate held → the issuer and BOTH consumers wait on the per-person advisory lock, then end in a named refusal", () => {
    expect(source).toContain('await waitsBehindGate(1, "auth_password_reset_issue", ISSUE, [T, NOBODYS_EMAIL, null, sha()], "email_changed");');
    expect(source).toContain('await waitsBehindGate(2, "auth_password_reset_consume", RESET_CONSUME, [resetToken, DUMMY_HASH], "token_consumed");');
    expect(source).toContain('await waitsBehindGate(3, "auth_email_confirm_consume", CONFIRM_CONSUME, [confirmToken, DUMMY_HASH], "token_consumed");');
    const helper = source.slice(source.indexOf("async function waitsBehindGate("), source.indexOf("// ── 1–3."));
    expect(helper).toContain("const held = await race(a, GATE, [M, T]);");
    expect(helper).toContain('check(waits.includes("advisory")');
    expect(helper).toContain("!isLockError(rB)");
    // B is asked only AFTER A holds, and A lets go only after B was seen waiting
    expect(helper.indexOf("race(a, GATE")).toBeLessThan(helper.indexOf("race(b, sql, params)"));
    expect(helper.indexOf("await blockedOn(pidB)")).toBeLessThan(helper.indexOf('await a.query("rollback")'));
  });

  it("the other way round: the issuer held → the gate waits; and gate ‖ issuer never deadlocks", () => {
    const four = source.slice(source.indexOf("// ── 4."), source.indexOf("// ── 5."));
    expect(four).toContain("const held = await race(a, ISSUE, [T, seen.email, seen.password_hash, issuedToken]);");
    expect(four).toContain("const pB = race(b, GATE, [M, T]);");
    expect(four).toContain('check(waits.includes("advisory")');
    expect(four).toContain("A's rolled-back link does not exist");
    const five = source.slice(source.indexOf("// ── 5."), source.indexOf("} catch (e) {"));
    expect(five).toContain('r.code === "40P01"');
    expect(five).toContain("check(deadlocks === 0");
    expect(five).toContain("Promise.all([settleThenRollback(first[0], first[1], first[2]), settleThenRollback(second[0], second[1], second[2])])");
  });

  it("it can not change an account: no transaction is ever committed, B's calls are refusals by construction, the fixture links are dead from birth", () => {
    expect(source).not.toMatch(/query\(\s*["'`]commit/i);
    expect(source).not.toMatch(/\bcommit\b\s*["'`]\)/i);
    // every statement A or B runs is inside begin(); the watcher's only writes are the two dead links
    const writes = [...source.matchAll(/\b(insert into|update|delete from) public\.([a-z_]+)/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(writes).toEqual(["insert into password_resets", "insert into email_verifications"]);
    expect(source.match(/values \(\$1::uuid, \$2, now\(\), now\(\)\) returning id/g)).toHaveLength(2); // expires_at = consumed_at = now()
    expect(source).toContain('const NOBODYS_EMAIL = "sim-0307-lock-check@invalid.example";');
    // the hash it reads for check 4 is never printed
    for (const line of source.split("\n").filter((l) => /console\.|check\(/.test(l))) expect(line).not.toMatch(/password_hash|seen\./);
  });
});
