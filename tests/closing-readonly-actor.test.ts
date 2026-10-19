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
import { ChecklistActorNotAuthorizedError } from "@/lib/checklist-write-actor";
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
    checklist_instances: existing ? [{ ...instance }] : [],
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
  it.each([["owner", 9], ["cgs", 10]] as const)("renders existing close read-only for nonmember %s", async (role, level) => {
    auth(role, level, false);
    const tree = await page();
    expect(tree.type).toBe(ClosingClient);
    expect(tree.props.initialState).toMatchObject({ readOnly: true, instance: { id: instance.id } });
    expectNoWrites();
  });

  it.each([["owner", 9], ["cgs", 10]] as const)("shows no-instance for nonmember %s without creating", async (role, level) => {
    fixtures(false);
    auth(role, level, false);
    expect(renderToStaticMarkup(await page())).toContain("closing.no_instance.body");
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
    auth("owner", 9, true);
    const tree = await page();
    expect(tree.props.initialState.readOnly).toBe(false);
    expect(h.create).toHaveBeenCalledOnce();
    expect(h.reconcile).toHaveBeenCalledOnce();
  });
});

