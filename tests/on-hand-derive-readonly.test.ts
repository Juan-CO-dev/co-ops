import { describe, expect, it, vi } from "vitest";
import { deriveOnHand } from "@/lib/counts";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no database in this test"); }) }));

describe("deriveOnHand takes no seeding option (Astra r3, LRA-217)", () => {
  it("rejects a seedBaselines option at compile time (the structural pin in on-hand-seed-flag proves the literal false)", async () => {
    // @ts-expect-error — the read-only entry point has no seedBaselines option; a caller cannot ask it to seed.
    const call = deriveOnHand("11111111-1111-4111-8111-111111111111", Date.now(), { seedBaselines: true });
    await expect(call).rejects.toThrow("no database in this test");
  });
});
