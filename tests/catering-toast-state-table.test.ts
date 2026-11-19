/**
 * Item 21 PR 3, fix round 3 (review PORTAL3-r3): ONE state table for a house catering order and one Toast check.
 * Rounds 1-3 each found a gap in the conflict / ownership lifecycle, so every (lead state x check state x owner) the
 * link step can reach is one row of tests/fixtures/catering-toast-state-table.json, asserted three ways:
 *   - the DATABASE half (`sql`: the house planner, the not-rung list, the ezCater order's conflict read, the ended
 *     links, and the writer's answer to "link" and "not a match") by scripts/sql-harness-0347.mjs section K, on the
 *     real migrations (run here, and by tests/catering-toast-0347-migration.test.ts);
 *   - the PANEL half (`panel`) here: the row's database answers go through the real buildHouseToastPanel,
 *     candidateActions and endedActions, and must give the row's place, state and controls;
 *   - the RUNBOOK's copy (docs/runbooks/catering-toast.md) must be this table, line for line.
 * And the two halves must agree: a control is offered only where the writer accepts it, and a link the writer would
 * accept is always offered.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildHouseToastPanel, candidateActions, endedActions, type ToastEndedRow, type ToastLinkRow,
} from "@/lib/catering/catering-toast-links-shared";
import type { CateringToastPlanRow } from "@/lib/catering/catering-toast-shared";
import fixture from "./fixtures/catering-toast-state-table.json";

type Owner = "nobody" | "this" | "other_house" | "ezcater";
interface Row {
  id: string; lead: string; check: string; owner: string;
  sql: {
    planner: { owner: Owner; dual_code: boolean; blocked: boolean } | null;
    list: "not_rung_in_toast" | "matched" | "no_ring_expected" | "absent";
    conflict: "dual_code" | "ownership_conflict" | null; linked: boolean; ended: "nobody" | "ezcater" | "house" | null;
    checkLive: boolean; link: string; not_a_match: string;
  };
  panel: { where: "candidate" | "linked" | "ended" | "none"; state: string; actions: string[] };
}
const rows = fixture.rows as Row[];

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LEAD = U(1), SHOP = U(2), OTHER_LEAD = U(77);

/** What the panel shows for a row's database answers, through the real builders. */
function panelOf(row: Row): Row["panel"] {
  const { sql } = row;
  // No status row = the server returns no panel; a "no ring expected" order hides its possible checks (pinned below).
  if (sql.list === "absent" || sql.list === "no_ring_expected") return { where: "none", state: "none", actions: [] };
  const plan: CateringToastPlanRow[] = sql.planner ? [{
    lead_id: LEAD, location_id: SHOP, order_guid: "o", check_guid: "c", toast_snapshot_id: U(50), business_date: "2027-01-15",
    evidence: "amount_date", check_total_cents: 50000, lead_value_cents: 50000, amount_diff_cents: 0, amount_mismatch: false,
    dual_code: sql.planner.dual_code, blocked: sql.planner.blocked,
    owner: sql.planner.owner === "nobody" ? null : sql.planner.owner === "ezcater" ? "ezcater" : "house",
    owner_lead_id: sql.planner.owner === "this" ? LEAD : sql.planner.owner === "other_house" ? OTHER_LEAD : null,
  }] : [];
  const links: ToastLinkRow[] = sql.linked ? [{ location_id: SHOP, order_guid: "o", check_guid: "c", evidence: "manual",
    total_cents: 50000, business_date: "2027-01-15", live: sql.checkLive }] : [];
  const ended: ToastEndedRow[] = sql.ended ? [{ location_id: SHOP, order_guid: "o", check_guid: "c", evidence: "manual", retired_reason: "lead_moved",
    head_id: U(11), owner: sql.ended === "nobody" ? null : sql.ended, total_cents: 50000, business_date: "2027-01-15", live: sql.checkLive }] : [];
  const panel = buildHouseToastPanel({
    status: { lead_id: LEAD, location_id: SHOP, event_date: "2027-01-15", ring_code: null, value_cents: 50000, status: sql.list },
    plan, heads: [], links, canDecide: true, linkStep: "ready", ended,
  });
  expect(panel.links.length + panel.ended.length + panel.candidates.length).toBeLessThanOrEqual(1); // a check is shown once
  if (panel.links[0]) return { where: "linked", state: "linked", actions: ["unlink"] };
  if (panel.ended[0]) return { where: "ended", state: `ended_${panel.ended[0].owner ?? "nobody"}`, actions: endedActions(panel.ended[0]) };
  if (panel.candidates[0]) return { where: "candidate", state: panel.candidates[0].state, actions: candidateActions(panel.candidates[0]) };
  return { where: "none", state: "none", actions: [] };
}

