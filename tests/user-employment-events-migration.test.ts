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
      "S6 not eligible → the CGS is refused (owner only)", "S7 the TS state reads the corrected fields; the head is the correction", "PASS 0279:",
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
  });

  it("the table: deny-all RLS, no PostgREST grant, service_role SELECT only; every function service_role only", () => {
    expect(src).toContain("revoke all on public.user_employment_events from public, anon, authenticated, service_role;");
    expect(src).toContain("grant select on public.user_employment_events to service_role;");
    expect(src).not.toMatch(/grant (insert|update|delete|all)[^;]*user_employment_events/i);
    for (const op of ["select", "insert", "update", "delete"]) expect(src).toContain(`create policy user_employment_events_no_user_${op} on public.user_employment_events for ${op}`);
    for (const sig of ["user_employment_json_date(jsonb, text)", "user_employment_text(jsonb, text, integer)", "record_user_employment_event(uuid, uuid, uuid, text, jsonb)"]) {
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
  });
});
