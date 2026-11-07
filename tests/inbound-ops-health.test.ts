import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
const h = vi.hoisted(() => ({ db: vi.fn(), audit: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.db }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/session", () => ({ requireSession: h.session }));
import { loadInboundHealth, redriveInbound } from "@/lib/admin/ops-health";
import { POST } from "@/app/api/admin/inbound/redrive/route";
const ID = "11111111-1111-4111-8111-111111111111";
const actor = (role: RoleCode) => ({ user: { id: "actor", role }, locations: [], level: 10, session: { stepUpUnlocked: true } }) as unknown as AuthContext;
let tables: Tables;
beforeEach(() => {
  vi.clearAllMocks();
  tables = { inbound_messages: [{ id: ID, content_state: "failed", fetch_attempts: 5, next_attempt_at: "2026-01-01T00:00:00Z", lease_token: null }] };
  h.db.mockReturnValue(createFakeDb(tables).client); h.session.mockResolvedValue(actor("moo"));
});
it.each(["failed", "blocked_config"])("MoO re-drives %s with reset and audit", async state => {
  tables.inbound_messages![0]!.content_state = state;
  await redriveInbound(actor("moo"), ID);
  expect(tables.inbound_messages![0]).toMatchObject({ content_state: "pending", fetch_attempts: 0, last_error: null });
  expect(Date.parse(String(tables.inbound_messages![0]!.next_attempt_at))).toBeGreaterThan(Date.now() - 5000);
  expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "inbound.redrive", metadata: expect.objectContaining({ before: expect.objectContaining({ content_state: state }), after: expect.objectContaining({ content_state: "pending" }) }) }));
});
it.each(["gm", "social_media_mgr", "employee"] as const)("refuses %s before I/O", async role => {
  await expect(redriveInbound(actor(role), ID)).rejects.toMatchObject({ status: 403 });
  await expect(loadInboundHealth(actor(role))).rejects.toMatchObject({ status: 403 });
  expect(h.db).not.toHaveBeenCalled();
});
it("does not reset a fetched or actively leased row", async () => {
  tables.inbound_messages![0]!.content_state = "fetched";
  await expect(redriveInbound(actor("moo"), ID)).rejects.toMatchObject({ status: 409 });
  tables.inbound_messages![0]!.content_state = "failed";
  tables.inbound_messages![0]!.lease_token = "worker";
  await expect(redriveInbound(actor("moo"), ID)).rejects.toMatchObject({ status: 409 });
  expect(h.audit).not.toHaveBeenCalled();
});
it("health returns failures and config blocks, excluding completed rows", async () => {
  tables.inbound_messages!.push({ id: "blocked", content_state: "blocked_config" }, { id: "done", content_state: "fetched" });
  const health = await loadInboundHealth(actor("moo"));
  expect(health.rows.map(row => row.id)).toEqual([ID, "blocked"]);
  expect(health.count).toBe(2);
});
it("route rejects cross-origin and locked step-up", async () => {
  const req = (origin: string) => new NextRequest("https://fixture.test/api/admin/inbound/redrive", { method: "POST", headers: { origin }, body: JSON.stringify({ id: ID }) });
  expect((await POST(req("https://other.test"))).status).toBe(403);
  expect(h.session).not.toHaveBeenCalled();
  h.session.mockResolvedValue({ ...actor("moo"), session: { stepUpUnlocked: false } });
  expect((await POST(req("https://fixture.test"))).status).toBe(403);
  expect(h.db).not.toHaveBeenCalled();
});
