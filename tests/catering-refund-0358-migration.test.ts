/**
 * Migration 0358 (catering refund roles: GM and AGM join the actor rule) pinned BY NAME. Refund round 2, Part A
 * (Juan 2026-11-25). CC applies sim then prod on Juan's word; nothing here touches a database.
 *
 * Pins the house header and gate line, one transaction, that it is the only 0358, that it re-emits exactly ONE
 * function and touches nothing else, that the new body is 0357's with ONE role list changed, that the privileges are
 * stated again in the file (REVOKE from PUBLIC / anon / authenticated, GRANT to service_role) and asserted in it, that
 * the two body fingerprints written in the file are the real ones, that the SQL rule's roles are the app's
 * REFUND_ROLES (this file owns that tie since 0357's pin was frozen), and runs the offline PGlite proof
 * (scripts/sql-harness-0358.mjs: the REAL 0357, then the REAL 0358).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REFUND_ROLES, canRequestRefund } from "@/lib/catering/refunds-shared";
import { isAllLocationsAccess, lockLocationContext } from "@/lib/locations";
import { ROLES, type RoleCode } from "@/lib/roles";

const NAME = "0358_catering_refund_roles";
const read = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, "utf8").replace(/\r\n/g, "\n");
const sql = read(NAME);
const sql0357 = read("0357_catering_refund_requests");
const strip = (text: string) => text.replace(/--[^\n]*/g, "");
const code = strip(sql);
const list = (text: string) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
/** What Postgres stores as `prosrc`: the text between the function's dollar quotes. */
const body = (text: string) => {
  const m = strip(text).match(/create (?:or replace )?function public\.catering_refund_actor_ok\([^)]*\) returns boolean\nlanguage plpgsql security definer set search_path = pg_catalog, public as \$\$([\s\S]*?)\$\$;/);
  if (!m) throw new Error("catering_refund_actor_ok not found");
  return m[1]!;
};
/** The 0354 convention: md5 of the body with every non-printing character removed. */
const fingerprint = (text: string) => createHash("md5").update(text.replace(/[^\x21-\x7E]+/g, ""), "utf8").digest("hex");
const harness = readFileSync("scripts/sql-harness-0358.mjs", "utf8").replace(/\r\n/g, "\n");

const NEW_LIST = "('moo', 'catering_mgr', 'gm', 'agm')";
const OLD_LIST = "('moo', 'catering_mgr')";

describe("0358 header and shape", () => {
  it("gate header, one transaction, the number explained, Part A only", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe(`-- Migration ${NAME}`);
    expect(lines[1]).toBe("-- AUTHORED 2026-11-26 (refund round 2 Part A, CO CC Fable lead, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.");
    // An APPLIED stamp goes UNDER the gate line, never instead of it; this build may stamp SIM only.
    const stamps = lines.slice(2, 6).filter((l) => /^-- APPLIED /.test(l));
    expect(stamps.every((l) => new RegExp(`^-- APPLIED TO (PROD|SIM) \\d{4}-\\d{2}-\\d{2}( UTC)? \\(schema_migrations version \\d{14}, name '${NAME}'\\)$`).test(l))).toBe(true);
    expect(sql).toMatch(/0358 is claimed for this build in co-ops-wt\/\.mig-claims \(Part A only\)/);
    expect(sql).toMatch(/Parts B1 \/ B2 of that\n--   plan are NOT in this file/);
    expect(sql).toMatch(/Ships DARK like 0357/);
    expect(code.match(/^begin;$/gm)).toHaveLength(1);
    expect(code.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().split("\n").filter((l) => l.trim() && !l.startsWith("--")).pop()).toBe("commit;");
  });

  it("is the ONLY file numbered 0358, and 0357's file still carries its own four-role rule", () => {
    expect(readdirSync("supabase/migrations").filter((f) => f.startsWith("0358_"))).toEqual([`${NAME}.sql`]);
    expect(body(sql0357)).toContain(`if v_role in ${OLD_LIST} and p_shop_id is not null and exists (`);
    expect(sql0357).toContain("-- APPLIED TO PROD 2026-11-25 UTC (schema_migrations version 20261125160656, name '0357_catering_refund_requests')");
  });

  it("re-emits exactly ONE function and touches nothing else", () => {
    expect(code.match(/^create [^\n]*/gm)).toEqual([
      "create or replace function public.catering_refund_actor_ok(p_actor_id uuid, p_shop_id uuid) returns boolean",
    ]);
    // Outside the three dollar-quoted blocks (pre-flight, the function, the assertions) there are five statements.
    const outside = code.replace(/\$\$[\s\S]*?\$\$/g, "$$$$").split("\n").map((l) => l.trim()).filter(Boolean);
    expect(outside).toEqual([
      "begin;",
      "do $$;",
      "create or replace function public.catering_refund_actor_ok(p_actor_id uuid, p_shop_id uuid) returns boolean",
      "language plpgsql security definer set search_path = pg_catalog, public as $$;",
      "revoke all on function public.catering_refund_actor_ok(uuid, uuid) from public, anon, authenticated;",
      "grant execute on function public.catering_refund_actor_ok(uuid, uuid) to service_role;",
      "do $$;",
      "commit;",
    ]);
    // No DDL on anything else and no data statement anywhere, the DO blocks included (they only read and raise).
    for (const banned of [/\balter\b/, /\bdrop\b/, /\btruncate\b/, /\bcreate (table|trigger|policy|index|view|type|role)\b/, /\binsert into\b/, /\bdelete from\b/,
      /^\s*update\s/m, /\bexecute\s+format\b/, /\bexecute\s+'/, /\bset_config\b/, /\bnotify\b/, /\bsecurity invoker\b/, /\bcreate function\b/]) {
      expect(code, String(banned)).not.toMatch(banned);
    }
    expect(code.match(/^\s*(grant|revoke)\b/gm)).toHaveLength(2);
  });
});

