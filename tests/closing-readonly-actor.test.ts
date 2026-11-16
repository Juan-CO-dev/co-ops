import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { rowToInstance, type InstanceRow } from "@/lib/checklist-rows";

const h = vi.hoisted(() => ({
  auth: vi.fn(), actor: vi.fn(), create: vi.fn(), reconcile: vi.fn(), db: {} as unknown,
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: h.auth }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db }));
vi.mock("@/lib/checklist-write-actor", async (original) => ({
  ...await original<typeof import("@/lib/checklist-write-actor")>(),
  resolveChecklistWriteActor: h.actor,
}));
vi.mock("@/lib/checklists", () => ({
  getOrCreateInstance: h.create, canEditReport: vi.fn(), loadChecklistChainAttribution: vi.fn(),
}));
vi.mock("@/lib/prep", () => ({ reconcileClosingReportRefs: h.reconcile }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn() }));
vi.mock("@/lib/reports-hub", () => ({ loadLocationTempItemIds: async () => new Map() }));
vi.mock("@/lib/am-prep-gap-shared", () => ({ amPrepGapNoteDue: () => false }));
vi.mock("@/lib/operational-day", () => ({ etCalendarDate: () => "2026-10-19" }));
vi.mock("@/lib/admin/template-builder-shared", () => ({ applyEffectiveResolution: (query: unknown) => query }));
vi.mock("@/lib/i18n/server", () => ({ serverT: (_language: string, key: string) => key }));
vi.mock("@/components/ActionButton", () => ({ ActionLink: () => null }));
vi.mock("@/app/(authed)/operations/closing/closing-client", () => ({ ClosingClient: () => null }));

import ClosingPage from "@/app/(authed)/operations/closing/page";
import { ChecklistActorNotAuthorizedError, ChecklistActorTransientError } from "@/lib/checklist-write-actor";
import { ClosingClient } from "@/app/(authed)/operations/closing/closing-client";

const shop = "10000000-0000-4000-8000-000000000001";
const instance: InstanceRow = {
  id: "closing", template_id: "template", location_id: shop, date: "2026-10-19",
  shift_start_at: null, status: "open", confirmed_at: null, confirmed_by: null,
  created_at: "2026-10-19T12:00:00Z", triggered_by_user_id: null, triggered_at: null,
  finalized_at_actor_type: null, assigned_to: null, assignment_locked: false,
  dropped_at: null, dropped_by: null, dropped_reason: null,
};
let db: ReturnType<typeof createFakeDb>;
function fixtures(existing = true) {
  db = createFakeDb({
    locations: [{ id: shop, name: "Shop", code: "SHOP", active: true }],
    checklist_templates: [{ id: "template", location_id: shop, type: "closing" }],
    // allows_multiple_per_day: the real column (default false) the day-instance read filters on (W15/B086).
    checklist_instances: existing ? [{ ...instance, allows_multiple_per_day: false }] : [],
    checklist_template_items: [], checklist_completions: [],
  });
  h.db = db.client;
}
function auth(role: string, level: number, member: boolean) {
  h.auth.mockResolvedValue({ role, level, locations: member ? [shop] : [], user: { id: "viewer", language: "en" } });
  h.actor.mockResolvedValue({ role, level, active: true, userId: "viewer", sessionId: "session", locations: member ? [shop] : [] });
}
const page = () => ClosingPage({ searchParams: Promise.resolve({ location: shop }) });
function expectNoWrites() {
  expect(h.create).not.toHaveBeenCalled();
  expect(h.reconcile).not.toHaveBeenCalled();
  expect(db.writes).toEqual([]);
}
beforeEach(() => {
  vi.resetAllMocks();
  fixtures();
  h.create.mockResolvedValue({ instance: rowToInstance(instance), created: false });
});

