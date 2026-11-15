/**
 * W15/B086 + B084 — the day's checklist instance is found on ANY version (active or retired).
 *   B086: retiring the version that served a past day hid that day's closing ("no template").
 *   B084: an apply-now publish between a closer's first open and their refresh made the page
 *         create a SECOND closing on the new version; now the existing one is used.
 * The page runs with the REAL effective resolver over the in-memory fake DB.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import { rowToInstance, type InstanceRow } from "@/lib/checklist-rows";
import { findDayInstance, pickDayInstance } from "@/lib/checklist-day-instance";

const h = vi.hoisted(() => ({ auth: vi.fn(), actor: vi.fn(), create: vi.fn(), reconcile: vi.fn(), db: {} as unknown }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: h.auth }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db }));
vi.mock("@/lib/checklist-write-actor", async (original) => ({
  ...await original<typeof import("@/lib/checklist-write-actor")>(),
  resolveChecklistWriteActor: h.actor,
}));
vi.mock("@/lib/checklists", () => ({
  getOrCreateInstance: h.create, canEditReport: vi.fn(), loadChecklistChainAttribution: vi.fn(),
  ChecklistLineageTakenError: class extends Error {},
}));
vi.mock("@/lib/prep", () => ({ reconcileClosingReportRefs: h.reconcile }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn() }));
vi.mock("@/lib/reports-hub", () => ({ loadLocationTempItemIds: async () => new Map() }));
vi.mock("@/lib/am-prep-gap-shared", () => ({ amPrepGapNoteDue: () => false }));
vi.mock("@/lib/operational-day", () => ({ etCalendarDate: () => "2026-10-21" }));
vi.mock("@/lib/i18n/server", () => ({ serverT: (_language: string, key: string) => key }));
vi.mock("@/components/ActionButton", () => ({ ActionLink: () => null }));
vi.mock("@/app/(authed)/operations/closing/closing-client", () => ({ ClosingClient: () => null }));

import ClosingPage from "@/app/(authed)/operations/closing/page";
import { ClosingClient } from "@/app/(authed)/operations/closing/closing-client";

const shop = "10000000-0000-4000-8000-000000000001";
type FakeInstance = InstanceRow & { allows_multiple_per_day: boolean } & Record<string, unknown>;
const inst = (id: string, template: string, date: string, over: Partial<InstanceRow> = {}): FakeInstance => ({
  id, template_id: template, location_id: shop, date, shift_start_at: null, status: "open", confirmed_at: null,
  confirmed_by: null, created_at: `${date}T20:00:00Z`, triggered_by_user_id: null, triggered_at: null,
  finalized_at_actor_type: null, assigned_to: null, assignment_locked: false, dropped_at: null, dropped_by: null,
  dropped_reason: null, allows_multiple_per_day: false, ...over,
});
const tpl = (id: string, active: boolean, effectiveFrom: string, createdAt = `${effectiveFrom}T00:00:00Z`) =>
  ({ id, location_id: shop, type: "closing", name: "Closing", active, effective_from: effectiveFrom, created_at: createdAt });

let tables: Tables;
let db: ReturnType<typeof createFakeDb>;
function setup(t: Tables) {
  tables = { locations: [{ id: shop, name: "Shop", code: "SHOP", active: true }], checklist_template_items: [], checklist_completions: [],
    checklist_incomplete_reasons: [], ...t };
  db = createFakeDb(tables);
  h.db = db.client;
}
const page = (date?: string) => ClosingPage({ searchParams: Promise.resolve({ location: shop, ...(date ? { date } : {}) }) });
beforeEach(() => {
  vi.resetAllMocks();
  h.auth.mockResolvedValue({ role: "gm", level: 7, locations: [shop], user: { id: "gm", language: "en" } });
  h.actor.mockResolvedValue({ role: "gm", level: 7, active: true, userId: "gm", sessionId: "s", locations: [shop] });
});

describe("pickDayInstance", () => {
  it("a finished instance wins over one still open, then the oldest, then the lowest id", () => {
    const a = { id: "b", template_id: "t1", status: "open", created_at: "2026-10-01T10:00:00Z" };
    const b = { id: "a", template_id: "t2", status: "confirmed", created_at: "2026-10-01T12:00:00Z" };
    const c = { id: "c", template_id: "t2", status: "open", created_at: "2026-10-01T09:00:00Z" };
    expect(pickDayInstance([a, b, c])).toBe(b);
    expect(pickDayInstance([a, c])).toBe(c);
    expect(pickDayInstance([{ ...a, id: "z" }, { ...a, id: "y" }])!.id).toBe("y");
    expect(pickDayInstance([])).toBeNull();
  });
});

describe("W15/B086 a retired version no longer hides a past closing", () => {
  it("Monday's closing renders from its instance's retired version", async () => {
    setup({
      checklist_templates: [tpl("V1", false, "2026-01-01"), tpl("V2", true, "2026-10-20"), tpl("V3", true, "2026-10-21")],
      checklist_instances: [inst("monday", "V1", "2026-10-19", { status: "confirmed" })],
      checklist_template_items: [{ id: "v1-item", template_id: "V1", active: true, label: "Mop", display_order: 1 }],
    });
    const tree = await page("2026-10-19");
    expect(tree.type).toBe(ClosingClient);
    expect(tree.props.initialState.instance).toMatchObject({ id: "monday", templateId: "V1" });
    expect(tree.props.initialState.templateItems.map((i: { id: string }) => i.id)).toEqual(["v1-item"]);
  });

  it("findDayInstance reads any version and ignores other shops and mid-day instances", async () => {
    setup({
      checklist_templates: [tpl("V1", false, "2026-01-01"), { ...tpl("X", true, "2026-01-01"), location_id: "other" }],
      checklist_instances: [inst("monday", "V1", "2026-10-19"), inst("other", "X", "2026-10-19", { location_id: "other" }),
        inst("multi", "V1", "2026-10-19", { allows_multiple_per_day: true } as Partial<InstanceRow>)],
    });
    const found = await findDayInstance<InstanceRow>(db.client as never, { locationId: shop, type: "closing", date: "2026-10-19", columns: "id, template_id, status, created_at" });
    expect(found?.id).toBe("monday");
  });

  it("the opening's prior-closing check reads yesterday's closing on any version", () => {
    const src = readFileSync("app/(authed)/operations/opening/page.tsx", "utf8");
    const fn = src.slice(src.indexOf("async function loadPriorClosingState"), src.indexOf("interface OpeningPageProps"));
    expect(fn.indexOf("findDayInstance")).toBeGreaterThan(-1);
    expect(fn.indexOf("findDayInstance")).toBeLessThan(fn.indexOf("applyEffectiveResolution"));
  });
});

describe("W15/B084 today's closing started on a version an apply-now publish then retired", () => {
  it("the page uses the instance already started (T1) instead of creating a second on T2", async () => {
    setup({
      checklist_templates: [tpl("T1", false, "2026-01-01"), tpl("T2", true, "2026-10-21")],
      checklist_instances: [inst("A", "T1", "2026-10-21")],
      checklist_template_items: [{ id: "t1-item", template_id: "T1", active: true, label: "Mop", display_order: 1 },
        { id: "t2-item", template_id: "T2", active: true, label: "Mop", display_order: 1 }],
    });
    h.create.mockResolvedValue({ instance: rowToInstance(inst("B", "T2", "2026-10-21") as InstanceRow), created: true });
    const tree = await page();
    expect(h.create).not.toHaveBeenCalled();
    expect(tree.props.initialState.instance).toMatchObject({ id: "A", templateId: "T1" });
    expect(tree.props.initialState.templateItems.map((i: { id: string }) => i.id)).toEqual(["t1-item"]);
  });

  it("a day with no instance still creates on the effective version", async () => {
    setup({ checklist_templates: [tpl("T1", false, "2026-01-01"), tpl("T2", true, "2026-10-21")], checklist_instances: [] });
    h.create.mockResolvedValue({ instance: rowToInstance(inst("B", "T2", "2026-10-21") as InstanceRow), created: true });
    await page();
    expect(h.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ templateId: "T2", date: "2026-10-21" }));
  });
});