describe("the body is 0357's with ONE role list changed", () => {
  const b57 = body(sql0357);
  const b58 = body(sql);

  it("replacing the one list gives 0357's body back, character for character", () => {
    expect(b58.split(NEW_LIST)).toHaveLength(2);
    expect(b57.split(OLD_LIST)).toHaveLength(2);
    expect(b58.replace(NEW_LIST, OLD_LIST)).toBe(b57);
  });

  it("line by line: every line is 0357's except the membership test", () => {
    const l57 = b57.split("\n");
    const l58 = b58.split("\n");
    expect(l58).toHaveLength(l57.length);
    const changed = l58.map((l, i) => [l, l57[i]] as const).filter(([a, b]) => a !== b);
    expect(changed).toEqual([[
      `  if v_role in ${NEW_LIST} and p_shop_id is not null and exists (`,
      `  if v_role in ${OLD_LIST} and p_shop_id is not null and exists (`,
    ]]);
  });

  it("same signature, return type, language, definer and search_path; the first statement is still the FOR SHARE read", () => {
    const head = (text: string) => strip(text).match(/create (?:or replace )?function public\.catering_refund_actor_ok\([\s\S]*?as \$\$/)![0].replace("create or replace function", "create function");
    expect(head(sql)).toBe(head(sql0357));
    expect(head(sql)).toBe("create function public.catering_refund_actor_ok(p_actor_id uuid, p_shop_id uuid) returns boolean\nlanguage plpgsql security definer set search_path = pg_catalog, public as $$");
    const statements = b58.slice(b58.indexOf("\nbegin\n") + 7).split("\n");
    expect(statements[0]).toBe("  select u.role into v_role from public.users u where u.id = p_actor_id and u.active for share;");
    expect(statements[1]).toBe("  if v_role is null then return false; end if;");
  });

  it("the membership branch needs an ACTIVE membership at THAT shop; owner / cgs are the only any-shop roles", () => {
    expect(b58).toMatch(/v_role in \('moo', 'catering_mgr', 'gm', 'agm'\) and p_shop_id is not null and exists \(\s*select 1 from public\.user_locations m where m\.user_id = p_actor_id and m\.location_id = p_shop_id and m\.active\)/);
    expect(b58).toContain("if v_role in ('owner', 'cgs') then return true; end if;");
    expect(b58.trimEnd().endsWith("return false;\nend")).toBe(true);
    expect([...b58.matchAll(/return true/g)]).toHaveLength(2);
  });
});

describe("the SQL rule's roles are the app gate's (the tie 0357's pin handed over)", () => {
  const lists = [...body(sql).matchAll(/v_role in \(([^)]*)\)/g)].map((m) => list(m[1]!));

  it("REFUND_ROLES equals the roles in 0358's body: six, no more", () => {
    expect(lists).toHaveLength(2);
    expect(lists.flat().sort()).toEqual([...REFUND_ROLES].sort());
    expect([...REFUND_ROLES].sort()).toEqual(["agm", "catering_mgr", "cgs", "gm", "moo", "owner"]);
    expect((Object.keys(ROLES) as RoleCode[]).filter(canRequestRefund).sort()).toEqual(lists.flat().sort());
  });

  it("the two homes agree on WHO needs a membership: the SQL's any-shop roles are the app's all-locations roles", () => {
    const [anyShop, memberShop] = lists as [string[], string[]];
    expect(anyShop).toEqual(["owner", "cgs"]);
    expect(memberShop).toEqual(["moo", "catering_mgr", "gm", "agm"]);
    for (const role of REFUND_ROLES) {
      expect([role, isAllLocationsAccess({ role, locations: [] })]).toEqual([role, anyShop.includes(role)]);
      // The app's bind for the same role: no membership = refused unless any-shop; a membership at the shop = allowed.
      expect([role, lockLocationContext({ role, locations: [] }, "shop")]).toEqual([role, anyShop.includes(role)]);
      expect(lockLocationContext({ role, locations: ["shop"] }, "shop")).toBe(true);
      expect([role, lockLocationContext({ role, locations: ["other"] }, "shop")]).toEqual([role, anyShop.includes(role)]);
    }
  });

  it("level 6 is not one thing: prep_mgr and social_media_mgr are in neither list", () => {
    for (const role of ["prep_mgr", "social_media_mgr", "shift_lead", "key_holder", "trainer", "employee"]) {
      expect(lists.flat()).not.toContain(role);
    }
  });
});

