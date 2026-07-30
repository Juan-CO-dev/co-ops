/**
 * Lock-up gate hardening (2026-07-31, council P1). The C.26 invariant — "only a
 * key holder (level ≥ 4) locks up, and Walk-Out Verification is the finalize
 * signal" — was client-side only; confirmInstance now enforces it server-side
 * for closing templates.
 *
 * These pins guard the two load-bearing constants a rename could silently
 * disarm: the key-holder floor and the Walk-Out station system-key. (The full
 * confirmInstance path is DB-bound and covered by the route's integration
 * behavior; here we pin the invariants that make the gate correct.)
 */
import { describe, it, expect } from "vitest";
import { WALK_OUT_VERIFICATION_STATION } from "@/lib/checklist-constants";
import { CLOSING_CONFIRM_FLOOR_LEVEL } from "@/lib/admin/template-builder-shared";

describe("finalize gate invariants", () => {
  it("the key-holder floor is level 4 (KH+)", () => {
    expect(CLOSING_CONFIRM_FLOOR_LEVEL).toBe(4);
  });

  it("the Walk-Out station system-key is the shared, single-source value", () => {
    // Server (confirmInstance) + client (closing-client) both import THIS —
    // the constant they gate on can no longer drift. A rename that breaks the
    // finalize signal fails here.
    expect(WALK_OUT_VERIFICATION_STATION).toBe("Walk-Out Verification");
  });
});
