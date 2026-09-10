/**
 * Unit spine — the PostgREST roles hold COLUMN grants on public.users (0198, LRA-001 + LRA-214).
 *
 * Two P1s found live by the Launch-Readiness Audit's perimeter inspection (2026-09-10): with the default
 * table ACL, any GM token could SELECT pin_hash/password_hash for every account, and any staff token could
 * PATCH its own `role` to owner (users_update_self checks only `id`, there is no trigger, and
 * current_user_role_level() reads the table). 0198 revokes the table grants from anon/authenticated and
 * grants back exactly what user-context code needs. Source assertions over the LATEST migration that touches
 * users grants plus the two code sites the grant shape depends on — so a later "helpful" re-grant, a new
 * user-context hash read, or a widened self-update route cannot land silently.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATIONS = "supabase/migrations";
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const CREDENTIAL_COLUMNS = ["pin_hash", "password_hash", "locked_until", "failed_login_count"];
const SELF_EDITABLE = ["language", "profile_blurb"];

/** The last migration (lexical = lineage order) that grants or revokes anything on public.users. */
const latest = (() => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const touching = files.filter((f) => /\b(grant|revoke)\b[^;]*\bon\s+table\s+public\.users\b/i.test(read(`${MIGRATIONS}/${f}`)));
  expect(touching.length).toBeGreaterThan(0);
  const file = touching[touching.length - 1]!;
  return { file, body: read(`${MIGRATIONS}/${file}`) };
})();

const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");

describe("public.users column grants (0198)", () => {
  it("is defined last by 0198 or later", () => {
    expect(latest.file >= "0198").toBe(true);
  });

  it("revokes the table grants from BOTH PostgREST roles", () => {
    const sql = stripComments(latest.body);
    for (const role of ["anon", "authenticated"]) {
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+privileges\\s+on\\s+table\\s+public\\.users\\s+from\\s+${role}\\s*;`, "i"));
    }
  });

  it("grants SELECT to authenticated only on non-credential columns, and nothing to anon", () => {
    const sql = stripComments(latest.body);
    const grants = [...sql.matchAll(/grant\s+(select|update|insert|delete|references|all)\s*(?:\(([^)]*)\))?\s*on\s+table\s+public\.users\s+to\s+(\w+)/gi)];
    expect(grants.length).toBeGreaterThan(0);
    for (const [, privilege, columns, grantee] of grants) {
      expect(grantee!.toLowerCase(), "anon must receive no grant").toBe("authenticated");
      expect(["select", "update"], `privilege ${privilege}`).toContain(privilege!.toLowerCase());
      expect(columns, `${privilege} must be column-scoped`).toBeTruthy();
      const list = columns!.split(",").map((c) => c.trim()).filter(Boolean);
      for (const credential of CREDENTIAL_COLUMNS) expect(list, `${privilege} must not include ${credential}`).not.toContain(credential);
      if (privilege!.toLowerCase() === "update") expect(list.sort()).toEqual([...SELF_EDITABLE].sort());
    }
  });

  it("guards its own result inside the migration (a drifted apply refuses)", () => {
    expect(latest.body).toMatch(/raise exception '0198: unexpected users grant\(s\)/);
  });

  it("the confirm-attestation PIN read runs on the service-role client, never the authed one", () => {
    const src = read("lib/checklists.ts");
    const site = src.match(/await\s+(\w+(?:\(\))?)\s*\n\s*\.from\("users"\)\s*\n\s*\.select\("id, pin_hash"\)/);
    expect(site, "PIN attestation read must exist").not.toBeNull();
    expect(site![1]).toBe("getServiceRoleClient()");
  });

  it("no user-context client selects a credential column from users", () => {
    // Files that construct an authed client and read users: every selected column list must avoid the credential set.
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === "node_modules" ? [] : walk(`${dir}/${e.name}`)) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);
    const offenders: string[] = [];
    for (const file of [...walk("lib"), ...walk("app")]) {
      const src = read(file);
      if (!src.includes("createAuthedClient")) continue;
      // Capture the client expression each chain starts from; a service-role chain may read credentials.
      for (const m of src.matchAll(/await\s+([\w.()]+)\s*\n?\s*\.from\("users"\)\s*\n?\s*\.select\("([^"]*)"\)/g)) {
        if (m[1] === "getServiceRoleClient()") continue;
        const cols = m[2]!.split(",").map((c) => c.trim());
        if (cols.some((c) => CREDENTIAL_COLUMNS.includes(c) || c === "*")) offenders.push(`${file}: ${m[1]} → ${m[2]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the self-update routes write only the self-editable columns", () => {
    for (const route of ["app/api/users/me/language/route.ts", "app/api/users/me/profile-blurb/route.ts"]) {
      const src = read(route);
      const updates = [...src.matchAll(/\.from\("users"\)\s*\n?\s*\.update\(\{([^}]*)\}/g)];
      expect(updates.length, `${route} must update users`).toBeGreaterThan(0);
      for (const [, body] of updates) {
        const keys = body!.split(",").map((kv) => kv.split(":")[0]!.trim()).filter(Boolean);
        for (const key of keys) expect(SELF_EDITABLE, `${route} writes ${key}`).toContain(key);
      }
    }
  });
});
