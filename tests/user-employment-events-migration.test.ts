/**
 * Migration 0279 (user_employment_events: on leave / separated / rehired; staff separations, Juan 2026-10-20) —
 * AUTHORED, NOT APPLIED. Pins: the house header and gate line; the executable PGlite proof (scripts/sql-harness-0279.mjs:
 * the ceilings, the actor rule, the transitions, the head, the payload, the rehire gate, corrections); service_role-only
 * grants; the SQL vocabularies equal the TS ones; the lib's builder names the SQL arguments.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMPLOYMENT_ROW_KINDS, EMPLOYMENT_NOTE_MAX, EMPLOYMENT_REASON_MAX, EMPLOYMENT_RPC_ERRORS, LEAVE_REASONS, recordEmploymentEventCall,
  REHIRE_SETTINGS, SEPARATION_TYPES,
} from "@/lib/admin/employment-shared";
import {
  createUserCall, setUserActiveCall, setUserCredentialCall, setUserDormantCall, setUserLocationsCall, setUserRoleCall, updateUserProfileCall, USER_ADMIN_RPC_ERRORS,
} from "@/lib/admin/user-admin-rpc-shared";
import { ROLES } from "@/lib/roles";

const src = readFileSync("supabase/migrations/0279_user_employment_events.sql", "utf8");
const inList = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

describe("0279_user_employment_events", () => {
  it("house header and gate line (file only, not applied)", () => {
    const [first, gate] = src.split("\n");
    expect(first).toBe("-- Migration 0279_user_employment_events");
    expect(gate).toBe("-- AUTHORED 2026-10-20. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word).");
    expect(src).not.toMatch(/APPLIED TO (SIM|PROD)/);
  });

  it("the executable proof runs green (PGlite: the stub, sessions, the REAL 0228 level helper, then 0279)", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0279.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    for (const s of [
      "S0 a second apply is refused by the preflight", "S1 RLS on, four deny-all policies named <table>_no_user_<op>",
      "S1 anon cannot read the table", "S1 authenticated cannot EXECUTE the writer", "S1 service_role cannot update (append-only)",
      "S2 a GM is refused a person who also works at a shop the GM does not belong to",
      "S3 leave: on leave, deactivated, both live sessions revoked in the same transaction", "S4 a stale p_expected → employment_moved",
      "S6 not eligible → the CGS rehires with a reason (the owner's authority)", "S7 the TS state reads the corrected fields; the head is the correction",
      "S8 admin_user_set_credential takes the ONE gate (user_admin_lock) and no lock of its own",
      "S9 a promotion to GM committed first → the GM's password write is refused → forbidden",
      "S9 a second shop committed first → the GM's PIN write is refused → target_outside_shop",
      "S10 a separation committed after the screen read 'active' → the activation is refused use_rehire → use_rehire",
      "S10 … users.active stays false (login not restored)",
      "S12 the gate locks the two users rows in SORTED id order (lower first; target FOR UPDATE, actor FOR SHARE), one advisory lock, checks after",
      "S12 the actor demoted first → the create is refused → forbidden", "S12 the actor deactivated first → the create is refused → forbidden",
      "S12 the actor moved off the shop first → the create is refused → forbidden",
      "S13 a match the client OMITTED → rehire_match → rehire_match",
      "S13 the actor demoted between the check and the create → rehire_permission_required → rehire_permission_required",
      "S13 a concurrent duplicate email (23505) on create → email_taken → email_taken",
      "S13 r2 a rehire setting flipped yes → no before the lock → the unconfirmed create is refused rehire_match → rehire_match",
      "S14 a restricted person's phone edited to the requested phone (committed first) → rehire_match → rehire_match", "S12 … and none of the refused creates inserted anyone", "PASS 0279:",
    ]) expect(out).toContain(s);
  }, 260_000);

  it("the SQL vocabularies and limits equal the TS ones", () => {
    expect(src).toContain(`kind             text not null check (kind in (${inList(EMPLOYMENT_ROW_KINDS)}))`);
    expect(src).toContain(`leave_reason     text check (leave_reason in (${inList(LEAVE_REASONS)}))`);
    expect(src).toContain(`separation_type  text check (separation_type in (${inList(SEPARATION_TYPES)}))`);
    expect(src).toContain(`rehire           text check (rehire in (${inList(["yes", "no", "only_with_owner_ok"])}))`);
    expect([...REHIRE_SETTINGS].sort()).toEqual(["no", "only_with_owner_ok", "yes"]);
    expect(src).toContain(`char_length(reason) between 1 and ${EMPLOYMENT_REASON_MAX}`);
    expect(src).toContain(`char_length(note) between 1 and ${EMPLOYMENT_NOTE_MAX}`);
    for (const code of EMPLOYMENT_RPC_ERRORS) expect(src).toContain(`raise exception '${code}'`);
    for (const code of Object.keys(USER_ADMIN_RPC_ERRORS)) expect(src, code).toContain(`raise exception '${code}'`);
  });

  it("the SQL role levels equal lib/roles.ts ROLES (user_admin_role_level)", () => {
    const fn = src.slice(src.indexOf("create function public.user_admin_role_level("), src.indexOf("$$;", src.indexOf("create function public.user_admin_role_level(")));
    const sql = Object.fromEntries([...fn.matchAll(/when '([a-z_]+)' then (\d+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(sql).toEqual(Object.fromEntries(Object.values(ROLES).map((r) => [r.code, r.level])));
    // admin_user_create's email-auth rule (level 6 and up) is lib/roles.ts hasEmailAuth.
    for (const r of Object.values(ROLES)) expect(r.hasEmailAuth, r.code).toBe(r.level >= 6);
  });

  it("THE LOCK ORDER (Astra BC-042/040): the gate takes one advisory lock, then the two users rows in sorted id order", () => {
    const gate = src.slice(src.indexOf("create function public.user_admin_lock("), src.indexOf("end $$;", src.indexOf("create function public.user_admin_lock(")));
    expect((gate.match(/pg_advisory_xact_lock/g) ?? []).length).toBe(1);
    const locks = [...gate.matchAll(/where id = (p_actor|p_user) for (share|update)/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(locks).toEqual(["p_actor share", "p_user update", "p_user update", "p_actor share"]);
    expect(gate).toMatch(/if p_actor < p_user then\s+select[^;]+p_actor for share;[\s\S]*?else\s+select[^;]+p_user for update;/);
    // No other function takes a users row lock or a per-person advisory lock of its own (all go through the gate); the
    // creation writer's one FOR SHARE statement locks its rows in ascending id order; the identity lock is its own rank.
    const identity = src.slice(src.indexOf("create function public.user_admin_identity_lock("), src.indexOf("end $$;", src.indexOf("create function public.user_admin_identity_lock(")));
    expect(identity).toContain("perform pg_advisory_xact_lock(hashtextextended('co-ops/user-identity', 0));");
    const rest = src.replace(gate, "").replace(identity, "");
    expect((rest.match(/\bfor update;/g) ?? []).length).toBe(0);
    expect((rest.match(/\bfor share;/g) ?? []).length).toBe(1);
    expect((rest.match(/pg_advisory_xact_lock\(/g) ?? []).length).toBe(0);
  });

  it("THE IDENTITY LOCK (Astra BC-007/004 r3) is rank 1: first in every phone-changing writer and the create, nowhere else", () => {
    const body = (name: string) => src.slice(src.indexOf(`create function public.${name}(`), src.indexOf("end $$;", src.indexOf(`create function public.${name}(`)));
    const callers = [...src.matchAll(/create function public\.([a-z_]+)\(/g)].map((m) => m[1]!).filter((n) => body(n).includes("perform public.user_admin_identity_lock();"));
    expect(callers.sort()).toEqual(["admin_user_create", "admin_user_update_profile"]);
    // Every writer that changes a phone is a caller.
    const phoneWriters = [...src.matchAll(/create function public\.([a-z_]+)\(/g)].map((m) => m[1]!).filter((n) => /update public\.users set phone|insert into public\.users \([^)]*\bphone\b/.test(body(n)));
    expect(phoneWriters.sort()).toEqual(["admin_user_create", "admin_user_update_profile"]);
    for (const n of callers) {
      const b = body(n);
      const first = b.indexOf("perform public.user_admin_identity_lock();");
      // Before it: no other lock of any rank (no gate call, no row lock, no advisory lock).
      expect(b.slice(0, first), n).not.toMatch(/user_admin_lock\(|for share;|for update;|pg_advisory_xact_lock/);
    }
    // The gate (rank 2 + 3) never takes the identity lock, so nothing waits for rank 1 while holding rank 2 or 3.
    expect(body("user_admin_lock")).not.toContain("user_admin_identity_lock");
    expect(src).toContain("A transaction holding a lock of rank n never waits for one of rank < n, so there is no cycle");
  });

  it("Astra BC-007/004 r2: the create's identity candidates are NOT filtered on the rehire setting before the lock", () => {
    const fn = src.slice(src.indexOf("create function public.admin_user_create("), src.indexOf("end $$;", src.indexOf("create function public.admin_user_create(")));
    const beforeLock = fn.slice(fn.indexOf("THE IDENTITY CANDIDATES"), fn.indexOf("perform 1 from public.users where id = any (v_locked) order by id for share;"));
    expect(beforeLock).toContain("into v_candidates");
    expect(beforeLock).not.toContain("user_employment_rehire");
    expect(fn).toContain("v_locked := array(select distinct x from unnest(array[p_actor] || v_candidates) x order by x);");
    const afterLock = fn.slice(fn.indexOf("perform 1 from public.users where id = any (v_locked) order by id for share;"));
    expect(afterLock).toContain("from unnest(v_candidates) x where coalesce(public.user_employment_rehire(x), 'yes') <> 'yes'");
    // The rehire setting moves only through the employment writer, whose gate holds that person's row FOR UPDATE.
    const writer = src.slice(src.indexOf("create function public.record_user_employment_event("), src.indexOf("end $$;", src.indexOf("create function public.record_user_employment_event(")));
    expect(writer).toContain("v_ctx := public.user_admin_lock(p_actor, p_user);");
  });

  it("the table: deny-all RLS, no PostgREST grant, service_role SELECT only; every function service_role only", () => {
    expect(src).toContain("revoke all on public.user_employment_events from public, anon, authenticated, service_role;");
    expect(src).toContain("grant select on public.user_employment_events to service_role;");
    expect(src).not.toMatch(/grant (insert|update|delete|all)[^;]*user_employment_events/i);
    for (const op of ["select", "insert", "update", "delete"]) expect(src).toContain(`create policy user_employment_events_no_user_${op} on public.user_employment_events for ${op}`);
    for (const sig of ["user_employment_json_date(jsonb, text)", "user_employment_text(jsonb, text, integer)", "user_admin_role_level(text)", "user_admin_lock(uuid, uuid)", "user_admin_identity_lock()",
      "user_employment_status(uuid)", "user_employment_rehire(uuid)", "user_admin_phone_key(text)", "record_user_employment_event(uuid, uuid, uuid, text, jsonb)", "admin_user_set_active(uuid, uuid, boolean)",
      "admin_user_set_credential(uuid, uuid, text, text)", "admin_user_set_role(uuid, uuid, text)", "admin_user_set_locations(uuid, uuid, uuid[])",
      "admin_user_set_dormant(uuid, uuid, boolean, timestamptz)", "admin_user_update_profile(uuid, uuid, jsonb)",
      "admin_user_create(uuid, text, text, text, text, text, text, uuid[], text, boolean, uuid[], text)"]) {
      expect(src).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`);
      expect(src).toContain(`grant execute on function public.${sig} to service_role;`);
    }
    expect(src).not.toMatch(/grant execute[^;]*to (anon|authenticated|public)/i);
  });

  it("the lib's builder names the SQL arguments", () => {
    const call = recordEmploymentEventCall({ actorId: "a", userId: "u", expectedId: null, kind: "leave_start", fields: {} });
    expect(call.fn).toBe("record_user_employment_event");
    expect(Object.keys(call.args)).toEqual(["p_actor", "p_user", "p_expected", "p_kind", "p_fields"]);
    expect(src).toContain("create function public.record_user_employment_event(p_actor uuid, p_user uuid, p_expected uuid, p_kind text, p_fields jsonb)");
    const sigs: Array<[{ fn: string; args: Record<string, unknown> }, string]> = [
      [setUserActiveCall({ actorId: "a", userId: "u", active: true }), "p_actor uuid, p_user uuid, p_active boolean"],
      [setUserCredentialCall({ actorId: "a", userId: "u", kind: "pin", hash: "h" }), "p_actor uuid, p_user uuid, p_kind text, p_hash text"],
      [setUserRoleCall({ actorId: "a", userId: "u", role: "employee" }), "p_actor uuid, p_user uuid, p_role text"],
      [setUserLocationsCall({ actorId: "a", userId: "u", locationIds: [] }), "p_actor uuid, p_user uuid, p_locations uuid[]"],
      [setUserDormantCall({ actorId: "a", userId: "u", dormant: true, expectedDormantAt: null }), "p_actor uuid, p_user uuid, p_dormant boolean, p_expected timestamptz"],
      [updateUserProfileCall({ actorId: "a", userId: "u", patch: {} }), "p_actor uuid, p_user uuid, p_patch jsonb"],
      [createUserCall({ actorId: "a", name: "n", role: "employee", email: null, phone: null, pinHash: "h", passwordHash: null, locationIds: [],
        toastGuid: null, rehireConfirmed: false, rehireUserIds: [], rehireReason: null }),
        "p_actor uuid, p_name text, p_role text, p_email text, p_phone text, p_pin_hash text,\n  p_password_hash text, p_locations uuid[], p_toast_guid text, p_rehire_confirmed boolean, p_rehire_user_ids uuid[], p_rehire_reason text"],
    ];
    for (const [call, params] of sigs) {
      expect(src).toContain(`create function public.${call.fn}(${params})`);
      expect(Object.keys(call.args).join(", ")).toBe(params.split(/,\s*/).map((p) => p.trim().split(" ")[0]).join(", "));
    }
  });
});
