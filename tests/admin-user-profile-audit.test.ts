import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

// W27 / B229: an admin's name / phone edit wrote no audit row (only an email change did) — and the phone is the key the
// rehire check matches a separated person on. Every edit now leaves ONE row, field names only.
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), audit: vi.fn() }));
const SHOP = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const GM = "33333333-3333-4333-8333-333333333333";
function query(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: result, error: null });
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [{ user_id: TARGET, location_id: SHOP }], error: null }).then(ok);
  return q;
}
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  from: (t: string) => query(t === "users" ? { id: TARGET, name: "Ana", email: null, role: "employee", active: true, last_login_at: null,
    phone: "2025550100", email_verified: false, created_at: "2026-01-01T00:00:00Z", created_by: null, locked_until: null, dormant_at: null } : null),
  rpc: mocks.rpc,
}) }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { updateUserProfile } from "@/lib/admin/users";
import { isDestructive } from "@/lib/destructive-actions";

const gm = { user: { id: GM, role: "gm" }, role: "gm", level: 7, locations: [SHOP] } as unknown as AuthContext;
beforeEach(() => { vi.clearAllMocks(); mocks.audit.mockResolvedValue(undefined); });

describe("updateUserProfile audit rows", () => {
  it("a phone-only edit writes user.update_profile with the field names", async () => {
    mocks.rpc.mockResolvedValue({ data: { fields: ["phone"], email_changed: false }, error: null });
    await updateUserProfile(gm, TARGET, { phone: "2025550199" });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "user.update_profile", actorId: GM, resourceTable: "users", resourceId: TARGET, metadata: { fields: ["phone"] } }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("2025550199");
  });
  it("an email edit still writes exactly one user.change_email", async () => {
    mocks.rpc.mockResolvedValue({ data: { fields: ["name", "email"], email_changed: true, sessions_revoked: 2 }, error: null });
    await updateUserProfile(gm, TARGET, { name: "Ana R", email: "ana@example.test" });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "user.change_email", metadata: { fields: ["name", "email"], sessions_revoked: 2 } }));
  });
  it("an empty patch writes nothing", async () => {
    await updateUserProfile(gm, TARGET, {});
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("user.update_profile is registered destructive", () => {
    expect(isDestructive("user.update_profile")).toBe(true);
  });
});
