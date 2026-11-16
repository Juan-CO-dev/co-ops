/**
 * Audit W17 / B184 — the counts tile must not spend the count-event id list.
 *
 * Count events never go inactive, so `loadCountsTileState`'s `.in("count_event_id", <every
 * active event>)` crossed the request-line ceiling at ~220 sessions; the dashboard's catch
 * turned that into a blank tile. The lines are now scoped through the event embed (the read
 * loadCensusAnchors already uses), so the request line is constant.
 */
import { expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { withInListGuard } from "./fixtures/in-list-guard";
import { OWNER_ACTOR } from "./fixtures/recipe-versions-harness";
import { loadCountsTileState } from "@/lib/counts";

let client: ReturnType<typeof createFakeDb>["client"];
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => client }));

const L = "loc-L";
const OTHER = "loc-other";

function seed() {
  const events: Array<Record<string, unknown>> = [];
  const lines: Array<Record<string, unknown>> = [];
  let n = 0;
  const event = (id: string, locationId: string, active: boolean, countedAt: string, skuIds: string[]) => {
    events.push({ id, location_id: locationId, active, counted_at: countedAt });
    for (const skuId of skuIds) lines.push({ id: `line-${String(++n).padStart(5, "0")}`, count_event_id: id, sku_id: skuId });
  };
  // 250 active sessions at L, one a day, each counting one or two of 40 SKUs.
  for (let i = 0; i < 250; i++) {
    const day = new Date(Date.UTC(2026, 0, 1 + i, 15)).toISOString();
    event(`ev-${String(i).padStart(4, "0")}`, L, true, day, i % 2 === 0 ? [`sku-${i % 40}`] : [`sku-${i % 40}`, `sku-${(i + 7) % 40}`]);
  }
  // The newest active session: 9 PM ET on 2026-11-13 is already 2026-11-14 in UTC.
  event("ev-newest", L, true, "2026-11-14T02:00:00+00:00", ["sku-0"]);
  // Inactive sessions at L, newer than everything, counting SKUs nobody else counted.
  for (let i = 0; i < 3; i++) event(`ev-inactive-${i}`, L, false, `2026-12-0${i + 1}T15:00:00+00:00`, [`sku-inactive-${i}`]);
  // Another shop's sessions, also newer, on their own SKUs.
  for (let i = 0; i < 5; i++) event(`ev-other-${i}`, OTHER, true, `2026-12-1${i}T15:00:00+00:00`, [`sku-other-${i}`]);
  return { sku_count_events: events, sku_count_lines: lines };
}

it("250 count sessions: last date and anchored-SKU count, no id list", async () => {
  client = withInListGuard(createFakeDb(seed()).client);
  expect(await loadCountsTileState(OWNER_ACTOR, L)).toEqual({ lastCountDate: "2026-11-13", anchoredSkuCount: 40 });
});

it("the other shop sees only its own sessions, and a never-counted shop is the cold start", async () => {
  client = withInListGuard(createFakeDb(seed()).client);
  expect(await loadCountsTileState(OWNER_ACTOR, OTHER)).toEqual({ lastCountDate: "2026-12-14", anchoredSkuCount: 5 });
  expect(await loadCountsTileState(OWNER_ACTOR, "loc-never")).toEqual({ lastCountDate: null, anchoredSkuCount: 0 });
});