describe("the state table: every (lead x check x owner) row", () => {
  it("names each row once and covers every panel state and both conflict kinds", () => {
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(rows.map((r) => r.id)).toEqual(rows.map((_, i) => `S${String(i + 1).padStart(2, "0")}`));
    const states = new Set(rows.map((r) => r.panel.state));
    for (const s of ["open", "dual_code", "owned_ezcater", "owned_house", "blocked", "linked", "ended_nobody", "ended_ezcater", "none"]) expect([s, states.has(s)]).toEqual([s, true]);
    const conflicts = new Set(rows.map((r) => r.sql.conflict));
    expect([conflicts.has("dual_code"), conflicts.has("ownership_conflict"), conflicts.has(null)]).toEqual([true, true, true]);
  });

  it.each(rows.map((r) => [r.id, `${r.lead} | ${r.check} | ${r.owner}`, r] as const))("%s: %s", (_id, _label, row) => {
    expect(panelOf(row)).toEqual(row.panel);
    const { actions, where } = row.panel;
    // A control is offered only where the writer accepts that decision ...
    if (actions.includes("link")) expect(row.sql.link).toBe("ok");
    if (actions.includes("not_a_match")) expect(row.sql.not_a_match).toBe("ok");
    if (actions.includes("unlink")) expect(row.sql.linked).toBe(true);
    if (where === "candidate" || where === "ended") {
      // ... a link the writer would accept is always offered ...
      if (row.sql.link === "ok") expect(actions).toContain("link");
      // ... and so is "not a match", unless the pair is already a tombstone (blocked).
      if (row.sql.not_a_match === "ok" && row.panel.state !== "blocked") expect(actions).toContain("not_a_match");
    }
    // Nothing is ever linkable over an owner.
    if (row.sql.planner && row.sql.planner.owner !== "nobody") expect(row.sql.link).not.toBe("ok");
    // The ezCater side shows a conflict only while the house side is not tombstoned and still at the shop.
    if (row.sql.conflict) expect([row.sql.planner?.blocked, row.sql.list === "absent"]).toEqual([false, false]);
  });

  it("review PORTAL3-r3 P2 #2: an incumbent-owned check offers 'Not a match' and never 'Link'", () => {
    const owned = rows.filter((r) => ["owned_ezcater", "owned_house", "ended_ezcater"].includes(r.panel.state));
    expect(owned.map((r) => r.id)).toEqual(["S08", "S09", "S13"]);
    for (const r of owned) expect([r.id, r.panel.actions, r.sql.not_a_match]).toEqual([r.id, ["not_a_match"], "ok"]);
    // Once dismissed the pair is a tombstone: no conflict on either side, the owner unchanged, no control left.
    for (const id of ["S10", "S14"]) {
      const r = rows.find((x) => x.id === id)!;
      expect([id, r.sql.planner?.owner, r.sql.planner?.blocked, r.sql.conflict, r.panel.actions]).toEqual([id, "ezcater", true, null, []]);
    }
  });

  it("review PORTAL3-r3 P2 #1: a conflict ends when the ezCater order leaves the shop, is cancelled, or leaves the window", () => {
    expect(rows.find((r) => r.id === "S02")!.sql.conflict).toBe("dual_code");
    for (const id of ["S19", "S20", "S21"]) expect([id, rows.find((r) => r.id === id)!.sql.conflict]).toEqual([id, null]);
  });

  it("the panel rules this table mirrors are the component's", () => {
    const src = readFileSync("components/catering/pipeline/HouseToastPanel.tsx", "utf8");
    expect(src).toContain('{panel.leadHead?.kind !== "no_ring_expected" && <div>'); // possible checks hidden under "no ring expected"
    expect(src).toContain("candidateActions(c).map(");
    expect(src).toContain("endedActions(e).map(");
    expect(src).toContain('t("catering.toast_link.action.unlink")');
  });
});

describe("the runbook carries this table", () => {
  const OWNER: Record<Owner, string> = { nobody: "nobody", this: "this order", other_house: "another house order", ezcater: "ezCater" };
  const LIST: Record<Row["sql"]["list"], string> = {
    not_rung_in_toast: "on the list", matched: "off (matched)", no_ring_expected: "off (no ring expected)", absent: "not listed",
  };
  const WHERE: Record<Row["panel"]["where"], string> = { candidate: "possible check", linked: "linked check", ended: "ended link", none: "not shown" };
  const ACTION: Record<string, string> = { link: "Link", not_a_match: "Not a match", unlink: "Unlink" };
  const answer = (a: string) => (a === "ok" ? "ok" : `\`${a}\``);
  const line = (r: Row) => {
    const p = r.sql.planner;
    const planner = p ? `owner ${OWNER[p.owner]}${p.dual_code ? ", dual code" : ""}${p.blocked ? ", blocked" : ""}` : "no row";
    const panel = r.panel.where === "none" ? WHERE.none
      : `${WHERE[r.panel.where]}${r.panel.where === "candidate" ? ` (${r.panel.state})` : ""}: ${r.panel.actions.map((a) => ACTION[a]).join(", ") || "no control"}`;
    return `| ${[r.id, r.lead, r.check, r.owner, planner, LIST[r.sql.list], r.sql.conflict ? `\`${r.sql.conflict}\`` : "none", panel,
      answer(r.sql.link), answer(r.sql.not_a_match)].join(" | ")} |`;
  };
  it("line for line, and nothing else", () => {
    const runbook = readFileSync("docs/runbooks/catering-toast.md", "utf8").replace(/\r\n/g, "\n");
    const expected = rows.map(line);
    const got = runbook.split("\n").filter((l) => /^\| S\d\d \|/.test(l));
    expect(got, `the runbook's table should be:\n${expected.join("\n")}`).toEqual(expected);
  });
});

describe("the database half", () => {
  it("scripts/sql-harness-0347.mjs section K asserts every row of this table", () => {
    const harness = readFileSync("scripts/sql-harness-0347.mjs", "utf8");
    expect(harness).toContain("tests/fixtures/catering-toast-state-table.json");
    expect(harness).toContain("table.map(r => r.id).join() === Object.keys(build).join()");
    expect(harness).toContain("JSON.stringify(actual) === JSON.stringify(row.sql)");
  });
});
