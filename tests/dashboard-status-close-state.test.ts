/**
 * The ONE close-state model (design 2026-08-19 §2). Before this helper the
 * dashboard branched on a 3-value union with NO auto_finalized case
 * (app/(authed)/dashboard/page.tsx statusCopyFor), so an auto-finalized day
 * rendered "In progress" + a "Continue closing" CTA. That case is pinned here
 * permanently.
 */
import { describe, it, expect } from "vitest";
import { deriveCloseState } from "@/lib/dashboard-status-shared";

describe("deriveCloseState", () => {
  it("no instance is pending, not in_progress", () => {
    expect(deriveCloseState(null)).toEqual({ status: "pending", incomplete: false });
    expect(deriveCloseState(undefined)).toEqual({ status: "pending", incomplete: false });
    expect(deriveCloseState("")).toEqual({ status: "pending", incomplete: false });
  });

  it("REGRESSION: auto_finalized is its own closed state, never in_progress", () => {
    expect(deriveCloseState("auto_finalized")).toEqual({
      status: "auto_finalized",
      incomplete: false,
    });
  });

  it("manual finalization is closed", () => {
    expect(deriveCloseState("confirmed")).toEqual({ status: "closed", incomplete: false });
    expect(deriveCloseState("phase2_complete")).toEqual({ status: "closed", incomplete: false });
  });

  it("incomplete_confirmed is closed WITH the incomplete flag (nuance preserved, no 5th state)", () => {
    expect(deriveCloseState("incomplete_confirmed")).toEqual({
      status: "closed",
      incomplete: true,
    });
  });

  it("every started-but-unfinalized status is in_progress", () => {
    for (const s of ["open", "in_progress", "phase1_complete", "submitted"]) {
      expect(deriveCloseState(s).status).toBe("in_progress");
    }
  });

  it("an unknown status degrades to in_progress, never to a false 'closed'", () => {
    expect(deriveCloseState("some_future_status").status).toBe("in_progress");
  });

  it("agrees with the mid-shift isSubmitted set on every submitted status", () => {
    for (const s of ["phase2_complete", "confirmed", "incomplete_confirmed", "auto_finalized"]) {
      expect(["closed", "auto_finalized"]).toContain(deriveCloseState(s).status);
    }
  });
});
