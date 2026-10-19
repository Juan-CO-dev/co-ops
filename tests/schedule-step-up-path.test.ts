/**
 * Scheduling Phase 2, chunk F — the Tier B unlock must SURVIVE the schedule action route's own requireSession.
 *
 * `requireSession(req, "/api/schedule")` auto-clears `step_up_unlocked` on any path outside the step-up surface,
 * BEFORE the route's `assertStepUp(ctx, "B")` reads it — so Approve and a confirmed overwrite could never pass
 * (the same load-bearing reason the /api/admin/* and catering send/transfer arms exist). The board's pages and every
 * other path still clear it; Tier E (the settings route) rides its own clock and needs no arm.
 */
import { describe, expect, it } from "vitest";
import { isStepUpSurface } from "@/lib/session";

describe("the schedule action route keeps the Tier B unlock", () => {
  it("preserves it on POST /api/schedule (approve, a confirmed overwrite)", () => {
    expect(isStepUpSurface("/api/schedule")).toBe(true);
  });
  it.each(["/schedule", "/schedule/settings", "/api/schedule/settings", "/api/schedule/x", "/api/schedulex", "/api/cron/schedule-draft"])(
    "clears it on %s", (path) => { expect(isStepUpSurface(path)).toBe(false); });
  it("the route passes exactly that path to requireSession", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("app/api/schedule/route.ts", "utf8")).toContain('requireSession(req, "/api/schedule")');
  });
});
