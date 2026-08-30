/**
 * Unit spine — OVERSIGHT IS SCORED AT THE LOCATION IT HAPPENED AT
 * (audit 2026-08-29, cluster reports-counts-ui).
 *
 * Every other category on the team page is location-scoped by construction. Oversight
 * read `audit_log` by actor_id alone, so a person active at two shops carried the
 * revokes they did at one into the other's roster — and into their own /my-performance
 * read, which applies no roster level ceiling and is therefore where it surfaces first.
 *
 * The bind is a PURE predicate over the row, so the interesting half is testable here.
 * Fixtures below are the real emission shapes, not invented ones:
 *   · lib/checklists.ts — the three completion actions, metadata.instance_id
 *   · migrations 0044/0048/0050/0053/0055 — report.update, metadata.report_instance_id
 *   · lib/checklists.ts dropInstance — report.drop, resource_id IS the instance id
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { oversightInstanceId, oversightRowAtLocation, OVERSIGHT_ACTIONS } from "@/lib/team-metrics";

const HERE = "11111111-1111-4111-8111-111111111111";
const THERE = "22222222-2222-4222-8222-222222222222";
const INST_HERE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INST_THERE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const hereInstances = new Set([INST_HERE]);

/** checklist_completion.revoke / .revoke_by_authority / .tag_actual_completer */
const completionRow = (instanceId: string) => ({
  resource_table: "checklist_completions",
  resource_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  metadata: { instance_id: instanceId, template_item_id: "t", in_quick_window: true },
});

/** report.update, emitted from SQL inside the submit RPCs */
const reportUpdateRow = (instanceId: string) => ({
  resource_table: "checklist_submissions",
  resource_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  metadata: { report_type: "opening_report", report_instance_id: instanceId, edit_count: 2 },
});

/** report.drop, whose resource_id IS the instance and whose metadata names the location */
const reportDropRow = (instanceId: string, locationId: string) => ({
  resource_table: "checklist_instances",
  resource_id: instanceId,
  metadata: { location_id: locationId, dropped_reason: "shift_change" },
});

describe("oversightInstanceId — the instance every oversight action hangs off", () => {
  it("reads metadata.instance_id from the completion actions", () => {
    expect(oversightInstanceId(completionRow(INST_HERE))).toBe(INST_HERE);
  });

  it("reads metadata.report_instance_id from report.update", () => {
    expect(oversightInstanceId(reportUpdateRow(INST_THERE))).toBe(INST_THERE);
  });

  it("falls back to resource_id when the row IS about an instance", () => {
    expect(oversightInstanceId(reportDropRow(INST_HERE, HERE))).toBe(INST_HERE);
  });

  it("is null — never a guess — when the row names no instance", () => {
    expect(oversightInstanceId({ resource_table: "users", resource_id: "u1", metadata: {} })).toBeNull();
    expect(oversightInstanceId({ resource_table: null, resource_id: null, metadata: null })).toBeNull();
    // A blank string is not an id.
    expect(
      oversightInstanceId({ resource_table: "checklist_completions", resource_id: "c1", metadata: { instance_id: "" } }),
    ).toBeNull();
    // resource_id alone does not make a NON-instance row an instance row.
    expect(oversightInstanceId({ resource_table: "checklist_completions", resource_id: "c1", metadata: null })).toBeNull();
  });
});

describe("oversightRowAtLocation — the bind", () => {
  it("counts a revoke done on THIS location's instance", () => {
    expect(oversightRowAtLocation(completionRow(INST_HERE), HERE, hereInstances)).toBe(true);
  });

  it("THE LEAK: a revoke done at the OTHER shop no longer scores here", () => {
    // The shipped behaviour counted this row at every location the actor works at.
    expect(oversightRowAtLocation(completionRow(INST_THERE), HERE, hereInstances)).toBe(false);
  });

  it("binds report.update through its own metadata key", () => {
    expect(oversightRowAtLocation(reportUpdateRow(INST_HERE), HERE, hereInstances)).toBe(true);
    expect(oversightRowAtLocation(reportUpdateRow(INST_THERE), HERE, hereInstances)).toBe(false);
  });

  it("binds report.drop by instance, and the instance list OUTRANKS metadata.location_id", () => {
    expect(oversightRowAtLocation(reportDropRow(INST_HERE, HERE), HERE, hereInstances)).toBe(true);
    // A row naming this location but an instance that is not ours belongs to the other
    // shop: our instance list is a fact about our data, metadata is the writer's word.
    expect(oversightRowAtLocation(reportDropRow(INST_THERE, HERE), HERE, hereInstances)).toBe(false);
  });

  it("uses metadata.location_id only when no instance is named at all", () => {
    const noInstance = { resource_table: null, resource_id: null, metadata: { location_id: HERE } };
    expect(oversightRowAtLocation(noInstance, HERE, hereInstances)).toBe(true);
    expect(oversightRowAtLocation(noInstance, THERE, hereInstances)).toBe(false);
  });

  it("EXCLUDES an unattributable row rather than counting it everywhere", () => {
    // Counting one act at both shops is the double-count this bind exists to stop.
    const orphan = { resource_table: "checklist_completions", resource_id: "c1", metadata: {} };
    expect(oversightRowAtLocation(orphan, HERE, hereInstances)).toBe(false);
    expect(oversightRowAtLocation(orphan, THERE, hereInstances)).toBe(false);
  });

  it("scores nothing at a location with no instances of its own", () => {
    expect(oversightRowAtLocation(completionRow(INST_HERE), HERE, new Set())).toBe(false);
  });
});

describe("both loaders apply the bind — the roster and the self-view", () => {
  // The predicate being correct proves nothing about it being CALLED. Two loaders read
  // this table (loadTeamOperatingHealth's roster and computePersonMetrics, which serves
  // both /reports/trends/team's person detail and /my-performance); the twin is exactly
  // how the first version of this gap got written twice.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "team-metrics.ts"), "utf8");

  it("calls oversightRowAtLocation on BOTH audit_log reads", () => {
    const calls = src.split("oversightRowAtLocation(").length - 1;
    // 1 definition + 2 call sites.
    expect(calls).toBeGreaterThanOrEqual(3);
    const reads = src.split('.from("audit_log")').length - 1;
    expect(reads).toBe(2);
  });

  it("selects the columns the bind needs on both reads", () => {
    const selects = src.split("resource_table, resource_id, metadata").length - 1;
    expect(selects).toBe(2);
  });

  it("keeps the curated action set as the only oversight vocabulary", () => {
    expect(OVERSIGHT_ACTIONS).toEqual([
      "checklist_completion.revoke",
      "checklist_completion.revoke_by_authority",
      "checklist_completion.tag_actual_completer",
      "report.update",
      "report.drop",
    ]);
  });
});
