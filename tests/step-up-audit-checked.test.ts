/**
 * Astra full-branch review #2 — the step-up POST's success path uses a CHECKED audit. The real
 * audit() is fail-open (it resolves even when its insert fails), so a post-mint cleanup keyed on
 * a throw never ran: the grant stayed live and the clock was stamped with no success row. Here
 * the REAL audit helper runs over the predicate-aware fake with audit_log inserts failing: the
 * response is a 500, the grant is voided, and neither clock is stamped.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "./fake-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./fake-supabase").FakeDb, session: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireSession: h.session }));
vi.mock("@/lib/auth", () => ({ verifyPassword: async () => true }));
vi.mock("@/lib/auth-flows", () => ({ upgradeLegacyPasswordHash: async () => undefined }));

import { POST } from "@/app/api/auth/step-up/route";
import { audit, auditChecked } from "@/lib/audit";

const SESSION = "5e551011-0000-4000-8000-000000000001";
const USER = "05e20001-0000-4000-8000-000000000001";
const T = "7a12e700-0000-4000-8000-000000000001";

beforeEach(() => {
  h.db = fakeSupabase({
    sessions: [{ id: SESSION, step_up_unlocked: false, step_up_unlocked_at: null, catalog_edit_unlocked_at: null }],
    users: [{ id: USER, password_hash: "hmac2$stored" }],
    step_up_grants: [],
    audit_log: [],
  });
  h.session.mockResolvedValue({ user: { id: USER, role: "gm" }, session: { id: SESSION } });
});
const call = (body: unknown) => POST(new NextRequest("http://localhost/api/auth/step-up", { method: "POST", body: JSON.stringify(body) }));
const session = () => (h.db.tables.sessions as Row[])[0]!;
const grants = () => h.db.tables.step_up_grants as Row[];

describe("auditChecked reports what audit() swallows", () => {
  it("audit() stays fail-open; auditChecked returns failed", async () => {
    h.db.failInsertTables = ["audit_log"];
    const input = { actorId: USER, actorRole: "gm" as const, action: "auth_step_up_success" as const, resourceTable: "sessions", resourceId: SESSION, metadata: {}, ipAddress: null, userAgent: null };
    await expect(audit(input)).resolves.toBeUndefined();
    expect(await auditChecked(input)).toEqual({ ok: false, message: expect.any(String) });
    h.db.failInsertTables = [];
    expect(await auditChecked(input)).toEqual({ ok: true });
  });
});

describe("POST /api/auth/step-up with the success audit failing", () => {
  it("500, the minted grant is voided, and neither clock is stamped", async () => {
    h.db.failInsertTables = ["audit_log"];
    const res = await call({ password: "right", catalogWindow: true, purpose: { action: "recipe.delete", targetId: T } });
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("step_up_audit_failed");
    expect(grants()).toHaveLength(1);
    expect(grants()[0]!.consumed_at).toEqual(expect.any(String));
    expect(session()).toMatchObject({ step_up_unlocked: false, step_up_unlocked_at: null, catalog_edit_unlocked_at: null });
  });

  it("with the audit healthy: 200, the success row is written, the grant is live, both clocks stamped", async () => {
    const res = await call({ password: "right", catalogWindow: true, purpose: { action: "recipe.delete", targetId: T } });
    expect(res.status).toBe(200);
    expect((h.db.tables.audit_log as Row[]).map((r) => r.action)).toEqual(["auth_step_up_success"]);
    expect(grants()[0]!.consumed_at).toBeNull();
    expect(session().step_up_unlocked).toBe(true);
    expect(session().catalog_edit_unlocked_at).toEqual(expect.any(String));
  });
});
