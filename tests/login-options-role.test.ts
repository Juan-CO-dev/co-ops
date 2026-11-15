/**
 * Audit W07 / B160 — /api/users/login-options validated `role` with the `in` operator, so every name on
 * Object.prototype ("constructor", "toString", "__proto__", …) passed as a role code and reached the query.
 * The route now uses lib/roles.ts `isRoleCode` (Object.hasOwn), the helper the admin user routes already use.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/users/login-options/route";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

const LOCATION = "11111111-1111-4111-8111-111111111111";
const get = (role: string) =>
  GET(new NextRequest(`https://example.test/api/users/login-options?location_id=${LOCATION}&role=${encodeURIComponent(role)}`));

beforeEach(() => vi.clearAllMocks());

describe("login-options role validation (B160)", () => {
  it.each(["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"])(
    "role=%s is refused 400 invalid_payload before any query",
    async (role) => {
      const res = await get(role);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "invalid_payload", field: "role" });
      expect(getServiceRoleClient).not.toHaveBeenCalled();
    },
  );

  it("a real role code still reaches the query and keeps the { users } shape", async () => {
    const assignments = { select: () => assignments, eq: () => assignments, then: (r: (v: unknown) => unknown) => r({ data: [], error: null }) };
    vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => assignments } as never);
    const res = await get("employee");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ users: [] });
    expect(getServiceRoleClient).toHaveBeenCalledOnce();
  });
});
