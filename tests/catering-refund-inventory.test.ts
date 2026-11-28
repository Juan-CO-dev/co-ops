/**
 * The catering refunds INVENTORY (Part B1 v2, plan 4.2 / DR9 / [T6] / [DR12]): lib/catering/refund-inventory.ts on the
 * REAL 0359 F15 in PGlite (tests/helpers/refund-pglite.ts: the real 0357 -> 0358 -> 0359, synthetic rows only), the
 * page's gates (Owner / CGS by role; `CATERING_REFUNDS_OBSERVE` unset = notFound() for everyone), the page renders
 * "last claim" AND "last finished pass" side by side and warns when the claim is newer [T6], it renders no control
 * that mutates, and the OFF-parity UI case: with both switches unset the quote page and the pipeline mount no refund
 * UI and make no refund request.
 */
import { readFileSync } from "node:fs";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
let client: SupabaseClient | null = null;
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => {
    if (!client) throw new Error("catering-refund-inventory.test: no client set");
    return client;
  },
}));
let actorRole = "owner";
vi.mock("@/lib/session", () => ({
  requireSessionFromHeaders: async () => ({
    user: { id: "00000000-0000-4000-8000-0000000000f9", role: actorRole, language: "en" },
    session: {},
    role: actorRole,
    level: 9,
    locations: [],
  }),
}));
class NotFound extends Error {}
class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("not found");
  },
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

import { loadRefundInventory, refundInventoryFromRpc } from "@/lib/catering/refund-inventory";
import CateringRefundsInventoryPage from "@/app/admin/catering/refunds/page";
import { LeadRefundBanner, RefundsSwitch } from "@/components/catering/LeadRefundBanner";
import { cateringRefundsObserveOn, cateringRefundsOn } from "@/lib/catering/refunds-shared";
import { TranslationProvider } from "@/lib/i18n/provider";
import { harnessKit as kit, harnessLib, refundClient, refundDb, type RefundCall } from "./helpers/refund-pglite";
import en from "@/lib/i18n/en.json";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const EN = en as Record<string, string>;

