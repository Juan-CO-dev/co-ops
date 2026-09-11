import { expect, it, vi } from "vitest";
import { setLocationEzcaterUuid } from "@/lib/admin/ezcater-map";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("Unexpected I/O"); }) }));

it("LRA-219: refuses a GM's foreign location with a typed 403 before any write", async () => {
  const actor = { user: { id: "actor", role: "gm" }, locations: ["own-shop"] } as AuthContext;
  await expect(setLocationEzcaterUuid(actor, "foreign-shop", "caterer"))
    .rejects.toMatchObject({ name: "AdminEzcaterError", status: 403, code: "forbidden" });
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});

it("LRA-219: own-shop GMs and all-location owners pass the bind", async () => {
  for (const [role, locations] of [["gm", ["own-shop"]], ["owner", []]] as const) {
    const actor = { user: { id: "actor", role }, locations: [...locations] } as AuthContext;
    // The next pure validation proves authorization passed, without touching a client.
    await expect(setLocationEzcaterUuid(actor, "own-shop", "x".repeat(101)))
      .rejects.toMatchObject({ status: 400, code: "invalid_uuid" });
  }
});
