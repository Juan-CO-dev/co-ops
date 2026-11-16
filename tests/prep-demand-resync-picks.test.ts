/**
 * Audit W22/B121 — a quote revision resyncs a package order's kitchen demand unless it would really drop the
 * customer's stored picks; the skip is reported (prepDemandResynced=false) instead of answered as a resync.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDemandFromLines, resyncWouldDropPicks, type DemandQuoteLine } from "@/lib/catering/prep-demand-shared";
import { resyncPrepDemand } from "@/lib/catering/prep-demand";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { fakeSupabase, type FakeRpc } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const line = (over: Partial<DemandQuoteLine>): DemandQuoteLine => ({
  id: "l", itemId: null, menuItemId: null, packageId: null, quantity: 1, portion: null, description: null, lineKind: null, componentsListed: null, ...over,
});

describe("B121: resyncWouldDropPicks (pure)", () => {
  it("fixed package_component lines resync (no choice rows) → false", () => {
    const demand = resolveDemandFromLines({
      lines: [line({ id: "c1", itemId: "turkey", packageId: "P", quantity: 4, lineKind: "package_component" }), line({ id: "c2", itemId: "chips", packageId: "P", quantity: 4, lineKind: "package_component" })],
      comps: [], picks: [],
    });
    expect(demand.every((d) => d.choicePackageItemId == null)).toBe(true);
    expect(resyncWouldDropPicks(demand, [{ choicePackageItemId: null }, { choicePackageItemId: null }])).toBe(false);
  });

  it("a header whose picks were stored on the prior set, none on the new revision → true", () => {
    const demand = resolveDemandFromLines({
      lines: [line({ id: "h", packageId: "P", quantity: 2, lineKind: "package_header", componentsListed: false })],
      comps: [{ id: "slot", packageId: "P", slotType: "choice", itemId: null, menuItemId: null, quantity: 3, description: "Sub", displayOrder: 0 }],
      picks: [],
    });
    expect(demand).toEqual([{ itemId: null, menuItemId: null, choicePackageItemId: "slot", portion: null, qty: 6 }]);
    expect(resyncWouldDropPicks(demand, [{ choicePackageItemId: null }])).toBe(true);
  });

  it("a slot that was already 'needs a pick' before the revision → false (nothing to lose)", () => {
    expect(resyncWouldDropPicks([{ choicePackageItemId: "slot" }], [{ choicePackageItemId: "slot" }])).toBe(false);
  });

  it("item-only quote → false", () => {
    expect(resyncWouldDropPicks([{ choicePackageItemId: null }], [])).toBe(false);
  });

  // Fix round 1 (review r1 P2, BC-031/BC-042): two headers of one package share a choice slot; only header A
  // had stored picks (concrete turkey), header B was unpicked (an advisory slot row). A staff revise carries no
  // picks, so BOTH headers now resolve to the slot. The slot-level set said "the slot was already unresolved"
  // and resynced, silently replacing the turkey with a "needs a pick" row.
  it("mixed picked + unpicked headers sharing a slot: the revision loses the picked header's subs → true", () => {
    const comps = [{ id: "slot", packageId: "P", slotType: "choice", itemId: null, menuItemId: null, quantity: 3, description: "Sub", displayOrder: 0 }];
    const header = (id: string) => line({ id, packageId: "P", quantity: 1, lineKind: "package_header", componentsListed: false });
    const prior = resolveDemandFromLines({
      lines: [header("A1"), header("B1")], comps,
      picks: [{ quoteItemId: "A1", packageItemId: "slot", itemId: "turkey", menuItemId: null, quantity: 3 }],
    });
    expect(prior).toEqual([
      { itemId: "turkey", menuItemId: null, choicePackageItemId: null, portion: null, qty: 3 },
      { itemId: null, menuItemId: null, choicePackageItemId: "slot", portion: null, qty: 3 },
    ]);
    const revised = resolveDemandFromLines({ lines: [header("A2"), header("B2")], comps, picks: [] });
    // The prior reserved quote held stored picks for "slot": a revision resolving that slot loses them.
    expect(resyncWouldDropPicks(revised, prior, ["slot"])).toBe(true);
    // Even when the picked header was the one deleted (one header left), the ledger cannot tell which: refuse.
    expect(resyncWouldDropPicks(revised.slice(0, 1), prior, ["slot"])).toBe(true);
  });

  it("the prior quote's picks were for another slot → this slot's unresolved row loses nothing", () => {
    expect(resyncWouldDropPicks([{ choicePackageItemId: "slot" }], [{ choicePackageItemId: "slot" }, { choicePackageItemId: null }], ["other-slot"])).toBe(false);
  });
});

describe("B121: resyncPrepDemand", () => {
  const actor = { user: { id: "mgr", role: "catering_mgr" }, role: "catering_mgr", level: 6, locations: ["shop"] } as unknown as AuthContext;
  let rpcs: FakeRpc[];
  let prior: Array<{ choice_package_item_id: string | null }>;
  let items: unknown[];

  beforeEach(() => {
    prior = [{ choice_package_item_id: null }];
    items = [
      { id: "c1", item_id: "turkey", menu_item_id: null, package_id: "P", quantity: 4, portion: null, description: null, line_kind: "package_component", components_listed: null },
    ];
    const fake = fakeSupabase((call) => {
      if (call.table === "catering_pipeline") return { data: { stage: "confirmed" } };
      if (call.table === "catering_quotes") return { data: { id: "Q2", location_id: "shop", event_date: "2030-11-20" } };
      if (call.table === "catering_quote_items" && call.has("is", "line_kind", null)) return { data: [] };
      if (call.table === "catering_quote_items") return { data: items };
      if (call.table === "catering_prep_demand") return { data: prior };
      if (call.table === "catering_package_items" || call.table === "catering_quote_item_options") return { data: [] };
      return { data: null };
    }, () => ({ data: { result: "reserved", released: 1, inserted: 1 } }));
    rpcs = fake.rpcs;
    vi.mocked(getServiceRoleClient).mockReturnValue(fake.client as unknown as ReturnType<typeof getServiceRoleClient>);
  });

  it("a revised fixed-component package order is re-reserved (the old any-package-line skip is gone)", async () => {
    expect(await resyncPrepDemand(actor, "L")).toBe("resynced");
    expect(rpcs.map((r) => r.name)).toEqual(["reserve_catering_prep_demand"]);
  });

  it("a revision that would drop stored picks is skipped AND reported", async () => {
    items = [{ id: "h", item_id: null, menu_item_id: null, package_id: "P", quantity: 2, portion: null, description: null, line_kind: "package_header", components_listed: false }];
    // The package carries one choice slot; the revision has no stored picks for it.
    const withSlot = fakeSupabase((call) => {
      if (call.table === "catering_pipeline") return { data: { stage: "confirmed" } };
      if (call.table === "catering_quotes") return { data: { id: "Q2", location_id: "shop", event_date: "2030-11-20" } };
      if (call.table === "catering_quote_items" && call.has("is", "line_kind", null)) return { data: [] };
      if (call.table === "catering_quote_items") return { data: items };
      if (call.table === "catering_prep_demand") return { data: prior };
      if (call.table === "catering_package_items") return { data: [{ id: "slot", package_id: "P", slot_type: "choice", item_id: null, menu_item_id: null, quantity: 3, description: "Sub", display_order: 0 }] };
      if (call.table === "catering_quote_item_options") return { data: [] };
      return { data: null };
    });
    vi.mocked(getServiceRoleClient).mockReturnValue(withSlot.client as unknown as ReturnType<typeof getServiceRoleClient>);
    expect(await resyncPrepDemand(actor, "L")).toBe("skipped_package_picks");
    expect(withSlot.rpcs).toHaveLength(0);
  });

  it("mixed picked + unpicked headers on the prior quote: the prior quote's stored picks are read, the resync is skipped", async () => {
    // Prior reserved set (quote Q1): turkey from picked header A1 + an advisory slot row from unpicked header B1.
    prior = [
      { choice_package_item_id: null, quote_id: "Q1" } as unknown as { choice_package_item_id: string | null },
      { choice_package_item_id: "slot", quote_id: "Q1" } as unknown as { choice_package_item_id: string | null },
    ];
    // Revision Q2: both headers, no picks carried.
    items = [
      { id: "A2", item_id: null, menu_item_id: null, package_id: "P", quantity: 1, portion: null, description: null, line_kind: "package_header", components_listed: false },
      { id: "B2", item_id: null, menu_item_id: null, package_id: "P", quantity: 1, portion: null, description: null, line_kind: "package_header", components_listed: false },
    ];
    const mixed = fakeSupabase((call) => {
      if (call.table === "catering_pipeline") return { data: { stage: "confirmed" } };
      if (call.table === "catering_quotes") return { data: { id: "Q2", location_id: "shop", event_date: "2030-11-20" } };
      if (call.table === "catering_quote_items" && call.has("is", "line_kind", null)) return { data: [] };
      if (call.table === "catering_quote_items" && call.has("in", "quote_id", ["Q1"])) return { data: [{ id: "A1" }, { id: "B1" }] };
      if (call.table === "catering_quote_items") return { data: items };
      if (call.table === "catering_prep_demand") return { data: prior };
      if (call.table === "catering_package_items") return { data: [{ id: "slot", package_id: "P", slot_type: "choice", item_id: null, menu_item_id: null, quantity: 3, description: "Sub", display_order: 0 }] };
      if (call.table === "catering_quote_item_options" && call.has("in", "quote_item_id", ["A1", "B1"])) return { data: [{ package_item_id: "slot" }] };
      if (call.table === "catering_quote_item_options") return { data: [] };
      return { data: null };
    }, () => ({ data: { result: "reserved", released: 2, inserted: 2 } }));
    vi.mocked(getServiceRoleClient).mockReturnValue(mixed.client as unknown as ReturnType<typeof getServiceRoleClient>);
    expect(await resyncPrepDemand(actor, "L")).toBe("skipped_package_picks");
    expect(mixed.rpcs).toHaveLength(0);
  });
});

describe("B121: source pins", () => {
  const lib = readFileSync("lib/catering/prep-demand.ts", "utf8");
  const route = readFileSync("app/api/catering/quotes/[id]/route.ts", "utf8");
  const client = readFileSync("components/catering/quotes/QuotesClient.tsx", "utf8");
  it("resyncPrepDemand no longer skips on any package line", () => {
    expect(lib).not.toContain('.not("package_id", "is", null).limit(1)');
  });
  it("the route reports a skipped resync as not resynced, and the builder says so", () => {
    expect(route).toContain('prepDemandResynced = (await resyncPrepDemand(ctx, pipelineId)) !== "skipped_package_picks";');
    expect(client).toContain("res.data.prepDemandResynced === false");
    expect(client).toContain('t("catering.quotes.prep_not_resynced" as TranslationKey)');
  });
});