describe("privileges are stated again in the file, and asserted in it", () => {
  it("explicit REVOKE from PUBLIC, anon and authenticated; EXECUTE to service_role only", () => {
    expect(code).toContain("revoke all on function public.catering_refund_actor_ok(uuid, uuid) from public, anon, authenticated;");
    expect(code).toContain("grant execute on function public.catering_refund_actor_ok(uuid, uuid) to service_role;");
    expect(code).not.toMatch(/grant [^;]* to (public|anon|authenticated)\b/);
    // The revoke and the grant come after the replace and before the assertions.
    const at = (needle: string) => { const i = code.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    expect(at("create or replace function")).toBeLessThan(at("revoke all on function"));
    expect(at("revoke all on function")).toBeLessThan(at("grant execute on function"));
    expect(at("grant execute on function")).toBeLessThan(at("v_fn pg_proc%rowtype"));
  });

  it("the assertion block checks definer, the pinned search_path, the body, and every role's EXECUTE", () => {
    const assertions = code.slice(code.lastIndexOf("do $$"));
    for (const needle of [
      "if not v_fn.prosecdef then raise exception '0358: catering_refund_actor_ok is not SECURITY DEFINER'",
      "replace(v_fn.proconfig[1], ' ', '') <> 'search_path=pg_catalog,public'",
      "array_length(v_fn.proconfig, 1) <> 1",
      "foreach r in array array['public', 'anon', 'authenticated'] loop",
      "if has_function_privilege(r, f, 'EXECUTE') then raise exception '0358: % may execute % (RPC escape)', r, f;",
      "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
      "if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception '0358: service_role cannot execute %', f;",
      "if public.catering_refund_actor_ok(null, null) is distinct from false then",
    ]) expect(assertions, needle).toContain(needle);
    // 0357's other five functions and its two tables are COMPARED, never re-granted.
    for (const f of ["catering_refund_figures(uuid)", "catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text)", "catering_refund_claim(uuid)",
      "catering_refund_record_snapshot(uuid, timestamptz, bigint, jsonb)", "catering_refund_requests_guard()"]) {
      expect(assertions).toContain(`'public.${f}'::regprocedure`);
      expect(code).not.toContain(`on function public.${f}`);
    }
    expect(code).not.toMatch(/\b(grant|revoke)\b[^;]*\bon table\b/);
    // The UPDATE columns it expects are exactly the ones 0357 granted.
    const granted = strip(sql0357).match(/grant update \(([^)]*)\)\s+on table public\.catering_refund_requests to service_role;/)![1]!.split(",").map((c) => c.trim()).sort().join(",");
    expect(assertions).toContain(`v_cols is distinct from '${granted}'`);
  });

  it("the pre-flight refuses a drifted database by name before anything is replaced", () => {
    const pre = code.slice(code.indexOf("do $$"), code.indexOf("create or replace function"));
    expect(pre).toContain("raise exception '0358: already applied';");
    // (Read from the raw file: the message holds a "--", which the comment stripper above would cut.)
    expect(sql.slice(sql.indexOf("\ndo $$"), sql.indexOf("create or replace function"))).toContain("is not its 0357 definition -- a later definer exists; re-emit from it. Refusing.', v_live;");
    expect(pre).toContain("has more than one overload. Refusing.");
    expect(pre).toContain("is missing (0357 must be applied first)");
    expect(pre).toContain("select md5(regexp_replace(p.prosrc, '[^\\x21-\\x7E]+', '', 'g')) into v_live from pg_proc p");
  });
});