beforeEach(() => {
  client = null;
  actorRole = "owner";
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A small population: known, never read, dirty (a ledger row after its read), and a not-settled checkout. */
async function population() {
  const db = await refundDb();
  const w = await kit.world(db);
  const claim = await kit.observing(db);
  const q = await w.quote();
  const known = await w.pay(q, "deposit", 30_000);
  const never = await w.pay(q, "balance", 20_000);
  const dirty = await w.pay(await w.quote(), "full", 10_000);
  const unsettled = await w.pay(await w.quote(), "full", 5_000, { status: "due", session: "cs_test_inventory_1" });
  await kit.read(db, known);
  await kit.read(db, dirty);
  await kit.ledger(db, { pi: dirty.pi, charge: dirty.charge });
  const calls: RefundCall[] = [];
  const sb = refundClient(db, { calls });
  return { db, claim, known, never, dirty, unsettled, sb, calls };
}

describe("loadRefundInventory on the REAL F15", () => {
  it("counts and lists a small population; ONE rpc and nothing else; ids and cents only", async () => {
    const c = await population();
    expect((await kit.figures(c.db, c.known.id)).state).toBe("known");
    const out = await loadRefundInventory(c.sb);
    expect(c.calls).toEqual([{ kind: "rpc", name: "catering_refund_inventory", args: {} }]);
    expect(out.state).toBe("ready");
    if (out.state !== "ready") return;
    const inv = out.inventory;
    expect(inv.counts).toMatchObject({ in_scope: 3, known: 1, never_read: 1, dirty: 1, paused: 0, unresolved_requests: 0, unbound_claims: 0 });
    expect(inv.unsettledCheckouts).toBe(1);
    expect(inv.lists.neverRead).toEqual([c.never.id]);
    expect(inv.lists.dirty).toEqual([c.dirty.id]);
    expect(inv.observation).toMatchObject({ observeOn: true, live: true, transitions: 1 });
    expect(inv.oldestUncheckedAt).not.toBeNull();
    // [T6] a claim with no finished pass: the claim is newer.
    expect(inv.observation.lastClaimAt).not.toBeNull();
    expect(inv.observation.lastPassEndedAt).toBeNull();
    expect(inv.observation.claimNewerThanPass).toBe(true);
  });

  it("[T6] after the pass-end stamp of the last claim, the warning clears and the read counts are carried", async () => {
    const c = await population();
    await kit.rpc(c.db, "catering_refund_sweep_end", [c.claim.claim_id, 3, 2]);
    const out = await loadRefundInventory(c.sb);
    if (out.state !== "ready") throw new Error("not ready");
    expect(out.inventory.observation).toMatchObject({ lastPassReads: 3, lastPassComplete: 2, lastPassIsOfLastClaim: true, claimNewerThanPass: false });
  });

  it("0359 not applied: not_installed (never an empty inventory); any other error throws", async () => {
    const db: PGlite = await harnessLib.base({ upTo: "0358" });
    expect(await loadRefundInventory(refundClient(db))).toEqual({ state: "not_installed" });
    const broken = refundClient(db, { rpc: { catering_refund_inventory: () => ({ data: null, error: { code: "XX000", message: "boom" } }) } });
    await expect(loadRefundInventory(broken)).rejects.toThrow(/catering_refund_inventory/);
  });

  it("the mapper fails safe: no observation row reads OFF, not live, no claim", () => {
    const inv = refundInventoryFromRpc({ observation: null, counts: {}, lists: {} });
    expect(inv.observation).toMatchObject({ observeOn: false, live: false, lastClaimAt: null, claimNewerThanPass: false });
    expect(inv.counts.paused).toBe(0);
  });
});

describe("the page", () => {
  it("CATERING_REFUNDS_OBSERVE unset: notFound() for everyone (owner included), and nothing is read", async () => {
    const c = await population();
    client = c.sb;
    for (const role of ["owner", "cgs", "gm", "moo"]) {
      actorRole = role;
      await expect(CateringRefundsInventoryPage()).rejects.toBeInstanceOf(NotFound);
    }
    expect(c.calls).toHaveLength(0);
  });

  it("switch on: anyone but Owner / CGS gets the house admin refusal, by role; nothing is read", async () => {
    vi.stubEnv("CATERING_REFUNDS_OBSERVE", "1");
    const c = await population();
    client = c.sb;
    for (const role of ["moo", "gm", "agm", "catering_mgr"]) {
      actorRole = role;
      const err = await CateringRefundsInventoryPage().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Redirect);
      expect((err as Redirect).to).toBe("/admin/catering");
    }
    expect(c.calls).toHaveLength(0);
  });

  it.each(["owner", "cgs"])("%s: renders claim AND finished pass, the warning when the claim is newer, and no control that mutates", async (role) => {
    vi.stubEnv("CATERING_REFUNDS_OBSERVE", "1");
    const c = await population();
    client = c.sb;
    actorRole = role;
    const html = renderToStaticMarkup(await CateringRefundsInventoryPage());
    expect(html).toContain(EN["admin.cateringRefunds.observation.last_claim"]);
    expect(html).toContain(EN["admin.cateringRefunds.observation.last_pass"]);
    expect(html).toContain('data-testid="inventory-claim-newer"');
    expect(html).toContain(EN["admin.cateringRefunds.observation.claim_newer"]);
    expect(html).toContain(c.never.id);
    expect(html).toContain(c.dirty.id);
    expect(html).toContain(EN["admin.cateringRefunds.signoff.rule"]!.replace(/'/g, "&#x27;").replace(/"/g, "&quot;"));
    expect(html).toContain("NOT covered: 1 checkouts are not settled");
    for (const tag of ["<button", "<form", "<input", "<textarea", "<select", "<a "]) expect(html, tag).not.toContain(tag);
    // After the pass-end stamp the warning is gone and the pass is shown with its counts.
    await kit.rpc(c.db, "catering_refund_sweep_end", [c.claim.claim_id, 4, 3]);
    const again = renderToStaticMarkup(await CateringRefundsInventoryPage());
    expect(again).not.toContain('data-testid="inventory-claim-newer"');
    expect(again).toContain("4 reads, 3 complete");
  });

  it("the page source: read only (no client island, no Stripe, no write), no nav link to it", () => {
    const src = readFileSync("app/admin/catering/refunds/page.tsx", "utf8");
    expect(src).not.toMatch(/"use client"|onClick|<form|<button|stripe\/|fetch\(/);
    expect(src.match(/loadRefundInventory\(/g)).toHaveLength(1);
    const hub = readFileSync("app/admin/catering/page.tsx", "utf8");
    expect(hub).not.toContain("/admin/catering/refunds");
  });
});

describe("OFF parity (UI): both switches unset = no refund UI and no refund request", () => {
  it("the switches read unset as off", () => {
    expect(cateringRefundsOn({})).toBe(false);
    expect(cateringRefundsObserveOn({})).toBe(false);
  });

  it("the quote page mounts the panel only behind CATERING_REFUNDS, and passes the switch as a prop", () => {
    const page = readFileSync("app/(authed)/catering/quotes/page.tsx", "utf8");
    expect(page).toContain("const refundsEnabled = cateringRefundsOn(process.env);");
    const quotes = readFileSync("components/catering/quotes/QuotesClient.tsx", "utf8");
    expect(quotes).toContain("refundsEnabled = false");
    expect(quotes.match(/<RefundPanel\b/g)).toHaveLength(1);
    expect(quotes).toMatch(/\{refundsEnabled && \(\s*<RefundPanel\b/);
  });

  it("the pipeline wraps the board in the switch, and with it off (or absent) the banner renders nothing", () => {
    // The effect-level proof (switch off or absent: no fetch at all) is in tests/catering-refund-panel-ui.test.ts
    // (jsdom); this file runs on node for PGlite, so it checks the markup and the mount sites.
    const page = readFileSync("app/(authed)/catering/pipeline/page.tsx", "utf8");
    expect(page).toContain("<RefundsSwitch on={cateringRefundsOn(process.env)}>");
    const pipeline = readFileSync("components/catering/pipeline/PipelineClient.tsx", "utf8");
    expect(pipeline.match(/<LeadRefundBanner\b/g)).toHaveLength(2);
    const wrap = (child: unknown) => jsx(TranslationProvider, { initialLanguage: "en", children: child });
    expect(renderToStaticMarkup(wrap(jsx(RefundsSwitch, { on: false, children: jsx(LeadRefundBanner, { leadId: "00000000-0000-4000-8000-0000000000d1", phase: "lost" }) })))).toBe("");
    expect(renderToStaticMarkup(wrap(jsx(LeadRefundBanner, { leadId: "00000000-0000-4000-8000-0000000000d1", phase: "confirming_lost" })))).toBe("");
  });
});
