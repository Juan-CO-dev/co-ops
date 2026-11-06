import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { pickShopId } from "@/lib/shop-context-shared";
import { EMPTY_PAR_SILENCE } from "@/lib/dynamic-pars-shared";
const h = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), db: vi.fn(), resolve: vi.fn(), prep: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: h.auth }));
vi.mock("@/lib/admin/pars", () => ({ loadPars: h.load }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.db }));
vi.mock("@/lib/shop-context", () => ({ resolveShopId: h.resolve }));
vi.mock("@/lib/ordering", () => ({ OrderingError: class extends Error { constructor(public status: number, public code: string) { super(code); } } }));
vi.mock("@/components/admin/pars/ParsClient", () => ({ ParsClient: () => null }));
vi.mock("@/lib/admin/templates", () => ({ loadChecklistLocationView: h.prep }));
import Page from "@/app/admin/pars/page";
import { OrderingError } from "@/lib/ordering";
const A = "6f1d2c3e-0000-4000-8000-00000000000a", B = "6f1d2c3e-0000-4000-8000-00000000000b";
beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { role: "agm", language: "en" }, level: 6, locations: [A, B] });
  h.db.mockReturnValue(createFakeDb({ locations: [{ id: A, name: "A shop", active: true }, { id: B, name: "B shop", active: true }] }).client);
  h.resolve.mockImplementation(async (allowed: string[], explicit?: string) => pickShopId({ allowed, explicit, remembered: B }));
  h.load.mockResolvedValue({ rows: [], silence: EMPTY_PAR_SILENCE });
});
it.each(["social_media_mgr", "key_holder", "shift_lead"])("refuses %s before page I/O", async (role) => {
  h.auth.mockResolvedValue({ user: { role, language: "en" }, level: 10, locations: [A] });
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/dashboard");
  expect(h.db).not.toHaveBeenCalled(); expect(h.load).not.toHaveBeenCalled();
});
it.each([4, 5])("the unchanged admin layout refuses level %s", async (level) => {
  const { default: AdminLayout } = await import("@/app/admin/layout");
  h.auth.mockResolvedValue({ user: { role: level === 4 ? "key_holder" : "shift_lead", language: "en" }, level, locations: [A] });
  await expect(AdminLayout({ children: null })).rejects.toThrow("redirect:/dashboard");
  expect(h.db).not.toHaveBeenCalled();
});
it("resolves remembered shop inside the allowed list and loads exactly that shop", async () => {
  await Page({ searchParams: Promise.resolve({}) });
  expect(h.resolve).toHaveBeenCalledWith([A, B], undefined);
  expect(h.load).toHaveBeenCalledWith(await h.auth.mock.results[0]!.value, B);
});
it("explicit shop wins and repeated query parameters revert to the resolver", async () => {
  await Page({ searchParams: Promise.resolve({ location: A }) });
  expect(h.load).toHaveBeenLastCalledWith(await h.auth.mock.results[0]!.value, A);
  await Page({ searchParams: Promise.resolve({ location: [A, B] }) });
  expect(h.load).toHaveBeenLastCalledWith(await h.auth.mock.results[0]!.value, B);
});
it("rejects explicit foreign shops before querying; remembered foreign shops never enter candidates", async () => {
  h.auth.mockResolvedValue({ user: { role: "agm", language: "en" }, level: 6, locations: [A] });
  await expect(Page({ searchParams: Promise.resolve({ location: B }) })).rejects.toThrow("redirect:/dashboard");
  expect(h.db).not.toHaveBeenCalled();
  await Page({ searchParams: Promise.resolve({}) });
  expect(h.resolve).toHaveBeenCalledWith([A], undefined);
  expect(h.load).toHaveBeenCalledWith(await h.auth.mock.results[0]!.value, A);
});
it("refuses inactive explicit shops even for the owner", async () => {
  h.auth.mockResolvedValue({ user: { role: "owner", language: "en" }, level: 9, locations: [] });
  await expect(Page({ searchParams: Promise.resolve({ location: "6f1d2c3e-0000-4000-8000-00000000000c" }) })).rejects.toThrow("redirect:/dashboard");
  expect(h.load).not.toHaveBeenCalled();
});
it.each([403, 404])("turns loader refusal %s into the existing dashboard redirect", async (status) => {
  h.load.mockRejectedValueOnce(new OrderingError(status, "forbidden"));
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/dashboard");
});
it("does not hide operational read failures as a permission refusal", async () => {
  h.load.mockRejectedValueOnce(new Error("fixture unavailable"));
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("fixture unavailable");
});
it("does not load data when there are no allowed active shops", async () => {
  h.auth.mockResolvedValue({ user: { role: "agm", language: "en" }, level: 6, locations: [] });
  await Page({ searchParams: Promise.resolve({}) });
  expect(h.load).not.toHaveBeenCalled();
});

it("loads only the resolved shop through the checklist reader for the URL prep tab", async () => {
  h.prep.mockResolvedValue({ items: [], parContext: {} });
  const result = await Page({ searchParams: Promise.resolve({ tab: "prep", location: A }) });
  expect(h.load).not.toHaveBeenCalled();
  expect(h.prep.mock.calls.map((call) => [call[1].id, call[2]])).toEqual([[A, "am_prep"], [A, "mid_day_prep"]]);
  expect(result.props.children[2].props.tab).toBe("prep");
  expect(result.props.children[2].props.children.props.views.map((view: { subtype: string }) => view.subtype)).toEqual(["am_prep", "mid_day_prep"]);
});

it.each(["agm", "prep_mgr", "catering_mgr", "gm"])("Prep tab gives %s the shared own-shop edit permission", async (role) => {
  h.auth.mockResolvedValue({ user: { role, language: "en" }, locations: [A] });
  h.prep.mockResolvedValue({ items: [], parContext: {} });
  const result = await Page({ searchParams: Promise.resolve({ tab: "prep", location: A }) });
  expect(result.props.children[2].props.children.props.canEdit).toBe(true);
});
