/**
 * Item 21 PR 1: the ring-code capture-path fixture (plan r3 gate; Astra r3 #3).
 *
 * Juan (2026-11-18, answer 1): staff type a short ring code into the Toast check "like ezCater today". Today an ezCater
 * number reaches CO-OPS in exactly two ways, so the ring code must work through both, end to end, before
 * `ring_code_enabled` may flip:
 *   (a) the NAME of an item-bearing selection (an open item): capture keeps it (normalizeToastOrder), and the REAL 0344
 *       planner reads it from selection_units;
 *   (b) a SPECIAL_REQUEST note on an item: capture DROPS it; the ephemeral, version-fenced lookup
 *       (loadKnownToastOrderCodes) intersects its tokens with KNOWN codes and returns codes only, which the planner takes
 *       as p_note_codes. No note text survives either step.
 *   (c) the check's TAB NAME is read by NEITHER path today. This test pins that, so the gap is visible: if staff are told
 *       to use the tab name, the lookup must learn check.tabName (same intersect rule) before the switch flips.
 *
 * FIXTURE PROVENANCE: tests/fixtures/toast/catering-ring-code-sample.json follows the shape of the captured sample
 * (tests/fixtures/toast/orders-v2-sample.json). It is NOT yet a real captured ring. Before ring_code_enabled flips for a
 * shop, CC replaces it with a redacted real ring rung by staff the way they were trained (runbook catering-toast.md);
 * this test must still pass on that real JSON.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeToastOrder } from "@/lib/toast/capture-shared";
import { toastGet } from "@/lib/toast/client";
import { loadKnownToastOrderCodes } from "@/lib/ezcater/toast-codes";
import { normalizeOrderCode, orderCodeTokens } from "@/lib/ezcater/pass2-shared";
import { H1, SHOP, id, migration, schema } from "../scripts/sql-harness-0344-lib.mjs";

vi.mock("@/lib/toast/client", () => ({ toastGet: vi.fn(), ToastApiError: class extends Error {} }));
afterEach(() => vi.clearAllMocks());

const RING_CODE = "CO-4KM7R";
const raw = JSON.parse(readFileSync("tests/fixtures/toast/catering-ring-code-sample.json", "utf8")) as Array<Record<string, unknown>>;
const DATE = "2026-11-20";

async function plannerOver(noteCodes: unknown[]) {
  const db = new PGlite();
  await schema(db);
  await db.exec(migration);
  await db.exec(`insert into catering_pipeline(id, location_id, event_date, stage, lead_source, estimated_revenue_cents, ring_code)
    values ('${H1}', '${SHOP}', '${DATE}', 'confirmed', 'portal', 50000, '${RING_CODE}')`);
  let n = 0;
  for (const order of raw) {
    const captured = normalizeToastOrder(order, DATE);
    const snap = id("7000", ++n);
    await db.query(`insert into toast_orders(id, location_id, order_guid, business_date, dining_option_guid, selection_units)
      values ($1, $2, $3, $4, 'do-cat', $5)`, [snap, SHOP, captured.order.order_guid, DATE, JSON.stringify(captured.order.selection_units)]);
    for (const c of captured.checks) {
      await db.query(`insert into toast_order_checks(snapshot_id, check_guid, total_cents) values ($1, $2, $3)`, [snap, c.check_guid, c.total_cents]);
    }
    await db.query(`insert into toast_order_latest_pointers values ($1, $2, $3, $4)`, [SHOP, captured.order.order_guid, snap, DATE]);
  }
  const rows = (await db.query<{ check_guid: string; evidence: string }>(
    `select check_guid, evidence from plan_catering_toast($1, $2, $3, $4) where evidence = 'ring_code' order by check_guid`,
    [SHOP, "2026-11-15", "2026-11-25", JSON.stringify(noteCodes)])).rows;
  await db.close();
  return rows;
}

describe("ring code: the capture path staff actually use", () => {
  it("capture keeps an open item's name and drops note and tab text", () => {
    const names = raw.flatMap((o) => normalizeToastOrder(o, DATE).order.selection_units.map((s) => s.name));
    expect(names).toContain(RING_CODE);
    expect(JSON.stringify(raw.map((o) => normalizeToastOrder(o, DATE)))).not.toMatch(/Dana|555|portal order/);
    // The tab name is not captured at all.
    expect(JSON.stringify(normalizeToastOrder(raw[2], DATE))).not.toContain(RING_CODE);
  });

  it("the ring code is a whole code-shaped token under the ezCater rules (so PR 3's dual-code check can see it)", () => {
    expect(normalizeOrderCode(RING_CODE)).toBe("CO4KM7R");
    expect(orderCodeTokens(`portal order ${RING_CODE} thanks`)).toContain("CO4KM7R");
  });

  it("path (b): the note lookup returns the code only, keyed to its check", async () => {
    vi.mocked(toastGet).mockResolvedValue(raw);
    const found = await loadKnownToastOrderCodes("restaurant", DATE, [RING_CODE]);
    expect([...found.values()]).toEqual([["CO4KM7R"]]);
    const [key] = [...found.keys()];
    expect(JSON.parse(key!).slice(0, 2)).toEqual(["ring-note-order", "ring-note-check"]);
    expect(JSON.stringify([...found])).not.toMatch(/Dana|555|portal/);
  });

  it("end to end through the REAL planner: (a) by name alone, (b) once the lookup's codes are passed, (c) never", async () => {
    expect((await plannerOver([])).map((r) => r.check_guid)).toEqual(["ring-name-check"]);

    vi.mocked(toastGet).mockResolvedValue(raw);
    const found = await loadKnownToastOrderCodes("restaurant", DATE, [RING_CODE]);
    const noteCodes = [...found].flatMap(([key, codes]) => {
      const [order_guid, check_guid] = JSON.parse(key) as [string, string, string];
      return codes.map((code) => ({ location_id: SHOP, order_guid, check_guid, code }));
    });
    expect((await plannerOver(noteCodes)).map((r) => r.check_guid)).toEqual(["ring-name-check", "ring-note-check"]);
    // (c) The tab name is read by neither path: no evidence for ring-tab-check. See the header before relying on it.
  }, 60_000);
});
