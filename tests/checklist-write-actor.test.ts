import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../lib/session";

const dbMock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../lib/supabase-server", () => ({ getServiceRoleClient: () => dbMock }));
import { resolveChecklistWriteActor } from "../lib/checklist-write-actor";

describe("session-derived checklist actor", () => {
  const auth = { user: { id: "user" }, session: { id: "session", userId: "user" },
    role: "owner", level: 9, locations: ["stale-jwt-location"] } as AuthContext;
  let session: Record<string, unknown>;
  let user: Record<string, unknown>;
  let membershipError: unknown;
  let filters: Array<[string, string, unknown]>;
  beforeEach(() => {
    session = { id: "session", user_id: "user", revoked_at: null,
      expires_at: new Date(Date.now() + 60_000).toISOString() };
    user = { id: "user", role: "employee", active: true };
    membershipError = null;
    filters = [];
    dbMock.from.mockImplementation((table: string) => {
      const result = { data: table === "sessions" ? session : table === "users" ? user
        : [{ location_id: "fresh-location" }], error: table === "user_locations" ? membershipError : null };
      const query = { select: () => query,
        eq: (key: string, value: unknown) => { filters.push([table, key, value]); return query; },
        maybeSingle: async () => result,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
      return query;
    });
  });
  it("uses fresh role and active membership, never JWT/fallback authority", async () => {
    const actor = await resolveChecklistWriteActor(auth);
    expect(actor).toMatchObject({ userId: "user", level: 3, active: true, locations: ["fresh-location"] });
    expect(filters).toEqual([["sessions", "id", "session"], ["users", "id", "user"],
      ["user_locations", "user_id", "user"], ["user_locations", "active", true]]);
    expect(Object.isFrozen(actor.locations)).toBe(true);
  });
  it.each(["revoked", "expired", "mismatch", "inactive", "unknown-role", "membership-error"])(
    "fails closed for %s", async (state) => {
      if (state === "revoked") session.revoked_at = new Date().toISOString();
      if (state === "expired") session.expires_at = new Date(Date.now() - 1).toISOString();
      if (state === "mismatch") session.user_id = "someone-else";
      if (state === "inactive") user.active = false;
      if (state === "unknown-role") user.role = "constructor";
      if (state === "membership-error") membershipError = { message: "read failed" };
      await expect(resolveChecklistWriteActor(auth)).rejects.toThrow("checklist_actor_not_authorized");
    });
});
