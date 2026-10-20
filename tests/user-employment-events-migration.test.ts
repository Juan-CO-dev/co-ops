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
  EMPLOYMENT_EVENT_KINDS, EMPLOYMENT_NOTE_MAX, EMPLOYMENT_REASON_MAX, EMPLOYMENT_RPC_ERRORS, LEAVE_REASONS, recordEmploymentEventCall,
  REHIRE_SETTINGS, SEPARATION_TYPES,
} from "@/lib/admin/employment-shared";
import {
  setUserActiveCall, setUserCredentialCall, setUserDormantCall, setUserLocationsCall, setUserRoleCall, updateUserProfileCall, USER_ADMIN_RPC_ERRORS,
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
      "S10 … users.active stays false (login not restored)", "PASS 0279:",
    ]) expect(out).toContain(s);
  }, 260_000);

  it("the SQL vocabularies and limits equal the TS ones", () => {
    expect(src).toContain(`kind             text not null check (kind in (${inList(EMPLOYMENT_EVENT_KINDS)}))`);
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
  });

  it("the table: deny-all RLS, no PostgREST grant, service_role SELECT only; every function service_role only", () => {
    expect(src).toContain("revoke all on public.user_employment_events from public, anon, authenticated, service_role;");
    expect(src).toContain("grant select on public.user_employment_events to service_role;");
    expect(src).not.toMatch(/grant (insert|update|delete|all)[^;]*user_employment_events/i);
    for (const op of ["select", "insert", "update", "delete"]) expect(src).toContain(`create policy user_employment_events_no_user_${op} on public.user_employment_events for ${op}`);
    for (const sig of ["user_employment_json_date(jsonb, text)", "user_employment_text(jsonb, text, integer)", "user_admin_role_level(text)", "user_admin_lock(uuid, uuid)",
      "user_employment_status(uuid)", "record_user_employment_event(uuid, uuid, uuid, text, jsonb)", "admin_user_set_active(uuid, uuid, boolean)",
      "admin_user_set_credential(uuid, uuid, text, text)", "admin_user_set_role(uuid, uuid, text)", "admin_user_set_locations(uuid, uuid, uuid[])",
      "admin_user_set_dormant(uuid, uuid, boolean, timestamptz)", "admin_user_update_profile(uuid, uuid, jsonb)"]) {
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
    ];
    for (const [call, params] of sigs) {
      expect(src).toContain(`create function public.${call.fn}(${params})`);
      expect(Object.keys(call.args).join(", ")).toBe(params.split(", ").map((p) => p.split(" ")[0]).join(", "));
    }
  });
});