describe("the fingerprints in the file are the real ones", () => {
  const fp57 = fingerprint(body(sql0357));
  const fp58 = fingerprint(body(sql));

  it("0357's body and 0358's body, computed here from the two files", () => {
    expect(fp57).not.toBe(fp58);
    expect(code).toContain(`if v_live is distinct from '${fp57}' then`);
    expect(code).toContain(`if v_live = '${fp58}' then`);
    expect(code).toContain(`if md5(regexp_replace(v_fn.prosrc, '[^\\x21-\\x7E]+', '', 'g')) <> '${fp58}' then`);
    // The header's read-only pre-flight and verify lines carry the same two values.
    expect(sql).toContain(`'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure; -- ${fp57}`);
    expect(sql).toContain(`'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure; -- ${fp58}`);
    expect([...sql.matchAll(/\b[0-9a-f]{32}\b/g)].map((m) => m[0]).sort()).toEqual([fp57, fp57, fp58, fp58, fp58].sort());
  });

  it("the harness proves the same two values on a real Postgres, and its role list is every role", () => {
    expect(harness).toContain(`export const FP_0357 = "${fp57}";`);
    expect(harness).toContain(`export const FP_0358 = "${fp58}";`);
    const roles = [...harness.match(/const ROLES = \[([^\]]*)\];/)![1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
    expect(roles.sort()).toEqual(Object.keys(ROLES).sort());
    // Its rollback body is 0357's, verbatim.
    const rollback = harness.match(/const ROLLBACK_TO_0357 = `([\s\S]*?)`;/)![1]!;
    expect(fingerprint(body(rollback))).toBe(fp57);
    expect(body(rollback)).toBe(body(sql0357));
  });
});

describe("the executable proof", () => {
  it("scripts/sql-harness-0358.mjs (PGlite, the REAL 0357 then the REAL 0358) runs green", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0358.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0358:");
    // The proofs the plan names, each present in the run.
    for (const needle of [
      "P0 a CHANGED live body is refused by name",
      "P0 a second apply is refused",
      "P1 old SQL: the reserve refuses a GM (the app maps it to 403)",
      "P2 SECURITY DEFINER",
      "P2 search_path pinned, and it is the only setting",
      "P3 PUBLIC cannot execute it (has_function_privilege)",
      "P3 calling it as anon is permission denied",
      "P3 calling it as authenticated is permission denied",
      "P3 calling it as a role that belongs to nothing (PUBLIC) is permission denied",
      "P3 calling it as service_role answers",
      "P4 the matrix: 15 roles x 5 states x 2 shops = 150 cells",
      "P5 a GM whose membership is inactive is refused by the reserve",
      "P6 every other function (body, ACL, settings), table, column ACL, column and trigger is identical before and after",
      "P7 0357's reserve executable by authenticated",
      "P8 re-emitting 0357's body restores 0357's fingerprint",
    ]) expect(out, needle).toContain(`ok   ${needle}`);
  }, 260_000);
});