describe("closing page read authority without write authority", () => {
  // Audit W05B (Juan 2026-11-15): level 8+ work the closing at any shop, so a non-member MoO / owner / CGS
  // gets the write UI (and starts today's close) where they used to get the read-only view.
  // Merge-fix (W15/B084): an existing close is served as it is (instance first, no create call) and
  // still reconciled under the writer path.
  it.each([["moo", 8], ["owner", 9], ["cgs", 10]] as const)("renders the existing close WRITABLE for nonmember %s", async (role, level) => {
    auth(role, level, false);
    const tree = await page();
    expect(tree.type).toBe(ClosingClient);
    expect(tree.props.initialState).toMatchObject({ readOnly: false, instance: { id: instance.id } });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.reconcile).toHaveBeenCalledOnce();
    expect(h.reconcile.mock.calls[0]![1]).toMatchObject({ locationId: shop, closingInstanceId: instance.id, actor: { role, level } });
  });

  it.each([["moo", 8], ["owner", 9], ["cgs", 10]] as const)("starts today's close for nonmember %s (no no-instance dead end)", async (role, level) => {
    fixtures(false);
    auth(role, level, false);
    const tree = await page();
    expect(tree.type).toBe(ClosingClient);
    expect(tree.props.initialState.readOnly).toBe(false);
    expect(h.create).toHaveBeenCalledOnce();
  });

  it.each([["gm", 7], ["agm", 6], ["social_media_mgr", 6], ["key_holder", 4]] as const)("still redirects a nonmember %s (below 8 the shop is required)", async (role, level) => {
    auth(role, level, false);
    await expect(page()).rejects.toThrow("redirect:/dashboard");
    expectNoWrites();
  });

  it("an INACTIVE level-8+ write actor stays read-only (the session already refuses inactive users)", async () => {
    auth("moo", 8, false);
    h.actor.mockResolvedValue({ role: "moo", level: 8, active: false, userId: "viewer", sessionId: "session", locations: [] });
    const tree = await page();
    expect(tree.props.initialState.readOnly).toBe(true);
    expectNoWrites();
  });

  it.each([true, false])("falls back to read-only when actor resolution refuses (existing=%s)", async (existing) => {
    fixtures(existing);
    auth("owner", 9, true);
    h.actor.mockRejectedValue(new ChecklistActorNotAuthorizedError());
    const tree = await page();
    if (existing) {
      expect(tree.type).toBe(ClosingClient);
      expect(tree.props.initialState.readOnly).toBe(true);
    } else {
      expect(renderToStaticMarkup(tree)).toContain("closing.no_instance.body");
    }
    expectNoWrites();
  });

  it.each([true, false])("sends transient actor failures to the error boundary (existing=%s)", async (existing) => {
    fixtures(existing);
    auth("owner", 9, true);
    const error = new ChecklistActorTransientError();
    h.actor.mockRejectedValue(error);
    await expect(page()).rejects.toBe(error);
    expectNoWrites();
  });

  it("does not swallow an unexpected resolver failure", async () => {
    auth("owner", 9, true);
    h.actor.mockRejectedValue(new Error("unexpected resolver failure"));
    await expect(page()).rejects.toThrow("unexpected resolver failure");
    expectNoWrites();
  });

  it("keeps a member trainee's existing close interactive without creating", async () => {
    auth("trainee", 2, true);
    const tree = await page();
    expect(tree.type).toBe(ClosingClient);
    expect(tree.props.initialState.readOnly).toBe(false);
    expectNoWrites();
  });

  it("preserves the member owner's create/reconcile path", async () => {
    fixtures(false);
    auth("owner", 9, true);
    const tree = await page();
    expect(tree.props.initialState.readOnly).toBe(false);
    expect(h.create).toHaveBeenCalledOnce();
    expect(h.reconcile).toHaveBeenCalledOnce();
  });

  it("W15/B084: today's existing close is used as it is (no create call), and still reconciled", async () => {
    auth("owner", 9, true);
    const tree = await page();
    expect(tree.props.initialState).toMatchObject({ readOnly: false, instance: { id: instance.id } });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.reconcile).toHaveBeenCalledOnce();
  });
});

