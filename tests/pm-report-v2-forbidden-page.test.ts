/**
 * Links audit 2026-11-20 — the closing checklist's "PM report" line opens /pm-report?location=<shop>.
 * On a PM v2 day that page opens the viewer's own copy (`openMyCopy`), whose binds are STRICTER than the page's:
 * the 0271 RPC (`pm_v2_actor_ok` -> `assignment_user_level`) requires an ACTIVE MEMBERSHIP of the shop, which the
 * level-9+ all-shops grant in `bound()` / the page's `lockLocationContext` does not supply, and the social media
 * manager is refused outright. The refusal (PmReportError "forbidden") used to be uncaught, so the page threw into
 * the app-wide "Something went wrong" screen. It now renders the access-denied banner (with its way back).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/(authed)/pm-report/page.tsx", "utf8");

describe("/pm-report on a v2 day", () => {
  it("turns a forbidden copy open into the access-denied banner instead of an uncaught throw", () => {
    const body = page.slice(page.indexOf("async function renderV2"));
    const open = body.indexOf("await openMyCopy(");
    const tryAt = body.lastIndexOf("try {", open);
    const catchAt = body.indexOf("} catch (e) {", open);
    expect(tryAt).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(tryAt);
    expect(catchAt).toBeGreaterThan(open);
    const handler = body.slice(catchAt, body.indexOf("throw e;", catchAt) + "throw e;".length);
    expect(handler).toContain('e instanceof PmReportError && e.code === "forbidden"');
    expect(handler).toContain("<AccessDeniedBanner");
    // Anything else still surfaces (a failed read is never dressed up as "no access").
    expect(handler.trim().endsWith("throw e;")).toBe(true);
  });
  it("loadMyCopy runs inside the same guard (it re-checks the manager bind)", () => {
    const body = page.slice(page.indexOf("async function renderV2"));
    const guarded = body.slice(body.indexOf("await openMyCopy("), body.indexOf("} catch (e) {", body.indexOf("await openMyCopy(")));
    expect(guarded).toContain("await loadMyCopy(");
  });
});
