import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { marketingRefusalCopy, marketingWriteCopy } from "@/lib/marketing/write-copy";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), audit: vi.fn(), baseline: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.db }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/marketing/scorecard", () => ({ buildMarketingBaseline: mocks.baseline }));
import { marketingRefusals } from "@/lib/marketing/write";
const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };
const cases = [
  ["milestones", "B", "marketing.milestone_record", { kind: "first_ad_spend", date: "2026-11-01" }],
  ["milestones/[id]/correct", "B", "marketing.milestone_correct", { kind: "first_ad_spend", date: "2026-11-01", reason: "correction text" }],
  ["entries", "A", "marketing.manual_entry_record", { kind: "meta_spend", from: "2026-11-01", to: "2026-11-07", amountCents: 100, note: "private note" }],
  ["entries/[id]/correct", "A", "marketing.manual_entry_correct", { kind: "meta_spend", from: "2026-11-01", to: "2026-11-07", amountCents: 100, reason: "correction text" }],
  ["baseline-snapshot", "B", "marketing.baseline_snapshot", { payload: "client-forgery", coverage: "client-forgery" }],
] as const;
function request(path: string, body: unknown, origin = "http://localhost") { return new NextRequest(`http://localhost/api/admin/marketing/${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }); }
const ctx = (role = "moo", fresh = true, unlocked = true) => ({ user: { id, role }, role, level: 9, locations: [], session: { stepUpUnlocked: unlocked, stepUpUnlockedAt: new Date(Date.now() - (fresh ? 1000 : 3600000)).toISOString() } });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("MARKETING_SCORECARD", "1"); mocks.session.mockResolvedValue(ctx()); mocks.db.mockReturnValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: id, error: null }); mocks.baseline.mockResolvedValue({ milestoneId: id, from: "2026-10-04", to: "2026-10-31", kpiVersion: 1, payload: { authoritative: true }, coverage: { capturedDays: 28 } }); });
afterEach(() => vi.unstubAllEnvs());
describe.each(cases)("%s", (path, tier, action, body) => {
  const load = async () => (await import(/* @vite-ignore */ `../app/api/admin/marketing/${path}/route.ts`)).POST;
  it("rejects origin before session or body reads", async () => { const req = request(path, body, "https://attacker.invalid"); const read = vi.spyOn(req, "json"); expect((await (await load())(req, context)).status).toBe(403); expect(read).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled(); });
  it.each(["gm", "social_media_mgr", "employee"])("refuses %s before I/O", async role => { mocks.session.mockResolvedValue(ctx(role)); const response = await (await load())(request(path, body), context); expect(response.status).toBe(403); expect((await response.json()).code).toBe("role_not_allowed"); expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.baseline).not.toHaveBeenCalled(); });
  it("requires unlock", async () => { mocks.session.mockResolvedValue(ctx("moo", true, false)); expect((await (await load())(request(path, body), context)).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it("enforces the specified freshness tier", async () => { mocks.session.mockResolvedValue(ctx("moo", false)); expect((await (await load())(request(path, body), context)).status).toBe(tier === "B" ? 403 : 201); });
  it("ships off without database access", async () => { vi.stubEnv("MARKETING_SCORECARD", "0"); expect((await (await load())(request(path, body), context)).status).toBe(503); expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.baseline).not.toHaveBeenCalled(); });
  it.each(["42P01", "42883", "PGRST202"])("maps missing schema %s to unavailable", async code => { mocks.rpc.mockResolvedValue({ data: null, error: { code } }); const response = await (await load())(request(path, body), context); expect(response.status).toBe(503); expect((await response.json()).code).toBe("marketing_unavailable"); expect(mocks.audit).not.toHaveBeenCalled(); });
  it("sanitizes RPC transport failures", async () => { mocks.rpc.mockRejectedValue(new Error("private transport details")); const response = await (await load())(request(path, body), context); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private"); expect(mocks.audit).not.toHaveBeenCalled(); });
  it("audits successful RPC only and excludes free text", async () => { expect((await (await load())(request(path, body), context)).status).toBe(201); expect(mocks.audit).toHaveBeenCalledOnce(); expect(mocks.audit.mock.calls[0]![0]).toMatchObject({ action, actorId: id }); expect(JSON.stringify(mocks.audit.mock.calls[0])).not.toMatch(/private note|correction text|client-forgery/); expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.audit.mock.invocationCallOrder[0]!); });
  it.each(marketingRefusals)("returns named refusal %s without audit", async refusal => { mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: refusal } }); const response = await (await load())(request(path, body), context); expect((await response.json()).code).toBe(refusal); expect(mocks.audit).not.toHaveBeenCalled(); });
});
it("recomputes baseline on the server, never trusts client numbers", async () => { const { POST } = await import("@/app/api/admin/marketing/baseline-snapshot/route"); await POST(request("baseline-snapshot", { payload: "client-forgery", coverage: "client-forgery", milestoneId: "client-forgery" })); expect(mocks.rpc).toHaveBeenCalledWith("record_marketing_baseline_snapshot", expect.objectContaining({ p_payload: { authoritative: true }, p_milestone_id: id, p_coverage: { capturedDays: 28 } })); });
it("has matching bilingual fields and human-readable SQL refusals", () => { expect(Object.keys(marketingWriteCopy("es"))).toEqual(Object.keys(marketingWriteCopy("en"))); for (const code of marketingRefusals) for (const lang of ["en", "es"] as const) { expect(marketingRefusalCopy(lang, code)).not.toBe(code); expect(marketingRefusalCopy(lang, code)).not.toBe(marketingWriteCopy(lang).failed); } });
