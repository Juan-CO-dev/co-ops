/**
 * Audit follow-up W05B — owner ruling, Juan 2026-11-15: "we routinely do tasks at the shops depending on what's
 * needed and who is available". Level 8+ (MoO, owner, CGS) work checklist / opening / closing / prep TASKS at any
 * shop without a membership row; below level 8 the active membership stays required.
 *
 *   1. the pure rule (lib/locations.ts canWorkShopTasks / shopTaskLocations, lib/checklist-write-guard-shared.ts
 *      worksShopTasks) over every role, and lockLocationContext left exactly as it was (scope stays on tasks);
 *   2. every task surface (opening / AM prep / mid-day / closing routes, pages and the AM prep draft) binds through
 *      the task rule, before its write — a source pin, so a new task route cannot quietly drop back;
 *   3. behaviour through one real route (mid-day Phase 1): a MoO of another shop passes the shop gate, a GM of
 *      another shop is refused `location_access_denied` before any task read.
 * The checklist writers themselves are covered in tests/checklist-service-writers.test.ts (routes + lib) and the
 * SQL arm in tests/audit-w05b-checklist-any-shop-migration.test.ts.
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES, getRoleLevel, type RoleCode } from "@/lib/roles";
import { canWorkShopTasks, lockLocationContext, shopTaskLocations } from "@/lib/locations";
import { worksShopTasks } from "@/lib/checklist-write-guard-shared";

const SHOP = "10000000-0000-4000-8000-000000000001";
const OTHER = "20000000-0000-4000-8000-000000000002";
const ROLE_CODES = Object.keys(ROLES) as RoleCode[];

describe("the shop-task rule", () => {
  it.each(ROLE_CODES)("%s: allowed at a non-member shop exactly when level >= 8; always at their own shop", (role) => {
    const level = getRoleLevel(role);
    expect(canWorkShopTasks({ role, locations: [OTHER] }, SHOP)).toBe(level >= 8);
    expect(canWorkShopTasks({ role, locations: [SHOP] }, SHOP)).toBe(true);
    expect(shopTaskLocations({ role, locations: [OTHER] })).toEqual(level >= 8 ? "all" : [OTHER]);
    expect(worksShopTasks({ userId: "u", level, active: true, locations: [OTHER] }, SHOP)).toBe(level >= 8);
    expect(worksShopTasks({ userId: "u", level, active: true, locations: [SHOP] }, SHOP)).toBe(true);
    // An inactive actor never works a shop, member or not, whatever their level.
    expect(worksShopTasks({ userId: "u", level, active: false, locations: [SHOP] }, SHOP)).toBe(false);
  });

  it("names the three level-8+ roles and refuses the social media manager like any level-6 role", () => {
    const anyShop = ROLE_CODES.filter((role) => canWorkShopTasks({ role, locations: [] }, SHOP)).sort();
    expect(anyShop).toEqual(["cgs", "moo", "owner"]);
    expect(canWorkShopTasks({ role: "social_media_mgr", locations: [OTHER] }, SHOP)).toBe(false);
    expect(canWorkShopTasks({ role: "gm", locations: [OTHER] }, SHOP)).toBe(false);
  });

  it("does not widen lockLocationContext: every other operational write still needs a membership below 9", () => {
    expect(lockLocationContext({ role: "moo", locations: [OTHER] }, SHOP)).toBe(false);
    expect(lockLocationContext({ role: "owner", locations: [] }, SHOP)).toBe(true);
  });
});

describe("every task surface binds through the task rule before it writes", () => {
  const TASK_FILES = [
    "app/api/opening/phase1/draft/route.ts",
    "app/api/opening/prep/item/route.ts",
    "app/api/opening/prep/item/revoke/route.ts",
    "app/api/opening/submit/phase1/route.ts",
    "app/api/opening/submit/phase2/route.ts",
    "app/api/prep/mid-day/route.ts",
    "app/api/prep/mid-day/phase1/route.ts",
    "app/api/prep/mid-day/phase2/item/route.ts",
    "app/api/prep/mid-day/phase2/finalize/route.ts",
    "app/api/prep/submit/route.ts",
    "lib/am-prep-draft.ts",
    "app/(authed)/operations/am-prep/page.tsx",
    "app/(authed)/operations/mid-day/page.tsx",
    "app/(authed)/operations/closing/page.tsx",
  ];
  it.each(TASK_FILES)("%s uses canWorkShopTasks and no longer lockLocationContext", (file) => {
    const src = readFileSync(file, "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
    expect(src).toContain("canWorkShopTasks(");
    expect(src).not.toContain("lockLocationContext");
  });

  it("the opening page lists every active shop at level 8+ (shopTaskLocations), not the level-9 grant", () => {
    const src = readFileSync("app/(authed)/operations/opening/page.tsx", "utf8");
    expect(src).toContain("shopTaskLocations(actor)");
    expect(src).not.toMatch(/accessibleLocations\(/);
  });

  it("the closing page's write UI follows the writers' rule (worksShopTasks), not a membership-only check", () => {
    const src = readFileSync("app/(authed)/operations/closing/page.tsx", "utf8");
    expect(src).toMatch(/writeUnavailable = auth\.level >= 3 &&\s*\(!writeActor \|\| !worksShopTasks\(writeActor, locationParam\)\)/);
  });

  it("lib/checklists.ts: the four task writers use worksShopTasks; no membership-only check is left in them", () => {
    const src = readFileSync("lib/checklists.ts", "utf8");
    for (const fn of ["getOrCreateInstance", "completeItem", "submitBatch", "confirmInstance"]) {
      const start = src.indexOf(`export async function ${fn}(`);
      const body = src.slice(start, src.indexOf("\nexport ", start + 1));
      expect(body, fn).toContain("worksShopTasks(actor, ");
      expect(body, fn).not.toMatch(/!actor\.locations\.includes\(/);
    }
  });
});

// ── 3. one real route ─────────────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: h.session }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: h.access }));
vi.mock("@/lib/prep", () => ({
  AM_PREP_BASE_LEVEL: 3, isPrepInputs: () => true, submitMidDayPhase1: h.submit,
  PrepRoleViolationError: class extends Error {},
}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  from: () => {
    const q = { select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: { id: INSTANCE, location_id: SHOP, date: "2026-11-15" }, error: null }) };
    return q;
  },
}) }));
const INSTANCE = "30000000-0000-4000-8000-000000000003";
import { POST as midDayPhase1 } from "@/app/api/prep/mid-day/phase1/route";

function post() {
  return midDayPhase1(new NextRequest("https://example.test/api/prep/mid-day/phase1", {
    method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" },
    body: JSON.stringify({ instanceId: INSTANCE, entries: [] }),
  }));
}
const ctx = (role: RoleCode, locations: string[]) => ({ user: { id: "actor", role }, role, level: getRoleLevel(role), locations });

describe("mid-day Phase 1 route: the shop gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stop right after the shop gate: the task-assignment read answers "no", so passing the gate is visible as
    // role_insufficient, while a refused shop is location_access_denied before that read.
    h.access.mockResolvedValue(false);
  });

  it.each(["moo", "owner", "cgs"] as const)("a %s of another shop passes the shop gate", async (role) => {
    h.session.mockResolvedValue(ctx(role, [OTHER]));
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "role_insufficient" });
    expect(h.access).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ locationId: SHOP }));
  });

  it.each(["gm", "agm", "social_media_mgr", "key_holder"] as const)("a %s of another shop is refused location_access_denied", async (role) => {
    h.session.mockResolvedValue(ctx(role, [OTHER]));
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "location_access_denied" });
    expect(h.access).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
  });
});
