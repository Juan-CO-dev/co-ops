# Catalog Redesign — Phase 1 (Quick Fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six Phase 1 quick fixes from the catalog redesign spec:
- a 15-minute edit unlock, while destructive acts still ask every time;
- recipe lines editable in place, saved lines and draft lines alike;
- a searchable ingredient picker;
- deep links that land on the exact item;
- a fix for the avg-weight dead end on chained SKUs;
- removal of the dead `SkuPackChainPanel`.

The manager guide text for these screens ships with them.

**Architecture:** Migration `0257` adds two things.

1. **The edit window has its own clock.** The new column `sessions.catalog_edit_unlocked_at` is stamped only by a password typed on the admin surface. It is a FIXED 15-minute clock from that password: never extended by saving, never cleared by navigation or background requests, ended only by expiry or by the session ending (logout, revoke, session expiry). The pure `assertStepUp(ctx, "E")` checks this column on every catalog and recipe write, and ordinary catalog edits all move to Tier E, including those that sat at Tier A.
2. **Destructive acts get a one-shot grant.** Retire a product, delete a recipe and deactivate a SKU each need a single-use authorization bound to the action and the target. The step-up POST mints it when it carries a `purpose`, into the deny-all `step_up_grants` table, with a 120 s TTL. The destructive route consumes it with one atomic conditional UPDATE. A wrong action, wrong target, wrong session, replay or expired grant is refused.

Recipe lines are config edges, so an edit is an in-place, **compare-and-set** UPDATE. The client sends the line it saw. If someone else changed the line first, the UPDATE matches 0 rows and the route answers `409 line_changed`. The audit row records the matched expected line as "before" and the row the UPDATE returned as "after". The edit shares one validator with add, so the same product-unit rule and item cycle guard apply to both.

Pure logic lives in `*-shared.ts` modules with vitest tests. DB-coupled code is tested through a predicate-aware fake client that really applies every filter.

**Tech Stack:** Next.js 16.2.4 (App Router; page `searchParams` is a Promise), React 19.2.4, TypeScript strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens, Supabase (service role), vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-15-catalog-redesign-design.md` §4 ("Passwords") and §7 (Phase 1).
**Review:** Astra r1 (CHANGES REQUESTED), findings P1-1 … P3-8, all addressed. See "Review r1 — what changed" at the end.

**Working copy:** `C:\Users\conta\co-ops-guides`. Branch from `origin/main`:

```bash
cd /c/Users/conta/co-ops-guides && git fetch origin && git checkout -b feat/catalog-phase1-quick-fixes origin/main
```

**Standing rules for every task:**
- Read `AGENTS.md` first. It is the law-book: the closed audit vocabulary, the 44px + `items-center` floor, the token roles, en + es in the same PR, tú Spanish, and the migration headers.
- Use the sim only (`node scripts/sim/dev-sim.mjs`, http://localhost:3100). Never test against production.
- Every commit message ends with the two trailer lines shown in each commit step.
- **Migration `0257` is authored here and NOT applied.** Apply it via MCP after review: sim first, then prod on Juan's word, and **before** the code merges. The code writes `catalog_edit_unlocked_at` and `step_up_grants`. Merging first would 500 every step-up and refuse every catalog edit. The number is `0257` as the brief directs; `0256` stays free for the branch that holds it.

---

## Ground truth this plan is built on (verified 2026-10-15 against `main` @ 0ff0eb90)

| Claim | Where |
|---|---|
| Step-up lives on the session row: `step_up_unlocked` + `step_up_unlocked_at`, set only by `unlockStepUp` after a password check in `POST /api/auth/step-up`, which audits `auth_step_up_success`. | `lib/session.ts:518-526`, `app/api/auth/step-up/route.ts` |
| `requireSessionCore` copies the columns into `AuthContext.session` (`select("*")`). It clears the shared flag outside `isStepUpSurface`, which **includes** `/operations/counts` + `/api/operations/counts` and two catering money routes. The catalog clock does not reuse this lifecycle (Astra r2 design decision: a fixed window, see Task 3). | `lib/session.ts:229-400` |
| `assertStepUp` is pure. A = unlocked at any age; B = unlocked within 120 s. Today B and an edit unlock would read the **same** timestamp, so an edit unlock would pass a Tier B route for 120 s without a new password (Astra P1-1). | `lib/admin/step-up.ts` |
| `DESTRUCTIVE_ACTIONS` does not drive step-up. Step-up is chosen per route (AGENTS.md). | `lib/destructive-actions.ts` header |
| Catalog/recipe routes at Tier B today: recipes (create, full, PATCH, DELETE, inputs, outputs, edges, yield-nudge), skus POST, products POST, products/[id]/active, items sold-directly, menu-items POST, menu price, weights. At **Tier A** (unlocked indefinitely): skus/[id] (identity edits **and** deactivation), skus/[id]/pack-chain, price, location-settings, products/[id], members, primary, catalog/item-type. | `tests/step-up-tier-map.test.ts` (pinned map) |
| `recipe_inputs` has no active, superseded or updated_at column. A removal is a hard DELETE with `metadata.before`. Nothing has an FK to a line id (`production_inputs` stores SKU + oz). Seeds 22/25/32 already UPDATE lines in place under `recipe_input.update`, which is registered **non-destructive** today. | `0103_recipe_entities.sql:32-46`, `lib/recipes.ts:604-627`, `0102`, `lib/audit-actions.ts:242` |
| `addRecipeInput` checks: one of three targets, quantity > 0, and for a product line `assertProductLineIsValid` (an active product plus an ACTIVE `measure_units` label of any dimension — weight, volume or count; AGENTS.md "measure-registry unit"; the spec's "oz / each" is shorthand). It has **no** item cycle guard; only `createRecipeFull` has one. "Mass balance" is a read-time costing guard, not a write guard. | `lib/recipes.ts:108-134, 357-370, 520-534` |
| `loadRecipe` returns line fields raw (`unit`, `each_container_label` untrimmed, `quantity` as a number). | `lib/recipes.ts:220-259` |
| Three separate `<select>` pickers (SKU, item, product) with no search. Two byte-identical page loaders. Draft lines are remove-only. | `RecipeBuilder.tsx:925-1180`, `app/admin/recipes/[id]/page.tsx`, `new/page.tsx` |
| Deep links land on lists: `CatalogClient.tsx:376`, `lib/vendor-import.ts:212`, `VendorImportPanel.tsx:131` (`?vendor=`, never read), `registryLinkHref` sku (`#id` only), and the costing drawer (names, no links). `SkuCatalogClient` keeps vendor/lens/query/expanded in `useState` initialisers only. | listed files |
| `leaf_needs_avg` (RAW chain, count/volume leaf, no avg) has no fix on the chained edit path. | `lib/admin/pack-chain.ts:216-239`, `SkuBuilder.tsx:584-660`, `PackChainWizard.tsx:373` |
| `SkuPackChainPanel.tsx` has no importer. | `grep -rn SkuPackChainPanel` |
| A house fake client already exists (`tests/vault-fake-client.ts`); migration tests read SQL source (`tests/report-policy-migration.test.ts`). The guides carry an English block plus a `### En español` block per `##` section, at grade 6 or lower (`tests/guides-reading-level.test.ts`). | listed files |

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/admin/step-up-shared.ts` | create | Pure: tiers (A/B/E), grant actions/purposes, window constants, `isFreshWithin`, client `stepUpDecision`, `isStepUpRefusal`, `parseStepUpPurpose`, `grantExpiresAt`. |
| `supabase/migrations/0257_step_up_catalog_window_and_grants.sql` | create | `sessions.catalog_edit_unlocked_at`; `step_up_grants` (deny-all, service_role select/insert/update, guard). |
| `lib/types.ts`, `lib/session.ts` | modify | `Session.catalogEditUnlockedAt`; `unlockStepUp(…, { catalogWindow })`. No navigation clear: the window is a fixed 15-minute clock. |
| `lib/admin/step-up.ts` | rewrite | `assertStepUp` "E" reads the catalog clock. |
| `lib/admin/step-up-grants.ts` | create | `mintStepUpGrant`, `consumeStepUpGrant` (atomic conditional UPDATE). |
| `app/api/auth/step-up/route.ts` | modify | Accepts `catalogWindow` + `purpose`; mints the grant; audits both. |
| `tests/fake-supabase.ts` | create | Predicate-aware fake client (filters really applied; writes record matches; injectable update failures). |
| `components/admin/StepUpProvider.tsx` | rewrite | Client catalog clock, `requestStepUpGrant`, `forgetStepUp`. |
| `components/auth/PasswordModal.tsx` | modify | Sends `purpose` / `catalogWindow`. |
| `components/admin/useStepUpPost.ts` | create | `postJson` that forgets a refused unlock. |
| `app/admin/layout.tsx`, `components/admin/catalog/CatalogClient.tsx` | modify | Pass the catalog clock and window. The reactive modal opens the window too. |
| 22 route files + 10 clients (Task 5 lists) | modify | Every ordinary catalog edit → E; the three destructive acts → grants. |
| `tests/step-up-tier-map.test.ts`, `tests/dynamic-pars-write.test.ts`, `tests/menu-prices-data.test.ts`, `tests/menu-prices-ui.test.ts` | modify | Re-pinned tiers + a new grant map. |
| `AGENTS.md` | modify | The step-up law; the overlay-route sentence. |
| `lib/recipe-line-shared.ts` | create | Pure line surface: parse (patch, snapshot, edit), normalize, row↔line, diff, kind, unit choices, view→draft/snapshot. |
| `lib/recipes.ts`, `lib/destructive-actions.ts`, `lib/audit-actions.ts`, `lib/dynamic-pars.ts` | modify | Shared validator (add + edit, with the cycle guard); compare-and-set `updateRecipeInput`; `recipe_input.update` destructive. |
| `app/api/admin/recipes/[id]/inputs/[inputId]/route.ts` | create | `PATCH { line, expected }` (Tier E). |
| `components/admin/recipes/shared.ts`, `components/admin/skus/shared.ts`, `components/admin/products/shared.ts` | modify | Error codes `line_changed`, `step_up_grant_required`, product-line codes. |
| `lib/ingredient-picker-shared.ts` | create | Pure picker: options, search + ranking, `moveActive`, `optionForLine`, `lineTargetKey`. |
| `lib/admin/recipe-builder-data.ts` | create | One loader for both recipe pages; SKUs carry `vendorName`. |
| `app/admin/recipes/[id]/page.tsx`, `app/admin/recipes/new/page.tsx` | rewrite | Use the loader. |
| `components/admin/recipes/IngredientPicker.tsx` | create | ARIA combobox; the active option scrolls into view. |
| `components/admin/recipes/RecipeLineEditor.tsx` | create | One add/edit line form. |
| `components/admin/recipes/RecipeBuilder.tsx`, `RecipeInputRow.tsx` | modify | Edit in place for saved and draft lines; add via the picker. |
| `lib/i18n/en.json`, `lib/i18n/es.json` | modify | New strings. |
| `lib/admin/product-item-links-shared.ts` | modify | `skuCatalogHref` / `productHref` / `prepItemHref` / `readFocusParam`. |
| `lib/admin/sku-focus-shared.ts` | create | Pure: how a `?sku=` / `?vendor=` change patches the catalog's state. |
| `app/admin/skus/page.tsx`, `components/admin/skus/SkuCatalogClient.tsx` | modify | Deep link opens, rings and scrolls; prev-compare sync on client navigation. |
| `lib/admin/catalog-shared.ts`, `lib/admin/catalog.ts`, `components/admin/catalog/CatalogClient.tsx`, `lib/vendor-import.ts`, `components/admin/vendors/VendorImportPanel.tsx`, `components/admin/menu-costing/MenuCostingClient.tsx` | modify | Links land on the item. |
| `lib/admin/catalog-shared.ts` (`chainNeedsAvgOzPerEach`), `components/admin/skus/SkuBuilder.tsx` | modify | Avg oz field on the chained edit path. |
| `components/admin/skus/SkuPackChainPanel.tsx` | delete | Dead code. |
| `docs/guides/manager-guide.md` | modify | "Recipes and the catalog" (en) + "Recetas y el catálogo" (es). |
| `docs/superpowers/specs/2026-10-15-catalog-redesign-design.md` | modify | §7 amendment: guide text every phase, photo retakes in one pass after Phase 5. |
| tests (new): `step-up-edit-window`, `step-up-grants-migration`, `catalog-window-lifecycle`, `step-up-grants`, `step-up-edit-window-wiring`, `recipe-line-shared`, `recipe-line-edit-server`, `ingredient-picker-shared`, `ingredient-picker-ui`, `recipe-line-edit-ui`, `catalog-deep-links`, `dead-code-removed` | create | Unit tests, fake-DB tests and source pins. |

---

## Task 1: The pure step-up surface (tiers, grants, the catalog clock)

**Files:**
- Create: `lib/admin/step-up-shared.ts`
- Test: `tests/step-up-edit-window.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/step-up-edit-window.test.ts`:

```ts
/**
 * Catalog Phase 1 — the pure step-up surface. Tier E reads its OWN clock (the catalog
 * window, a fixed 15 minutes from an admin password), the client only decides whether to
 * SHOW a prompt, and destructive acts carry a one-shot purpose.
 */
import { describe, expect, it } from "vitest";
import {
  CLIENT_EDIT_WINDOW_MARGIN_MS,
  DEFAULT_EDIT_WINDOW_MS,
  GRANT_ACTIONS,
  GRANT_TTL_MS,
  grantExpiresAt,
  confirmClientUnlock,
  isFreshWithin,
  isInsideWindow,
  isStepUpRefusal,
  parseStepUpPurpose,
  parseWindowSeconds,
  stepUpDecision,
  type ClientUnlock,
} from "@/lib/admin/step-up-shared";

const NOW = Date.parse("2026-10-15T15:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const UUID = "7d0c1f2e-0000-4000-8000-000000000001";

describe("the client decision — when to SHOW the password prompt", () => {
  it("Tier A proceeds whenever the shared flag is set", () => {
    expect(stepUpDecision("A", { unlocked: true, catalogUnlockedAt: null }, NOW)).toBe("proceed");
    expect(stepUpDecision("A", { unlocked: false, catalogUnlockedAt: ago(1) }, NOW)).toBe("prompt");
  });

  it("Tier B always prompts, even for a one-second-old unlock", () => {
    expect(stepUpDecision("B", { unlocked: true, catalogUnlockedAt: ago(1_000) }, NOW)).toBe("prompt");
  });

  it("Tier E reads the CATALOG clock only, inside the window minus the client margin", () => {
    const edge = DEFAULT_EDIT_WINDOW_MS - CLIENT_EDIT_WINDOW_MARGIN_MS;
    expect(stepUpDecision("E", { unlocked: false, catalogUnlockedAt: ago(edge - 1) }, NOW)).toBe("proceed");
    expect(stepUpDecision("E", { unlocked: true, catalogUnlockedAt: ago(edge) }, NOW)).toBe("prompt");
    expect(stepUpDecision("E", { unlocked: true, catalogUnlockedAt: null }, NOW)).toBe("prompt");
  });

  it("Tier E honours the window the server passed down", () => {
    expect(stepUpDecision("E", { unlocked: false, catalogUnlockedAt: ago(20 * 60_000) }, NOW, 30 * 60_000)).toBe("proceed");
  });
});

describe("destructive purposes and grants", () => {
  it("the closed set of grant actions", () => {
    expect([...GRANT_ACTIONS].sort()).toEqual(["product.retire", "recipe.delete", "sku.deactivate"]);
  });

  it("parseStepUpPurpose: absent is null, a known action + uuid is a purpose, anything else is invalid", () => {
    expect(parseStepUpPurpose(undefined)).toBeNull();
    expect(parseStepUpPurpose(null)).toBeNull();
    expect(parseStepUpPurpose({ action: "recipe.delete", targetId: UUID })).toEqual({ action: "recipe.delete", targetId: UUID });
    expect(parseStepUpPurpose({ action: "user.delete", targetId: UUID })).toBe("invalid");
    expect(parseStepUpPurpose({ action: "recipe.delete", targetId: "not-a-uuid" })).toBe("invalid");
    expect(parseStepUpPurpose("recipe.delete")).toBe("invalid");
    expect(parseStepUpPurpose([])).toBe("invalid");
  });

  it("a grant lives 120 seconds", () => {
    expect(GRANT_TTL_MS).toBe(120_000);
    expect(grantExpiresAt(new Date(NOW)).toISOString()).toBe(new Date(NOW + 120_000).toISOString());
  });
});

describe("a confirm from ANY admin modal advances the client's catalog clock (Astra r3 #1)", () => {
  it("catalog modal confirm → router.refresh → a recipe edit proceeds without a second prompt", () => {
    // Server-rendered state: no window yet.
    let unlock: ClientUnlock = { unlocked: false, catalogUnlockedAt: null };
    // The Items catalog's reactive modal posts the password with catalogWindow and reports the 200
    // to the provider (noteStepUpConfirmed → confirmClientUnlock).
    unlock = confirmClientUnlock(unlock, ago(1_000), true);
    // router.refresh() re-renders the admin layout, but the provider is not re-seeded from props:
    // its memory is exactly `unlock`. The recipe builder's next Tier E request:
    expect(stepUpDecision("E", unlock, NOW)).toBe("proceed");
  });

  it("a confirm without the catalog window (counts, catering) never starts the catalog clock", () => {
    expect(confirmClientUnlock({ unlocked: false, catalogUnlockedAt: null }, ago(1_000), false))
      .toEqual({ unlocked: true, catalogUnlockedAt: null });
  });
});

describe("helpers", () => {
  it("isInsideWindow (Tier E) is EXCLUSIVE at the edge", () => {
    expect(isInsideWindow(ago(499), NOW, 500)).toBe(true);
    expect(isInsideWindow(ago(500), NOW, 500)).toBe(false);
    expect(isInsideWindow(ago(501), NOW, 500)).toBe(false);
    expect(isInsideWindow(new Date(NOW + 1).toISOString(), NOW, 500)).toBe(false);
    expect(isInsideWindow(null, NOW, 500)).toBe(false);
  });

  it("isFreshWithin (Tier B, unchanged) is inclusive at the edge and refuses negative ages and garbage", () => {
    expect(isFreshWithin(ago(500), NOW, 500)).toBe(true);
    expect(isFreshWithin(ago(501), NOW, 500)).toBe(false);
    expect(isFreshWithin(new Date(NOW + 1).toISOString(), NOW, 500)).toBe(false);
    expect(isFreshWithin("nope", NOW, 500)).toBe(false);
    expect(isFreshWithin(null, NOW, 500)).toBe(false);
  });

  it("isStepUpRefusal knows the two window codes, not the grant code", () => {
    expect(isStepUpRefusal("step_up_required")).toBe(true);
    expect(isStepUpRefusal("step_up_stale")).toBe(true);
    expect(isStepUpRefusal("step_up_grant_required")).toBe(false);
    expect(isStepUpRefusal(undefined)).toBe(false);
  });

  it("parseWindowSeconds takes positive integers only", () => {
    expect(parseWindowSeconds("900", 1)).toBe(900);
    expect(parseWindowSeconds("0", 7)).toBe(7);
    expect(parseWindowSeconds("-5", 7)).toBe(7);
    expect(parseWindowSeconds(undefined, 7)).toBe(7);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/step-up-edit-window.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/admin/step-up-shared"`.

- [ ] **Step 3: Create `lib/admin/step-up-shared.ts`**

```ts
/**
 * Step-up — CLIENT-SAFE pure surface (no I/O, no env, no server imports). Catalog redesign
 * Phase 1, 2026-10-15, revised after Astra r1.
 *
 * THREE TIERS, TWO CLOCKS:
 *   A — the shared flag (sessions.step_up_unlocked) is set, any age.
 *   B — the shared flag is set and step_up_unlocked_at is within 120 s; the client ALWAYS prompts.
 *   E — the catalog/recipe EDIT WINDOW, on its OWN clock (sessions.catalog_edit_unlocked_at,
 *       0257): stamped only by a password typed on the admin surface. A FIXED 15 minutes from
 *       that password — never extended, never cleared by navigation or background requests
 *       (Astra r2 design decision); it ends at expiry or with the session.
 *
 * DESTRUCTIVE CATALOG ACTS (retire a product, delete a recipe, deactivate a SKU) take neither:
 * they need a ONE-SHOT GRANT — minted by the step-up POST for exactly one (action, target),
 * bound to the session and user, consumed atomically by the route, 120 s TTL — so no window
 * and no earlier password can stand in for "ask every time" (Astra r1 P1-1).
 */
export type StepUpTier = "A" | "B" | "E";

export const GRANT_ACTIONS = ["product.retire", "recipe.delete", "sku.deactivate"] as const;
export type GrantAction = (typeof GRANT_ACTIONS)[number];
export interface StepUpPurpose {
  action: GrantAction;
  targetId: string;
}
/** What a client asks for before a write: a tier, or a one-shot purpose. */
export type StepUpGate = StepUpTier | StepUpPurpose;

export const DEFAULT_FRESH_SECONDS = 120;
export const DEFAULT_EDIT_WINDOW_SECONDS = 15 * 60;
export const DEFAULT_EDIT_WINDOW_MS = DEFAULT_EDIT_WINDOW_SECONDS * 1000;
/** The client gives up this much of the window so it never proceeds into a server-side stale. */
export const CLIENT_EDIT_WINDOW_MARGIN_MS = 30_000;
export const GRANT_TTL_MS = 120_000;

/** A positive whole-second env value, else the fallback. */
export function parseWindowSeconds(raw: string | undefined, fallback: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Tier B's rule (unchanged): a real instant, not after `now`, and AT MOST `windowMs` old (inclusive). */
export function isFreshWithin(at: string | null, now: number, windowMs: number): boolean {
  if (!at) return false;
  const age = now - Date.parse(at);
  return !Number.isNaN(age) && age >= 0 && age <= windowMs;
}

/** Tier E's rule: a real instant, not after `now`, and STRICTLY less than `windowMs` old — the
 *  deadline is EXCLUSIVE, so at exactly 15:00 the window is already closed (Astra r3 #2). */
export function isInsideWindow(at: string | null, now: number, windowMs: number): boolean {
  if (!at) return false;
  const age = now - Date.parse(at);
  return !Number.isNaN(age) && age >= 0 && age < windowMs;
}

/** What a successful password does to this device's memory (pure, so the provider's own modal
 *  and any reactive admin modal record a confirm the same way — Astra r3 #1). */
export function confirmClientUnlock(unlock: ClientUnlock, nowIso: string, catalogWindow: boolean): ClientUnlock {
  return { unlocked: true, catalogUnlockedAt: catalogWindow ? nowIso : unlock.catalogUnlockedAt };
}

/** This device's memory of the two clocks. Advisory: the server re-checks every write. */
export interface ClientUnlock {
  unlocked: boolean;
  catalogUnlockedAt: string | null;
}

/** May this request skip the password prompt? */
export function stepUpDecision(
  tier: StepUpTier,
  unlock: ClientUnlock,
  now: number = Date.now(),
  editWindowMs: number = DEFAULT_EDIT_WINDOW_MS,
): "proceed" | "prompt" {
  if (tier === "A") return unlock.unlocked ? "proceed" : "prompt";
  if (tier === "E") {
    return isInsideWindow(unlock.catalogUnlockedAt, now, editWindowMs - CLIENT_EDIT_WINDOW_MARGIN_MS) ? "proceed" : "prompt";
  }
  return "prompt";
}

/** The two window codes assertStepUp answers with. On either, the client forgets its unlock. */
export function isStepUpRefusal(code: string | null | undefined): boolean {
  return code === "step_up_required" || code === "step_up_stale";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The step-up POST's optional `purpose`: null when absent, "invalid" when malformed. */
export function parseStepUpPurpose(raw: unknown): StepUpPurpose | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const r = raw as Record<string, unknown>;
  if (typeof r.action !== "string" || !(GRANT_ACTIONS as readonly string[]).includes(r.action)) return "invalid";
  if (typeof r.targetId !== "string" || !UUID_RE.test(r.targetId)) return "invalid";
  return { action: r.action as GrantAction, targetId: r.targetId };
}

export function grantExpiresAt(now: Date): Date {
  return new Date(now.getTime() + GRANT_TTL_MS);
}

```

- [ ] **Step 4: Run it**

Run: `npx vitest run tests/step-up-edit-window.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add lib/admin/step-up-shared.ts tests/step-up-edit-window.test.ts
git commit -F - <<'EOF'
feat(step-up): pure surface — Tier E on its own fixed clock, one-shot purposes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 2: Migration 0257 — the catalog clock and the grants table (authored, NOT applied)

**Files:**
- Create: `supabase/migrations/0257_step_up_catalog_window_and_grants.sql`
- Test: `tests/step-up-grants-migration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/step-up-grants-migration.test.ts`:

```ts
/** 0257 (authored SQL, not live integration) — catalog clock + one-shot grants. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GRANT_ACTIONS } from "@/lib/admin/step-up-shared";

const sql = readFileSync("supabase/migrations/0257_step_up_catalog_window_and_grants.sql", "utf8");

describe("0257_step_up_catalog_window_and_grants", () => {
  it("carries the house gate line", () => {
    expect(sql).toContain("NOT YET APPLIED — apply via MCP after review");
  });

  it("adds exactly one column to sessions: the catalog clock", () => {
    expect(sql).toMatch(/alter table public\.sessions\s+add column if not exists catalog_edit_unlocked_at timestamptz;/);
    expect(sql.match(/alter table public\.sessions/g)).toHaveLength(1);
  });

  it("the grant action CHECK is exactly the code's closed set", () => {
    const list = sql.match(/check \(action in \(([^)]*)\)\)/)?.[1] ?? "";
    const actions = [...list.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]).sort();
    expect(actions).toEqual([...GRANT_ACTIONS].sort());
  });

  it("deny-all to the PostgREST roles; service_role revoked to zero FIRST, then exactly select/insert/update", () => {
    expect(sql).toMatch(/alter table public\.step_up_grants enable row level security;/);
    const revoke = sql.indexOf("revoke all on public.step_up_grants from public, anon, authenticated, service_role;");
    const grant = sql.indexOf("grant select, insert, update on public.step_up_grants to service_role;");
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(sql).not.toMatch(/^\s*grant\s[^;]*\bdelete\b[^;]*;/im);
    expect(sql).not.toMatch(/on delete cascade/i);
    expect(sql).not.toMatch(/for all/i);
  });

  it("refuses to commit if a PostgREST role holds any grant, or service_role exceeds its ceiling", () => {
    expect(sql).toContain("raise exception '0257: unexpected step_up_grants table grant'");
    for (const p of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      expect(sql).toContain(`has_table_privilege('service_role', 'public.step_up_grants', '${p}')`);
    }
    expect(sql).toContain("privilege_type not in ('SELECT', 'INSERT', 'UPDATE')");
  });

  it("changes no grant on sessions, and refuses to commit if sessions lost RLS", () => {
    expect(sql).not.toMatch(/^\s*(grant|revoke)\s[^;]*on public\.sessions/im);
    expect(sql).toContain("raise exception '0257: sessions must keep RLS enabled'");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/step-up-grants-migration.test.ts`
Expected: FAIL with `ENOENT: no such file or directory, open 'supabase/migrations/0257_step_up_catalog_window_and_grants.sql'`.

- [ ] **Step 3: Create the migration**

`supabase/migrations/0257_step_up_catalog_window_and_grants.sql`:

```sql
-- Migration 0257_step_up_catalog_window_and_grants
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, BEFORE the code merges).
-- Provenance: catalog redesign Phase 1 (docs/superpowers/plans/2026-10-15-catalog-phase1-quick-fixes.md),
--   Astra r1 P1-1 (an edit unlock must never satisfy an always-prompt act) and P2-3 (the edit
--   window needs its own clock, independent of the shared step-up flag); Astra r2 #3 (explicit
--   service_role privilege ceiling on the new table).
--
-- WHAT:
--   1. sessions.catalog_edit_unlocked_at — the 15-minute catalog/recipe EDIT WINDOW's own clock.
--      Stamped ONLY by a password typed on the admin surface (POST /api/auth/step-up with
--      catalogWindow=true → lib/session.ts unlockStepUp). A FIXED window: never extended, never
--      cleared by navigation; it ends 15 minutes after that password, or with the session
--      (logout / revoke / expiry). Read by assertStepUp(ctx, "E") only.
--   2. public.step_up_grants — ONE-SHOT, action-bound authorizations for the always-prompt
--      catalog acts (product.retire, recipe.delete, sku.deactivate). Minted by the step-up POST
--      when it carries a purpose (lib/admin/step-up-grants.ts mintStepUpGrant); consumed by the
--      destructive route with ONE conditional UPDATE (same session + user + action + target,
--      consumed_at IS NULL, expires_at > now → consumed_at = now; a row lock re-checks the
--      predicate, so a concurrent second consume matches 0 rows). 120 s TTL. A consumed or
--      expired row is history: no DELETE grant, no cascade.
--
-- WHO READS / WRITES (service role only, through the lib):
--     lib/session.ts             unlockStepUp / requireSessionCore   ← sessions.catalog_edit_unlocked_at
--     lib/admin/step-up-grants.ts mintStepUpGrant / consumeStepUpGrant ← step_up_grants
--
-- The staff JWT is a valid PostgREST bearer (AGENTS.md), so no PostgREST role gets any grant on
-- step_up_grants; RLS is enabled with no policies (no grant → no policy; the 0203/0214 precedent).
-- service_role gets an explicit CEILING (the 0218 pattern): everything is revoked first —
-- Supabase's default privileges hand it ALL on a new table — then exactly SELECT, INSERT, UPDATE
-- are granted, and the guard proves it holds no DELETE / TRUNCATE / REFERENCES / TRIGGER.
-- sessions: NO grant change. The new column inherits the table's existing grants and RLS; the
-- guard refuses to commit unless RLS is on for sessions (the 0200 posture).
--
-- PRE-FLIGHT (MCP, before apply — AGENTS.md "pre-flight every SQL emission"):
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'sessions';            -- no catalog_edit_unlocked_at yet
--   select to_regclass('public.step_up_grants');                             -- NULL
--
-- VERIFY AFTER APPLY:
--   select data_type from information_schema.columns
--    where table_name = 'sessions' and column_name = 'catalog_edit_unlocked_at';  -- timestamp with time zone
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'step_up_grants' order by 1, 2;
--     -- service_role INSERT / SELECT / UPDATE only (plus the owner)
--   select has_table_privilege('service_role', 'public.step_up_grants', 'DELETE'),
--          has_table_privilege('service_role', 'public.step_up_grants', 'TRUNCATE');   -- f, f
--   select relrowsecurity from pg_class where oid = 'public.step_up_grants'::regclass;  -- t

begin;

alter table public.sessions
  add column if not exists catalog_edit_unlocked_at timestamptz;
comment on column public.sessions.catalog_edit_unlocked_at is
  'Catalog/recipe edit window (Tier E): a fixed 15 minutes from a password typed on the admin surface; never extended, never cleared by navigation; ends with the session. 0257.';

create table public.step_up_grants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id),
  user_id uuid not null references public.users(id),
  action text not null check (action in ('product.retire', 'recipe.delete', 'sku.deactivate')),
  target_id uuid not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint step_up_grants_expiry_after_create check (expires_at > created_at)
);
comment on table public.step_up_grants is
  'One-shot, action-bound step-up grants for always-prompt catalog acts (0257). Service role only; consumed by a conditional UPDATE; never deleted.';

create index step_up_grants_open_idx
  on public.step_up_grants (session_id, action, target_id)
  where consumed_at is null;

alter table public.step_up_grants enable row level security;
revoke all on public.step_up_grants from public, anon, authenticated, service_role;
grant select, insert, update on public.step_up_grants to service_role;

do $$ begin
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'step_up_grants'
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0257: unexpected step_up_grants table grant';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'step_up_grants'
                and grantee = 'service_role'
                and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')) then
    raise exception '0257: service_role above its ceiling on step_up_grants';
  end if;
  if has_table_privilege('service_role', 'public.step_up_grants', 'DELETE')
     or has_table_privilege('service_role', 'public.step_up_grants', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.step_up_grants', 'REFERENCES')
     or has_table_privilege('service_role', 'public.step_up_grants', 'TRIGGER') then
    raise exception '0257: service_role above its ceiling on step_up_grants';
  end if;
  if not (has_table_privilege('service_role', 'public.step_up_grants', 'SELECT')
          and has_table_privilege('service_role', 'public.step_up_grants', 'INSERT')
          and has_table_privilege('service_role', 'public.step_up_grants', 'UPDATE')) then
    raise exception '0257: service_role is missing a privilege the grant lib needs';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.sessions'::regclass) then
    raise exception '0257: sessions must keep RLS enabled';
  end if;
end $$;

commit;
```

- [ ] **Step 4: Run it**

Run: `npx vitest run tests/step-up-grants-migration.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0257_step_up_catalog_window_and_grants.sql tests/step-up-grants-migration.test.ts
git commit -F - <<'EOF'
feat(db): 0257 — catalog edit clock on sessions + one-shot step-up grants (authored, NOT applied)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 3: Server — the fixed catalog clock, Tier E, grants, and the step-up POST

**Files:**
- Create: `tests/fake-supabase.ts`
- Modify: `lib/types.ts`, `lib/session.ts`
- Rewrite: `lib/admin/step-up.ts`
- Create: `lib/admin/step-up-grants.ts`
- Modify: `app/api/auth/step-up/route.ts`
- Test: `tests/catalog-window-lifecycle.test.ts`, `tests/step-up-grants.test.ts`

- [ ] **Step 1: Create the predicate-aware fake** (test infrastructure, no assertions of its own)

Create `tests/fake-supabase.ts`:

```ts
/**
 * A small PREDICATE-AWARE fake SupabaseClient (catalog Phase 1, Astra r1 P2-5). Every filter
 * the code under test applies is really applied to the in-memory rows — a write scoped by
 * .eq("recipe_id", …) genuinely misses a row on another recipe — and every write records how
 * many rows it matched. Chains: select / eq / is / in / not(col, "is", null) / gt (ISO
 * timestamps only) / order / limit / range / returns / maybeSingle / then, insert(…)…,
 * update(…)….  `failUpdates = n` makes the next n updates return an error without applying.
 * Never a real database. (tests/vault-fake-client.ts is the vault's own, richer twin.)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;
export interface FakeWrite { table: string; op: "insert" | "update"; payload: unknown; matched: number }
export interface FakeDb {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  writes: FakeWrite[];
  failUpdates: number;
}
type Result = { data: Row[] | null; error: { message: string } | null };

let seq = 0;
const isNull = (v: unknown) => v === null || v === undefined;

export function fakeSupabase(tables: Record<string, Row[]>): FakeDb {
  const db: FakeDb = { client: null as unknown as SupabaseClient, tables, writes: [], failUpdates: 0 };

  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: unknown = null;
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;
    let window: [number, number] | null = null;
    const rows = () => (tables[table] ??= []);

    const run = (): Result => {
      if (op === "insert") {
        const inserted = ((Array.isArray(payload) ? payload : [payload]) as Row[]).map((p) => ({ id: `${table}-${++seq}`, ...p }));
        rows().push(...inserted);
        db.writes.push({ table, op, payload, matched: inserted.length });
        return { data: inserted.map((r) => ({ ...r })), error: null };
      }
      const matched = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        if (db.failUpdates > 0) {
          db.failUpdates -= 1;
          db.writes.push({ table, op, payload, matched: 0 });
          return { data: null, error: { message: "fake update failure" } };
        }
        for (const r of matched) Object.assign(r, payload as Row);
        db.writes.push({ table, op, payload, matched: matched.length });
        return { data: matched.map((r) => ({ ...r })), error: null };
      }
      let out = [...matched];
      if (orderBy) {
        const { col, asc } = orderBy;
        out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (window) out = out.slice(window[0], window[1] + 1);
      if (limitN !== null) out = out.slice(0, limitN);
      return { data: out.map((r) => ({ ...r })), error: null };
    };

    const q = {
      select: (_columns?: string) => q,
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: null | boolean) => { filters.push((r) => (v === null ? isNull(r[c]) : r[c] === v)); return q; },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      not: (c: string, operator: string, v: unknown) => {
        if (operator !== "is" || v !== null) throw new Error(`fake-supabase: unsupported not(${c}, ${operator})`);
        filters.push((r) => !isNull(r[c]));
        return q;
      },
      gt: (c: string, v: string) => { filters.push((r) => !isNull(r[c]) && String(r[c]) > v); return q; },
      order: (c: string, o?: { ascending?: boolean }) => { orderBy = { col: c, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { limitN = n; return q; },
      range: (a: number, b: number) => { window = [a, b]; return q; },
      returns: () => q,
      insert: (p: unknown) => { op = "insert"; payload = p; return q; },
      update: (p: unknown) => { op = "update"; payload = p; return q; },
      maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  }

  db.client = { from } as unknown as SupabaseClient;
  return db;
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/catalog-window-lifecycle.test.ts`. It runs the real `requireSession`, `unlockStepUp` and `revokeSession` against the fake:

```ts
/**
 * Catalog Phase 1 (Astra r2 design decision) — the edit window is a FIXED 15-minute clock from an
 * admin-page password: background and outside requests never close it, saving never extends it,
 * it expires at 15 minutes exactly, and it ends with the session (logout / revoke / expiry).
 * Runs the real requireSession / unlockStepUp / revokeSession over the predicate-aware fake.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fake-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./fake-supabase").FakeDb }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));

import { requireSession, revokeSession, SESSION_COOKIE_NAME, unlockStepUp } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import type { AuthContext } from "@/lib/session";

const req = (path: string) =>
  new NextRequest(`http://localhost${path}`, { headers: { cookie: `${SESSION_COOKIE_NAME}=jwt` } });
async function visit(path: string): Promise<AuthContext> {
  const ctx = await requireSession(req(path), path);
  if (ctx instanceof Response) throw new Error(`denied on ${path}`);
  return ctx;
}
const sessionRow = () => (h.db.tables.sessions as Array<Record<string, unknown>>)[0]!;

beforeEach(() => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  h.db = fakeSupabase({
    sessions: [{
      id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password",
      step_up_unlocked: false, step_up_unlocked_at: null, catalog_edit_unlocked_at: null,
      created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
      expires_at: future, revoked_at: null, ip_address: null, user_agent: null,
    }],
    users: [{ id: "user-1", name: "GM", email: "gm@example.test", role: "gm", active: true, language: "en" }],
    user_locations: [],
  });
});

describe("the catalog edit window is a fixed 15-minute clock", () => {
  it("only an admin-surface password opens it; a counts password does not", async () => {
    await unlockStepUp("session-1");
    expect(sessionRow().catalog_edit_unlocked_at).toBeNull();
    await unlockStepUp("session-1", { catalogWindow: true });
    expect(sessionRow().catalog_edit_unlocked_at).toEqual(expect.any(String));
  });

  it("background and outside requests never close it — language PATCH, dashboard prefetch, counts", async () => {
    await unlockStepUp("session-1", { catalogWindow: true });
    const stamped = sessionRow().catalog_edit_unlocked_at;
    for (const p of ["/api/users/me/language", "/dashboard", "/operations/counts", "/api/operations/counts", "/api/catering/quotes/q/send"]) {
      expect((await visit(p)).session.catalogEditUnlockedAt, p).toBe(stamped);
    }
    expect(sessionRow().catalog_edit_unlocked_at).toBe(stamped);
    expect(assertStepUp(await visit("/admin/recipes"), "E")).toEqual({ ok: true });
  });

  it("saving never extends it, and it closes AT 15 minutes (exclusive deadline)", async () => {
    await unlockStepUp("session-1", { catalogWindow: true });
    const stamped = sessionRow().catalog_edit_unlocked_at as string;
    const ctx = await visit("/api/admin/recipes/r/inputs");
    expect(sessionRow().catalog_edit_unlocked_at).toBe(stamped); // a write request moved nothing
    const t0 = Date.parse(stamped);
    expect(assertStepUp(ctx, "E", t0 + 899_999)).toEqual({ ok: true });
    expect(assertStepUp(ctx, "E", t0 + 900_000)).toEqual({ ok: false, code: "step_up_stale" });
    expect(assertStepUp(ctx, "E", t0 + 900_001)).toEqual({ ok: false, code: "step_up_stale" });
  });

  it("logout / revoke ends it — the session stops resolving at all", async () => {
    await unlockStepUp("session-1", { catalogWindow: true });
    expect(assertStepUp(await visit("/admin/recipes"), "E")).toEqual({ ok: true });
    await revokeSession("session-1");
    expect(await requireSession(req("/admin/recipes"), "/admin/recipes")).toBeInstanceOf(Response);
  });

  it("the session ending ends it", async () => {
    await unlockStepUp("session-1", { catalogWindow: true });
    sessionRow().expires_at = new Date(Date.now() - 1_000).toISOString();
    expect(await requireSession(req("/admin/recipes"), "/admin/recipes")).toBeInstanceOf(Response);
  });

  it("the shared flag keeps its own lifecycle — /dashboard clears IT, not the catalog clock", async () => {
    await unlockStepUp("session-1", { catalogWindow: true });
    const atDashboard = await visit("/dashboard");
    expect(atDashboard.session.stepUpUnlocked).toBe(false);
    expect(atDashboard.session.catalogEditUnlockedAt).toEqual(expect.any(String));
  });
});
```

Create `tests/step-up-grants.test.ts`:

```ts
/**
 * Catalog Phase 1 (Astra r1 P1-1) — always-prompt acts need a ONE-SHOT, action-bound grant.
 * A fresh edit window (or a fresh shared unlock) is never enough; a grant for X/T is refused
 * for Y or T'; a replay and an expired grant are refused; the step-up POST mints exactly the
 * grant it was asked for, only after a correct password.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeDb,
  session: vi.fn(),
  unlock: vi.fn(),
  verify: vi.fn(),
  audit: vi.fn(),
  setActive: vi.fn(),
  deactivateRecipe: vi.fn(),
  deactivateSku: vi.fn(),
}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/session", () => ({ requireSession: h.session, unlockStepUp: h.unlock }));
vi.mock("@/lib/auth", () => ({ verifyPassword: h.verify }));
vi.mock("@/lib/auth-flows", () => ({ upgradeLegacyPasswordHash: async () => undefined }));
vi.mock("@/lib/products", () => ({
  setProductActive: h.setActive,
  ProductError: class ProductError extends Error { constructor(public status: number, public code: string) { super(code); } },
}));
vi.mock("@/lib/recipes", () => ({
  updateRecipe: vi.fn(),
  deactivateRecipe: h.deactivateRecipe,
  RecipeError: class RecipeError extends Error { constructor(public status: number, public code: string) { super(code); } },
  RECIPE_WRITE_MIN: 7,
  RECIPE_DELETE_MIN: 8,
}));
vi.mock("@/lib/admin/skus", () => ({
  updateSku: vi.fn(),
  deactivateSku: h.deactivateSku,
  AdminSkuError: class AdminSkuError extends Error { constructor(public status: number, public code: string) { super(code); } },
  isSkuClass: () => true,
}));

import { consumeStepUpGrant, mintStepUpGrant } from "@/lib/admin/step-up-grants";
import { POST as stepUpPOST } from "@/app/api/auth/step-up/route";
import { POST as productActivePOST } from "@/app/api/admin/products/[id]/active/route";
import { DELETE as recipeDELETE } from "@/app/api/admin/recipes/[id]/route";
import { PATCH as skuPATCH } from "@/app/api/admin/skus/[id]/route";
import type { AuthContext } from "@/lib/session";

const SESSION = "5e551011-0000-4000-8000-000000000001";
const USER = "05e20001-0000-4000-8000-000000000001";
const T = "7a12e700-0000-4000-8000-000000000001";
const T2 = "7a12e700-0000-4000-8000-000000000002";
const NOW = new Date("2026-10-15T15:00:00.000Z");

function ctx(role = "gm", sessionId = SESSION): AuthContext {
  const fresh = new Date().toISOString();
  return {
    user: { id: USER, role },
    session: { id: sessionId, stepUpUnlocked: true, stepUpUnlockedAt: fresh, catalogEditUnlockedAt: fresh },
  } as unknown as AuthContext;
}
const grants = () => h.db.tables.step_up_grants as Array<Record<string, unknown>>;
const json = (url: string, method: string, body: unknown) => new NextRequest(url, { method, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  h.db = fakeSupabase({ step_up_grants: [], users: [{ id: USER, password_hash: "hmac2$stored" }] });
  h.setActive.mockResolvedValue({ pinnedRecipeCount: 0 });
});

describe("consumeStepUpGrant — one-shot, action-bound, session-bound", () => {
  beforeEach(async () => {
    await mintStepUpGrant({ sessionId: SESSION, userId: USER, purpose: { action: "product.retire", targetId: T }, now: NOW });
  });
  const at = (ms: number) => new Date(NOW.getTime() + ms);

  it("mint stores who, what, when", () => {
    expect(grants()[0]).toMatchObject({
      session_id: SESSION, user_id: USER, action: "product.retire", target_id: T,
      created_at: NOW.toISOString(), expires_at: at(120_000).toISOString(), consumed_at: null,
    });
  });

  it("refused for another action or another target — and those refusals do not spend it", async () => {
    expect(await consumeStepUpGrant(ctx(), "recipe.delete", T, at(1_000))).toEqual({ ok: false, code: "step_up_grant_required" });
    expect(await consumeStepUpGrant(ctx(), "product.retire", T2, at(1_000))).toEqual({ ok: false, code: "step_up_grant_required" });
    expect(await consumeStepUpGrant(ctx(), "product.retire", T, at(1_000))).toEqual({ ok: true });
  });

  it("works once; a replay is refused", async () => {
    expect(await consumeStepUpGrant(ctx(), "product.retire", T, at(1_000))).toEqual({ ok: true });
    expect(await consumeStepUpGrant(ctx(), "product.retire", T, at(2_000))).toEqual({ ok: false, code: "step_up_grant_required" });
  });

  it("refused at and after expiry", async () => {
    expect(await consumeStepUpGrant(ctx(), "product.retire", T, at(120_000))).toEqual({ ok: false, code: "step_up_grant_required" });
    expect(await consumeStepUpGrant(ctx(), "product.retire", T, at(119_999))).toEqual({ ok: true });
  });

  it("refused on another session", async () => {
    expect(await consumeStepUpGrant(ctx("gm", "5e551011-0000-4000-8000-000000000002"), "product.retire", T, at(1_000)))
      .toEqual({ ok: false, code: "step_up_grant_required" });
  });
});

describe("the destructive routes demand the grant — a fresh edit window is not enough", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("retire a product: refused without a grant, accepted once with it, replay refused", async () => {
    h.session.mockResolvedValue(ctx());
    const call = () => productActivePOST(json(`http://localhost/api/admin/products/${T}/active`, "POST", { active: false }), params(T));
    const refused = await call();
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe("step_up_grant_required");
    expect(h.setActive).not.toHaveBeenCalled();

    await mintStepUpGrant({ sessionId: SESSION, userId: USER, purpose: { action: "product.retire", targetId: T } });
    expect((await call()).status).toBe(200);
    expect(h.setActive).toHaveBeenCalledTimes(1);
    expect((await call()).status).toBe(403);
  });

  it("restoring a product is an ordinary edit inside the window", async () => {
    h.session.mockResolvedValue(ctx());
    const res = await productActivePOST(json(`http://localhost/api/admin/products/${T}/active`, "POST", { active: true }), params(T));
    expect(res.status).toBe(200);
  });

  it("delete a recipe: a grant for ANOTHER recipe is refused; the right one works", async () => {
    h.session.mockResolvedValue(ctx("moo"));
    await mintStepUpGrant({ sessionId: SESSION, userId: USER, purpose: { action: "recipe.delete", targetId: T2 } });
    const call = () => recipeDELETE(new NextRequest(`http://localhost/api/admin/recipes/${T}`, { method: "DELETE" }), params(T));
    expect((await call()).status).toBe(403);
    await mintStepUpGrant({ sessionId: SESSION, userId: USER, purpose: { action: "recipe.delete", targetId: T } });
    expect((await call()).status).toBe(200);
    expect(h.deactivateRecipe).toHaveBeenCalledTimes(1);
  });

  it("deactivate a SKU needs the grant; reactivate needs only the window", async () => {
    h.session.mockResolvedValue(ctx());
    const call = (active: boolean) => skuPATCH(json(`http://localhost/api/admin/skus/${T}`, "PATCH", { active }), params(T));
    expect((await call(false)).status).toBe(403);
    expect(h.deactivateSku).not.toHaveBeenCalled();
    await mintStepUpGrant({ sessionId: SESSION, userId: USER, purpose: { action: "sku.deactivate", targetId: T } });
    expect((await call(false)).status).toBe(200);
    expect((await call(true)).status).toBe(200);
    expect(h.deactivateSku).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/auth/step-up mints exactly what it was asked for", () => {
  const call = (body: unknown) => stepUpPOST(json("http://localhost/api/auth/step-up", "POST", body));

  it("a malformed purpose is a 400 before the password is checked", async () => {
    h.session.mockResolvedValue(ctx());
    const res = await call({ password: "right", purpose: { action: "user.delete", targetId: T } });
    expect(res.status).toBe(400);
    expect(h.verify).not.toHaveBeenCalled();
    expect(grants()).toEqual([]);
  });

  it("a wrong password mints nothing", async () => {
    h.session.mockResolvedValue(ctx());
    h.verify.mockResolvedValue(false);
    expect((await call({ password: "wrong", purpose: { action: "recipe.delete", targetId: T } })).status).toBe(401);
    expect(grants()).toEqual([]);
    expect(h.unlock).not.toHaveBeenCalled();
  });

  it("a right password opens the catalog window when asked and mints the one grant", async () => {
    h.session.mockResolvedValue(ctx());
    h.verify.mockResolvedValue(true);
    const res = await call({ password: "right", catalogWindow: true, purpose: { action: "recipe.delete", targetId: T } });
    expect(res.status).toBe(200);
    expect(h.unlock).toHaveBeenCalledWith(SESSION, { catalogWindow: true });
    expect(grants()).toHaveLength(1);
    expect(grants()[0]).toMatchObject({ session_id: SESSION, user_id: USER, action: "recipe.delete", target_id: T });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth_step_up_success",
      metadata: { edit_window_seconds: 900, grant: { action: "recipe.delete", target_id: T } },
    }));
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run tests/catalog-window-lifecycle.test.ts tests/step-up-grants.test.ts`
Expected: FAIL. In the lifecycle file, `unlockStepUp` ignores the option, so `catalog_edit_unlocked_at` stays null and every case fails. `step-up-grants` fails with `Failed to resolve import "@/lib/admin/step-up-grants"`.

- [ ] **Step 4: Add the field to `Session` (`lib/types.ts`)**

Replace:

```ts
  stepUpUnlocked: boolean;
  stepUpUnlockedAt: string | null;
```

with:

```ts
  stepUpUnlocked: boolean;
  stepUpUnlockedAt: string | null;
  /** Catalog edit window (Tier E, 0257). Optional so pre-0257 shapes and test literals still type. */
  catalogEditUnlockedAt?: string | null;
```

- [ ] **Step 5: The catalog clock in `lib/session.ts`** (stamped by the password, mapped into the context; no navigation clear)

In `interface SessionRow`, replace:

```ts
  step_up_unlocked_at: string | null;
  created_at: string | null;
```

with:

```ts
  step_up_unlocked_at: string | null;
  /** 0257 — absent before the migration is applied (select("*")). */
  catalog_edit_unlocked_at?: string | null;
  created_at: string | null;
```

In `mapSession`, replace:

```ts
    stepUpUnlockedAt: r.step_up_unlocked_at,
```

with:

```ts
    stepUpUnlockedAt: r.step_up_unlocked_at,
    catalogEditUnlockedAt: r.catalog_edit_unlocked_at ?? null,
```

Leave the last-activity touch and the shared-flag auto-clear exactly as they are. The catalog clock is never cleared by a request: it is a fixed window (Astra r2 design decision), and logout / revoke / session expiry end it by ending the session itself (`requireSessionCore` denies a revoked or expired row before any context exists).

Replace `unlockStepUp`:

```ts
export async function unlockStepUp(sessionId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await sb
    .from("sessions")
    .update({ step_up_unlocked: true, step_up_unlocked_at: now })
    .eq("id", sessionId);
  if (error) throw new Error(`unlockStepUp failed: ${error.message}`);
}
```

with:

```ts
/**
 * Stamp a successful password. `catalogWindow` (catalog Phase 1, 0257) is true only for a
 * password typed on the admin surface (StepUpProvider → PasswordModal): it ALSO (re)starts the
 * fixed 15-minute catalog edit window. A counts or catering password never touches it. This is
 * the ONLY writer of either clock (pinned by tests/step-up-edit-window-wiring.test.ts).
 */
export async function unlockStepUp(sessionId: string, opts: { catalogWindow?: boolean } = {}): Promise<void> {
  const sb = getServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await sb
    .from("sessions")
    .update({ step_up_unlocked: true, step_up_unlocked_at: now, ...(opts.catalogWindow ? { catalog_edit_unlocked_at: now } : {}) })
    .eq("id", sessionId);
  if (error) throw new Error(`unlockStepUp failed: ${error.message}`);
}
```

- [ ] **Step 6: Rewrite `lib/admin/step-up.ts`** (replace the whole file)

```ts
import type { AuthContext } from "@/lib/session";
import {
  DEFAULT_EDIT_WINDOW_SECONDS,
  DEFAULT_FRESH_SECONDS,
  isFreshWithin,
  isInsideWindow,
  parseWindowSeconds,
  type StepUpTier,
} from "@/lib/admin/step-up-shared";

/**
 * Admin step-up enforcement (C.44 Module 1; Tier E added 2026-10-15, catalog Phase 1).
 *
 *   Tier A — sessions.step_up_unlocked (any age).
 *   Tier B — step_up_unlocked AND step_up_unlocked_at within ADMIN_STEP_UP_FRESH_SECONDS (120 s).
 *   Tier E — sessions.catalog_edit_unlocked_at (0257) within ADMIN_STEP_UP_EDIT_WINDOW_SECONDS
 *            (900 s, never shorter than B). Its OWN fixed clock: stamped only by an
 *            admin-surface password, never extended, never cleared by navigation.
 * The always-prompt catalog acts use none of these: they consume a one-shot grant
 * (lib/admin/step-up-grants.ts). Pure over AuthContext; `now` is injectable.
 */
export type { StepUpTier };

export type StepUpResult =
  | { ok: true }
  | { ok: false; code: "step_up_required" | "step_up_stale" };

/** Tier B freshness window in ms. Override via ADMIN_STEP_UP_FRESH_SECONDS. */
export function stepUpFreshWindowMs(): number {
  return parseWindowSeconds(process.env.ADMIN_STEP_UP_FRESH_SECONDS, DEFAULT_FRESH_SECONDS) * 1000;
}

/** Tier E edit window in ms. Override via ADMIN_STEP_UP_EDIT_WINDOW_SECONDS; never shorter than Tier B. */
export function stepUpEditWindowMs(): number {
  const edit = parseWindowSeconds(process.env.ADMIN_STEP_UP_EDIT_WINDOW_SECONDS, DEFAULT_EDIT_WINDOW_SECONDS) * 1000;
  return Math.max(edit, stepUpFreshWindowMs());
}

export function assertStepUp(
  ctx: AuthContext,
  tier: StepUpTier,
  now: number = Date.now(),
): StepUpResult {
  if (tier === "E") {
    const at = ctx.session.catalogEditUnlockedAt ?? null;
    if (at === null) return { ok: false, code: "step_up_required" };
    // EXCLUSIVE deadline (Astra r3 #2): at exactly 15:00 the window is closed. Tier B below keeps
    // its existing inclusive boundary.
    return isInsideWindow(at, now, stepUpEditWindowMs()) ? { ok: true } : { ok: false, code: "step_up_stale" };
  }
  if (!ctx.session.stepUpUnlocked) return { ok: false, code: "step_up_required" };
  if (tier === "A") return { ok: true };
  if (!isFreshWithin(ctx.session.stepUpUnlockedAt, now, stepUpFreshWindowMs())) {
    return { ok: false, code: "step_up_stale" };
  }
  return { ok: true };
}
```

Then add server-side E cases to `tests/step-up-edit-window.test.ts`. Add these imports at the top:

```ts
import { afterEach } from "vitest";
import { assertStepUp, stepUpEditWindowMs, stepUpFreshWindowMs } from "@/lib/admin/step-up";
import type { AuthContext } from "@/lib/session";
```

and append:

```ts
function ctx(sharedAt: string | null, catalogAt: string | null, shared = sharedAt !== null): AuthContext {
  return { session: { stepUpUnlocked: shared, stepUpUnlockedAt: sharedAt, catalogEditUnlockedAt: catalogAt } } as unknown as AuthContext;
}
afterEach(() => {
  delete process.env.ADMIN_STEP_UP_EDIT_WINDOW_SECONDS;
  delete process.env.ADMIN_STEP_UP_FRESH_SECONDS;
});

describe("Tier E on the server — its own clock, checked on every write", () => {
  it("defaults to 15 minutes with an EXCLUSIVE deadline: 899 999 ms ok, 900 000 and 900 001 refused", () => {
    expect(stepUpEditWindowMs()).toBe(900_000);
    expect(assertStepUp(ctx(null, ago(899_999)), "E", NOW)).toEqual({ ok: true });
    expect(assertStepUp(ctx(null, ago(900_000)), "E", NOW)).toEqual({ ok: false, code: "step_up_stale" });
    expect(assertStepUp(ctx(null, ago(900_001)), "E", NOW)).toEqual({ ok: false, code: "step_up_stale" });
  });

  it("Tier B's boundary is unchanged: inclusive at 120 000 ms", () => {
    expect(assertStepUp(ctx(ago(120_000), null), "B", NOW)).toEqual({ ok: true });
    expect(assertStepUp(ctx(ago(120_001), null), "B", NOW)).toEqual({ ok: false, code: "step_up_stale" });
  });

  it("the SHARED unlock never satisfies E, and the catalog clock never satisfies B", () => {
    expect(assertStepUp(ctx(ago(1_000), null), "E", NOW)).toEqual({ ok: false, code: "step_up_required" });
    expect(assertStepUp(ctx(null, ago(1_000)), "B", NOW)).toEqual({ ok: false, code: "step_up_required" });
  });

  it("garbage or future timestamps are stale", () => {
    expect(assertStepUp(ctx(null, "nope"), "E", NOW)).toEqual({ ok: false, code: "step_up_stale" });
    expect(assertStepUp(ctx(null, new Date(NOW + 60_000).toISOString()), "E", NOW)).toEqual({ ok: false, code: "step_up_stale" });
  });

  it("A and B are unchanged", () => {
    expect(assertStepUp(ctx(ago(3_600_000), null), "A", NOW)).toEqual({ ok: true });
    expect(assertStepUp(ctx(ago(30_000), null), "B", NOW)).toEqual({ ok: true });
    expect(assertStepUp(ctx(ago(121_000), null), "B", NOW)).toEqual({ ok: false, code: "step_up_stale" });
    expect(stepUpFreshWindowMs()).toBe(120_000);
  });

  it("the env override works, garbage falls back, and E is never shorter than B", () => {
    process.env.ADMIN_STEP_UP_EDIT_WINDOW_SECONDS = "1800";
    expect(stepUpEditWindowMs()).toBe(1_800_000);
    process.env.ADMIN_STEP_UP_EDIT_WINDOW_SECONDS = "abc";
    expect(stepUpEditWindowMs()).toBe(900_000);
    process.env.ADMIN_STEP_UP_EDIT_WINDOW_SECONDS = "60";
    expect(stepUpEditWindowMs()).toBe(120_000);
  });
});
```

- [ ] **Step 7: Create `lib/admin/step-up-grants.ts`**

```ts
/**
 * One-shot step-up grants (catalog Phase 1, 0257; Astra r1 P1-1). SERVER-ONLY (service role).
 *
 * The always-prompt catalog acts — retire a product, delete a recipe, deactivate a SKU — accept
 * neither the edit window nor a "fresh" shared unlock. The step-up POST mints a grant for ONE
 * (action, target), bound to the session and the user, valid 120 s; the destructive route
 * consumes it with ONE conditional UPDATE. Postgres re-checks the WHERE under the row lock, so a
 * concurrent second consume matches 0 rows: single use is a property of the statement, not of a
 * read-then-write. A refused consume spends nothing.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import { grantExpiresAt, type GrantAction, type StepUpPurpose } from "@/lib/admin/step-up-shared";

export async function mintStepUpGrant(args: {
  sessionId: string;
  userId: string;
  purpose: StepUpPurpose;
  now?: Date;
}): Promise<void> {
  const now = args.now ?? new Date();
  const { error } = await getServiceRoleClient()
    .from("step_up_grants")
    .insert({
      session_id: args.sessionId,
      user_id: args.userId,
      action: args.purpose.action,
      target_id: args.purpose.targetId,
      created_at: now.toISOString(),
      expires_at: grantExpiresAt(now).toISOString(),
    });
  if (error) throw new Error(`mintStepUpGrant: ${error.message}`);
}

export type GrantResult = { ok: true } | { ok: false; code: "step_up_grant_required" };

export async function consumeStepUpGrant(
  ctx: AuthContext,
  action: GrantAction,
  targetId: string,
  now: Date = new Date(),
): Promise<GrantResult> {
  const nowIso = now.toISOString();
  const { data, error } = await getServiceRoleClient()
    .from("step_up_grants")
    .update({ consumed_at: nowIso })
    .eq("session_id", ctx.session.id)
    .eq("user_id", ctx.user.id)
    .eq("action", action)
    .eq("target_id", targetId)
    .is("consumed_at", null)
    .gt("expires_at", nowIso)
    .select("id");
  if (error) throw new Error(`consumeStepUpGrant: ${error.message}`);
  return (data?.length ?? 0) > 0 ? { ok: true } : { ok: false, code: "step_up_grant_required" };
}
```

- [ ] **Step 8: The step-up POST takes `catalogWindow` and `purpose`**

In `app/api/auth/step-up/route.ts`:

Add after `import { ROLES, type RoleCode } from "@/lib/roles";`:

```ts
import { stepUpEditWindowMs } from "@/lib/admin/step-up";
import { parseStepUpPurpose } from "@/lib/admin/step-up-shared";
import { mintStepUpGrant } from "@/lib/admin/step-up-grants";
```

Replace the doc line ` * Body: { password: string }` with:

```ts
 * Body: { password: string; catalogWindow?: boolean; purpose?: { action, targetId } }
 *   catalogWindow — sent by the admin StepUpProvider: this password also opens the 15-minute
 *                   catalog edit window (sessions.catalog_edit_unlocked_at, 0257).
 *   purpose       — a ONE-SHOT grant for one destructive catalog act (lib/admin/step-up-grants.ts),
 *                   minted only after the password verifies. Malformed → 400 before any check.
```

Insert directly after the `password must not be empty` block (after its closing `}`):

```ts
  const raw = parsed as unknown as Record<string, unknown>;
  const purpose = parseStepUpPurpose(raw.purpose);
  if (purpose === "invalid") {
    return jsonError(400, "invalid_payload", { field: "purpose", message: "purpose must name a known action and a target id" });
  }
  const catalogWindow = raw.catalogWindow === true;
```

Replace the success block:

```ts
  // 5. Success
  await unlockStepUp(session.id);
  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "auth_step_up_success",
    resourceTable: "sessions",
    resourceId: session.id,
    metadata: {},
    ipAddress,
    userAgent,
  });
```

with:

```ts
  // 5. Success — stamp the shared flag (and the catalog window when asked), then mint the
  //    one grant the purpose names. Both are recorded on the success row.
  await unlockStepUp(session.id, { catalogWindow });
  if (purpose) await mintStepUpGrant({ sessionId: session.id, userId: user.id, purpose });
  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "auth_step_up_success",
    resourceTable: "sessions",
    resourceId: session.id,
    metadata: {
      edit_window_seconds: catalogWindow ? stepUpEditWindowMs() / 1000 : null,
      grant: purpose ? { action: purpose.action, target_id: purpose.targetId } : null,
    },
    ipAddress,
    userAgent,
  });
```

- [ ] **Step 9: Run what can pass now**

Run: `npx vitest run tests/catalog-window-lifecycle.test.ts tests/step-up-edit-window.test.ts tests/auth-step-up-hardening.test.ts`
Expected: PASS, 0 failed.

Run: `npx vitest run tests/step-up-grants.test.ts`
Expected: the `consumeStepUpGrant` and `POST /api/auth/step-up` describes PASS. The **destructive routes** describe still FAILS (routes untouched until Task 5): the retire case gets 200 instead of 403, because the route still asserts Tier B on a fresh shared flag. That is the P1-1 hole, shown live.

- [ ] **Step 10: Commit**

```bash
git add tests/fake-supabase.ts tests/catalog-window-lifecycle.test.ts tests/step-up-grants.test.ts tests/step-up-edit-window.test.ts lib/types.ts lib/session.ts lib/admin/step-up.ts lib/admin/step-up-grants.ts app/api/auth/step-up/route.ts
git commit -F - <<'EOF'
feat(step-up): catalog window on its own clock + one-shot grants minted by the step-up POST

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 4: Client — provider clocks, grants, forget-on-refusal, the modal

**Files:**
- Rewrite: `components/admin/StepUpProvider.tsx`
- Modify: `components/auth/PasswordModal.tsx`
- Create: `components/admin/useStepUpPost.ts`
- Modify: `app/admin/layout.tsx`, `components/admin/catalog/CatalogClient.tsx`
- Test: `tests/step-up-edit-window-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/step-up-edit-window-wiring.test.ts`:

```ts
/** Catalog Phase 1 — how the window and the grants are wired on the client. Source pins. */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");
function filesUnder(...roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    for (const entry of readdirSync(join(ROOT, root), { recursive: true, encoding: "utf8" })) {
      out.push(`${root}/${entry.split(sep).join("/")}`);
    }
  }
  return out.sort();
}

describe("the window is decided once, and the server stays the authority", () => {
  it("StepUpProvider decides over refs of BOTH clocks and exposes the grant and forget lanes", () => {
    const src = read("components/admin/StepUpProvider.tsx");
    expect(src).toContain('from "@/lib/admin/step-up-shared"');
    expect(src).toContain(
      "stepUpDecision(tier, { unlocked: unlockedRef.current, catalogUnlockedAt: catalogRef.current }, Date.now(), editWindowMs)",
    );
    expect(src).toContain("requestStepUpGrant");
    expect(src).toContain("forgetStepUp");
  });

  it("the admin layout hands the server's clock and window to the client and opens the window", () => {
    const layout = read("app/admin/layout.tsx");
    expect(layout).toContain("catalogUnlockedAt={auth.session.catalogEditUnlockedAt ?? null}");
    expect(layout).toContain("editWindowMs={stepUpEditWindowMs()}");
    expect(layout).toMatch(/\n\s+catalogWindow\n/);
  });

  it("the modal sends the purpose and the window flag; the reactive catalog modal opens the window too", () => {
    const modal = read("components/auth/PasswordModal.tsx");
    expect(modal).toContain("...(catalogWindow ? { catalogWindow: true } : {})");
    expect(modal).toContain("...(purpose ? { purpose } : {})");
    expect(read("components/admin/catalog/CatalogClient.tsx")).toMatch(/<PasswordModal\s+catalogWindow/);
  });

  it("the reactive catalog modal reports to the provider: confirm advances the clock, refusal forgets it (Astra r3 #1)", () => {
    const catalog = read("components/admin/catalog/CatalogClient.tsx");
    expect(catalog).toContain("onConfirm={async () => { noteStepUpConfirmed(); if (pendingRef.current) await pendingRef.current(); }}");
    expect(catalog.match(/b\.code === "step_up_stale"\) \{\n\s+forgetStepUp\(\);/g)).toHaveLength(2);
    const provider = read("components/admin/StepUpProvider.tsx");
    expect(provider).toContain("confirmClientUnlock({ unlocked: unlockedRef.current, catalogUnlockedAt: catalogRef.current }, now, catalogWindow)");
    expect(provider).toMatch(/const handleConfirm = useCallback\(\(\) => \{[\s\S]{0,120}noteStepUpConfirmed\(\);/);
  });

  it("a successful unlock is audited with the window and the grant it opened", () => {
    expect(read("app/api/auth/step-up/route.ts")).toMatch(
      /action: "auth_step_up_success",[\s\S]{0,300}edit_window_seconds: catalogWindow \? stepUpEditWindowMs\(\) \/ 1000 : null/,
    );
  });

  it("useStepUpPost forgets an unlock the server refused", () => {
    expect(read("components/admin/useStepUpPost.ts")).toContain(
      "if (!result.ok && isStepUpRefusal(result.code)) forgetStepUp();",
    );
  });

  it("only unlockStepUp stamps either clock, so neither window can slide", () => {
    const writers = (re: RegExp) =>
      filesUnder("app", "lib", "components").filter((f) => /\.(ts|tsx)$/.test(f)).filter((f) => re.test(read(f)));
    expect(writers(/step_up_unlocked_at:\s*now/)).toEqual(["lib/session.ts"]);
    expect(writers(/catalog_edit_unlocked_at:\s*now/)).toEqual(["lib/session.ts"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/step-up-edit-window-wiring.test.ts`
Expected: FAIL. The provider, layout, modal and useStepUpPost cases fail; the audit and "cannot slide" cases PASS (Task 3).

- [ ] **Step 3: Rewrite `components/admin/StepUpProvider.tsx`** (replace the whole file)

Keep the docstring phrase `requestStepUp(tier)`. The tier-map test reads it as this file's `VAR:tier` entry.

```tsx
"use client";

/**
 * StepUpProvider — client orchestration for admin step-up (C.44 Module 1; catalog Phase 1
 * 2026-10-15 adds Tier E and one-shot grants). Hosts a single PasswordModal for the admin
 * subtree and exposes requestStepUp(tier) and requestStepUpGrant(purpose) to descendants.
 *
 *   Tier A — if the shared flag is set, resolve "ok" without a prompt; else prompt.
 *   Tier B — always prompt (the server-side freshness check is the real gate).
 *   Tier E — the catalog/recipe edit window, on its OWN clock: no prompt while this device's
 *            catalog unlock is inside the window (minus a 30 s margin); else prompt.
 *   Grant  — ALWAYS prompt; the password POST carries the purpose and the server mints one
 *            single-use grant for exactly that action and target.
 *
 * `catalogWindow` is true only on the admin surface: its passwords also open the window. The
 * client's memory is ADVISORY — when a route answers step_up_required / step_up_stale, the
 * caller runs forgetStepUp() (useStepUpPost does it) so the next request prompts. Refs mirror
 * the state so a forget or a confirm takes effect for a request made in the same tick.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { PasswordModal } from "@/components/auth/PasswordModal";
import {
  confirmClientUnlock,
  DEFAULT_EDIT_WINDOW_MS,
  stepUpDecision,
  type StepUpPurpose,
  type StepUpTier,
} from "@/lib/admin/step-up-shared";

export { stepUpDecision };

interface StepUpContextValue {
  /** Ensure step-up for the tier; resolves "ok" once satisfied (possibly after a prompt) or "cancelled". */
  requestStepUp: (tier: StepUpTier) => Promise<"ok" | "cancelled">;
  /** Always prompt, and mint a one-shot grant for exactly this destructive act. */
  requestStepUpGrant: (purpose: StepUpPurpose) => Promise<"ok" | "cancelled">;
  /** Drop this device's memory of an unlock the server refused, so the next request prompts. */
  forgetStepUp: () => void;
  /** A password confirmed by an admin modal the provider does not own (the reactive CatalogClient
   *  modal): record it exactly as the provider's own confirm would (Astra r3 #1). */
  noteStepUpConfirmed: () => void;
  unlocked: boolean;
  unlockedAt: string | null;
}

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function StepUpProvider({
  unlocked: initialUnlocked,
  unlockedAt: initialUnlockedAt,
  catalogUnlockedAt: initialCatalogUnlockedAt = null,
  catalogWindow = false,
  editWindowMs = DEFAULT_EDIT_WINDOW_MS,
  children,
}: {
  unlocked: boolean;
  unlockedAt: string | null;
  /** The server's catalog clock (sessions.catalog_edit_unlocked_at) at render. */
  catalogUnlockedAt?: string | null;
  /** True on the admin surface: a password typed here also opens the catalog edit window. */
  catalogWindow?: boolean;
  /** The server's Tier E window (lib/admin/step-up.ts stepUpEditWindowMs) — how the env override reaches the client. */
  editWindowMs?: number;
  children: ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(initialUnlocked);
  const [unlockedAt, setUnlockedAt] = useState<string | null>(initialUnlockedAt);
  const unlockedRef = useRef(initialUnlocked);
  const catalogRef = useRef<string | null>(initialCatalogUnlockedAt);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPurpose, setModalPurpose] = useState<StepUpPurpose | null>(null);
  const resolverRef = useRef<((r: "ok" | "cancelled") => void) | null>(null);

  const openModal = useCallback(
    (purpose: StepUpPurpose | null) =>
      new Promise<"ok" | "cancelled">((resolve) => {
        resolverRef.current = resolve;
        setModalPurpose(purpose);
        setModalOpen(true);
      }),
    [],
  );

  const requestStepUp = useCallback(
    (tier: StepUpTier): Promise<"ok" | "cancelled"> => {
      if (stepUpDecision(tier, { unlocked: unlockedRef.current, catalogUnlockedAt: catalogRef.current }, Date.now(), editWindowMs) === "proceed") {
        return Promise.resolve("ok");
      }
      return openModal(null);
    },
    [editWindowMs, openModal],
  );

  const requestStepUpGrant = useCallback((purpose: StepUpPurpose) => openModal(purpose), [openModal]);

  const forgetStepUp = useCallback(() => {
    unlockedRef.current = false;
    catalogRef.current = null;
    setUnlocked(false);
    setUnlockedAt(null);
  }, []);

  // ONE way to record a confirmed password, whichever admin modal took it.
  const noteStepUpConfirmed = useCallback(() => {
    const now = new Date().toISOString();
    const next = confirmClientUnlock({ unlocked: unlockedRef.current, catalogUnlockedAt: catalogRef.current }, now, catalogWindow);
    unlockedRef.current = next.unlocked;
    catalogRef.current = next.catalogUnlockedAt;
    setUnlocked(true);
    setUnlockedAt(now);
  }, [catalogWindow]);

  const handleConfirm = useCallback(() => {
    // PasswordModal posts /api/auth/step-up and calls onConfirm only on 200.
    noteStepUpConfirmed();
    setModalOpen(false);
    setModalPurpose(null);
    resolverRef.current?.("ok");
    resolverRef.current = null;
  }, [noteStepUpConfirmed]);

  const handleCancel = useCallback(() => {
    setModalOpen(false);
    setModalPurpose(null);
    resolverRef.current?.("cancelled");
    resolverRef.current = null;
  }, []);

  return (
    <StepUpContext.Provider value={{ requestStepUp, requestStepUpGrant, forgetStepUp, noteStepUpConfirmed, unlocked, unlockedAt }}>
      {children}
      <PasswordModal
        open={modalOpen}
        purpose={modalPurpose}
        catalogWindow={catalogWindow}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </StepUpContext.Provider>
  );
}

export function useStepUp(): StepUpContextValue {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error("useStepUp must be used within <StepUpProvider>.");
  return ctx;
}
```

- [ ] **Step 4: `components/auth/PasswordModal.tsx` sends the purpose and the window flag**

Add after `import { useTranslation } from "@/lib/i18n/provider";`:

```tsx
import type { StepUpPurpose } from "@/lib/admin/step-up-shared";
```

Replace:

```tsx
export interface PasswordModalProps {
  open: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}
```

with:

```tsx
export interface PasswordModalProps {
  open: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
  /** Catalog Phase 1: mint a one-shot grant for exactly this destructive act with the password. */
  purpose?: StepUpPurpose | null;
  /** Catalog Phase 1: true on the admin surface — this password also opens the 15-minute catalog edit window. */
  catalogWindow?: boolean;
}
```

Replace `export function PasswordModal({ open, onConfirm, onCancel }: PasswordModalProps) {` with:

```tsx
export function PasswordModal({ open, onConfirm, onCancel, purpose = null, catalogWindow = false }: PasswordModalProps) {
```

Replace `          body: JSON.stringify({ password }),` with:

```tsx
          body: JSON.stringify({ password, ...(catalogWindow ? { catalogWindow: true } : {}), ...(purpose ? { purpose } : {}) }),
```

Replace `    [password, submitting, retryRemaining, onConfirm, onCancel, t],` with:

```tsx
    [password, submitting, retryRemaining, onConfirm, onCancel, t, purpose, catalogWindow],
```

- [ ] **Step 5: Create `components/admin/useStepUpPost.ts`**

```ts
"use client";

/**
 * useStepUpPost — postJson for a step-up-gated write, with the one extra duty the Tier E
 * window needs: when the server refuses with step_up_required / step_up_stale, tell
 * StepUpProvider to forget its unlock so the NEXT tap prompts (catalog Phase 1, 2026-10-15).
 */
import { useCallback } from "react";

import { useStepUp } from "@/components/admin/StepUpProvider";
import { postJson, type PostResult } from "@/components/admin/vendors/shared";
import { isStepUpRefusal } from "@/lib/admin/step-up-shared";

type Method = "POST" | "PUT" | "PATCH" | "DELETE";

export function useStepUpPost(): (url: string, body: unknown, method?: Method) => Promise<PostResult> {
  const { forgetStepUp } = useStepUp();
  return useCallback(
    async (url: string, body: unknown, method: Method = "POST"): Promise<PostResult> => {
      const result = await postJson(url, body, method);
      if (!result.ok && isStepUpRefusal(result.code)) forgetStepUp();
      return result;
    },
    [forgetStepUp],
  );
}
```

- [ ] **Step 6: `app/admin/layout.tsx`**

Add after `import { StepUpProvider } from "@/components/admin/StepUpProvider";`:

```tsx
import { stepUpEditWindowMs } from "@/lib/admin/step-up";
```

Replace:

```tsx
      <StepUpProvider
        unlocked={auth.session.stepUpUnlocked}
        unlockedAt={auth.session.stepUpUnlockedAt}
      >
```

with:

```tsx
      <StepUpProvider
        unlocked={auth.session.stepUpUnlocked}
        unlockedAt={auth.session.stepUpUnlockedAt}
        catalogUnlockedAt={auth.session.catalogEditUnlockedAt ?? null}
        catalogWindow
        editWindowMs={stepUpEditWindowMs()}
      >
```

(`app/(authed)/catering/pipeline/page.tsx` and `app/(authed)/stations/page.tsx` mount the provider without the window, because they are not catalog surfaces. Leave them unchanged.)

- [ ] **Step 7: The reactive catalog modal opens the window**

In `components/admin/catalog/CatalogClient.tsx`, replace:

```tsx
      <PasswordModal
        open={stepUpOpen}
```

with:

```tsx
      <PasswordModal
        catalogWindow
        open={stepUpOpen}
```

The item-type route moves to Tier E in Task 5. Without this flag its reactive retry would loop forever.

The provider must also LEARN about this confirm (Astra r3 #1). Otherwise its catalog clock stays null, and a recipe edit right after the catalog password prompts again. Make these three replacements in the same file.

Add after `import { PasswordModal } from "@/components/auth/PasswordModal";`:

```tsx
import { useStepUp } from "@/components/admin/StepUpProvider";
```

Replace `  const [stepUpOpen, setStepUpOpen] = useState(false);` with:

```tsx
  const [stepUpOpen, setStepUpOpen] = useState(false);
  // This modal is not the provider's; report its confirms and refusals so the provider's catalog
  // clock stays true for every other admin surface (Astra r3 #1).
  const { noteStepUpConfirmed, forgetStepUp } = useStepUp();
```

Replace (2 occurrences, the seasonal lane and the item-type lane):

```tsx
      if (b.code === "step_up_required" || b.code === "step_up_stale") {
        pendingRef.current =
```

with:

```tsx
      if (b.code === "step_up_required" || b.code === "step_up_stale") {
        forgetStepUp();
        pendingRef.current =
```

Replace `        onConfirm={async () => { if (pendingRef.current) await pendingRef.current(); }}` with:

```tsx
        onConfirm={async () => { noteStepUpConfirmed(); if (pendingRef.current) await pendingRef.current(); }}
```

- [ ] **Step 8: Run the tests and tsc**

Run: `npx vitest run tests/step-up-edit-window-wiring.test.ts tests/step-up-tier-map.test.ts`
Expected: PASS, 0 failed. The tier map is unchanged so far: the provider still reads `VAR:tier`, and `requestStepUpGrant(` does not match the `requestStepUp(` pattern.

Run: `npx tsc --noEmit 2>&1 | grep -v TS2307 | grep "error TS"`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add components/admin/StepUpProvider.tsx components/auth/PasswordModal.tsx components/admin/useStepUpPost.ts app/admin/layout.tsx components/admin/catalog/CatalogClient.tsx tests/step-up-edit-window-wiring.test.ts
git commit -F - <<'EOF'
feat(step-up): client catalog clock, one-shot grant prompts, forget-on-refusal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 5: Every ordinary catalog edit → Tier E; the three destructive acts → grants

**Server — to Tier E (one literal each, all via the script below):**
- from B: `recipes/route.ts`, `recipes/full`, `recipes/[id]` (PATCH), `recipes/[id]/inputs`, `recipes/[id]/outputs`, `recipes/edges`, `skus/route.ts`, `products/route.ts`, `items/[itemId]/sold-directly`, `menu-items/route.ts`, `menu-items/[id]/price`, `weights`;
- from A (Astra P1-2): `catalog/item-type/[id]`, `products/[id]`, `products/[id]/members` (×2), `products/[id]/primary`, `skus/[id]/pack-chain`, `skus/[id]/price`, `skus/[id]/location-settings`, `skus/[id]` (identity edits and reactivation).

**Server — to one-shot grants:** `products/[id]/active` (`active:false` → `product.retire`; restore → E), `recipes/[id]` DELETE (`recipe.delete`), `skus/[id]` PATCH `{active:false}` (`sku.deactivate`).

**Unchanged:** `recipes/yield-nudge` (B; driven from `/production` outside `/admin`), `skus/measure-units`, `skus/pack-formats`, `skus/pending`, vendors, the toast map, templates, users and all catering routes. The Items-page registry edits run through `checklist-templates/registry*`, which the template editor shares. They stay **B**: stricter than E, so nothing escapes the window there. Phase 2's item page revisits them.

**Clients (Task 5 script):** `RecipeBuilder`, `SkuCatalogClient`, `VendorSkusCard`, `SkuCostPanel`, `SkuLocationOverlay`, `ProductsClient`, `ItemRow`, `WeightBoardClient`, `MenuPriceEditor`.

**Files:**
- Modify: the routes and clients above; rewrite `app/api/admin/products/[id]/active/route.ts`
- Modify: `components/admin/recipes/shared.ts`, `components/admin/skus/shared.ts`, `components/admin/products/shared.ts`, `lib/i18n/en.json`, `lib/i18n/es.json`
- Modify: `tests/step-up-tier-map.test.ts`, `tests/dynamic-pars-write.test.ts`, `tests/menu-prices-data.test.ts`, `tests/menu-prices-ui.test.ts`
- Modify: `AGENTS.md`

- [ ] **Step 1: Re-pin the tier map and add the grant map (the failing test)**

In `tests/step-up-tier-map.test.ts`:

1. In `tiersIn`, replace `"([AB])"` with `"([ABE])"`:

```ts
  const literals = [...src.matchAll(new RegExp(`${fn}\\(${args}"([ABE])"`, "g"))].map((m) => m[1] as string);
```

2. In `SERVER_TIER_MAP`, set these entries (replace each existing line):

```ts
  "app/api/admin/catalog/item-type/[id]/route.ts": ["E"],
  "app/api/admin/items/[itemId]/sold-directly/route.ts": ["E"],
  "app/api/admin/menu-items/route.ts": ["E"],
  "app/api/admin/menu-items/[id]/price/route.ts": ["E"],
  // Catalog Phase 1: restore = edit window; retire = one-shot grant (GRANT_SERVER_MAP).
  "app/api/admin/products/[id]/active/route.ts": ["E"],
  "app/api/admin/products/[id]/members/route.ts": ["E"],
  "app/api/admin/products/[id]/primary/route.ts": ["E"],
  "app/api/admin/products/[id]/route.ts": ["E"],
  "app/api/admin/products/route.ts": ["E"],
  "app/api/admin/recipes/[id]/inputs/route.ts": ["E"],
  "app/api/admin/recipes/[id]/outputs/route.ts": ["E"],
  // Catalog Phase 1: PATCH = edit window; DELETE = one-shot grant (GRANT_SERVER_MAP).
  "app/api/admin/recipes/[id]/route.ts": ["E"],
  "app/api/admin/recipes/edges/route.ts": ["E"],
  "app/api/admin/recipes/full/route.ts": ["E"],
  "app/api/admin/recipes/route.ts": ["E"],
  // Was Tier A; the dynamic-pars overlay law now names the edit window.
  "app/api/admin/skus/[id]/location-settings/route.ts": ["E"],
  "app/api/admin/skus/[id]/pack-chain/route.ts": ["E"],
  "app/api/admin/skus/[id]/price/route.ts": ["E"],
  // Catalog Phase 1: edits + reactivation = edit window; deactivation = one-shot grant.
  "app/api/admin/skus/[id]/route.ts": ["E"],
  "app/api/admin/skus/route.ts": ["E"],
  "app/api/admin/weights/route.ts": ["E"],
```

3. In `CLIENT_TIER_MAP`, set these entries:

```ts
  "components/admin/menu-costing/MenuPriceEditor.tsx": ["E"],
  "components/admin/items/ItemRow.tsx": ["B", "E"],
  "components/admin/recipes/RecipeBuilder.tsx": ["E"],
  "components/admin/skus/SkuCatalogClient.tsx": ["E"],
  "components/admin/skus/SkuCostPanel.tsx": ["E"],
  "components/admin/skus/SkuLocationOverlay.tsx": ["E"],
  "components/admin/skus/VendorSkusCard.tsx": ["E"],
  "components/admin/weights/WeightBoardClient.tsx": ["E"],
```

4. Replace the whole `describe("RecipeBuilder — the two lanes that asked for nothing (fixed here)", …)` block with:

```ts
describe("RecipeBuilder — the two lanes that asked for nothing (fixed here)", () => {
  const src = () => read("components/admin/recipes/RecipeBuilder.tsx");

  it("patchField requests the edit window before PATCHing the recipe header", () => {
    const lane = src().slice(src().indexOf("const patchField"));
    const body = lane.slice(0, lane.indexOf("};"));
    expect(body).toContain('requestStepUp("E")');
    expect(body.indexOf('requestStepUp("E")')).toBeLessThan(body.indexOf("send("));
  });

  it("removeEdge requests the edit window and surfaces its refusal", () => {
    const lane = src().slice(src().indexOf("const removeEdge"));
    const body = lane.slice(0, lane.indexOf("\n  };"));
    expect(body).toContain('requestStepUp("E")');
    expect(body).toContain("setPatchError");
    expect(body.indexOf('requestStepUp("E")')).toBeLessThan(body.indexOf("send("));
  });
});
```

5. Append the grant map at the end of the file:

```ts
// ── THE ONE-SHOT GRANTS (catalog Phase 1, Astra r1 P1-1) ─────────────────────
// The always-prompt catalog acts consume a single-use, action-bound grant. Pinned both ways so
// a destructive route cannot quietly fall back to a tier, and a client cannot ask for a grant
// the server never consumes.
const GRANT_SERVER_MAP: Record<string, string[]> = {
  "app/api/admin/products/[id]/active/route.ts": ["product.retire"],
  "app/api/admin/recipes/[id]/route.ts": ["recipe.delete"],
  "app/api/admin/skus/[id]/route.ts": ["sku.deactivate"],
};
const GRANT_CLIENT_MAP: Record<string, string[]> = {
  "components/admin/products/ProductsClient.tsx": ["product.retire"],
  "components/admin/recipes/RecipeBuilder.tsx": ["recipe.delete"],
  "components/admin/skus/SkuCatalogClient.tsx": ["sku.deactivate"],
  "components/admin/skus/VendorSkusCard.tsx": ["sku.deactivate"],
};
function grantsIn(pattern: RegExp, keep: (rel: string) => boolean) {
  const map: Record<string, string[]> = {};
  for (const rel of filesUnder("app", "components")) {
    if (!keep(rel)) continue;
    const found = [...new Set([...read(rel).matchAll(pattern)].map((m) => m[1] as string))].sort();
    if (found.length > 0) map[rel] = found;
  }
  return map;
}

describe("step-up grant map", () => {
  it("every destructive route consumes exactly its grant", () => {
    expect(grantsIn(/consumeStepUpGrant\(\s*ctx\s*,\s*"([a-z_.]+)"/g, (r) => r.endsWith("route.ts"))).toEqual(GRANT_SERVER_MAP);
  });
  it("every client asks for exactly the grants the server consumes", () => {
    expect(
      grantsIn(/action:\s*"(product\.retire|recipe\.delete|sku\.deactivate)"/g, (r) => r.endsWith(".tsx")),
    ).toEqual(GRANT_CLIENT_MAP);
  });
});
```

6. In `tests/dynamic-pars-write.test.ts`, replace:

```ts
  it("still carries its own Tier-A step-up — only the walker's verbs drop it (plan D2)", () => {
    expect(src.includes('assertStepUp(ctx, "A")')).toBe(true);
  });
```

with:

```ts
  it("still carries its own step-up — now the catalog edit window; only the walker's verbs drop it (plan D2)", () => {
    expect(src.includes('assertStepUp(ctx, "E")')).toBe(true);
  });
```

7. In `tests/menu-prices-data.test.ts`, replace `  it("requires session, level 8, and Tier B", async () => {` with `  it("requires session, level 8, and the Tier E edit window", async () => {`, and `expect(mocks.step).toHaveBeenCalledWith(actor, "B");` with `expect(mocks.step).toHaveBeenCalledWith(actor, "E");`.

8. In `tests/menu-prices-ui.test.ts`, replace the StepUpProvider mock line with:

```ts
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn(), requestStepUpGrant: vi.fn(), forgetStepUp: vi.fn(), noteStepUpConfirmed: vi.fn() }) }));
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/step-up-tier-map.test.ts tests/step-up-grants.test.ts tests/dynamic-pars-write.test.ts tests/menu-prices-data.test.ts`
Expected: FAIL. Both map halves still show A/B; both grant maps are empty; the RecipeBuilder lanes fail; the destructive-routes describe in `step-up-grants` fails; `dynamic-pars-write` and `menu-prices-data` fail on the "E" literal.

- [ ] **Step 3: Rewrite `app/api/admin/products/[id]/active/route.ts`** (replace the whole file)

```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { consumeStepUpGrant } from "@/lib/admin/step-up-grants";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setProductActive, ProductError } from "@/lib/products";

// Product retirement (Juan's ruling A+, 2026-08-21).
//   POST { active: boolean } — retire the identity (false) or bring it back (true).
//
// GM+ (≥7, the PRODUCT_WRITE_MIN floor the lib re-checks). RETIRING is an always-prompt act
// (catalog Phase 1, Astra r1 P1-1): it consumes a ONE-SHOT grant minted for exactly this product
// by the password the client just asked for — no edit window and no earlier password stands in.
// Every pinned recipe line stops costing and depleting; that blast radius asks every time.
// RESTORING is an ordinary catalog edit inside the 15-minute window (Tier E).
//
// It never hard-blocks on pinned recipes. The pre-flight warning ("N recipes still pin this") is
// rendered by /admin/products from the count listProducts already carries, and the count is
// recorded in the audit row — the system surfaces the consequences; Juan's declaration wins.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/products/${id}/active`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  if (typeof b.active !== "boolean") return jsonError(400, "invalid_payload", { field: "active" });

  if (b.active === false) {
    const grant = await consumeStepUpGrant(ctx, "product.retire", id);
    if (!grant.ok) return jsonError(403, grant.code);
  } else {
    const su = assertStepUp(ctx, "E");
    if (!su.ok) return jsonError(403, su.code);
  }

  try {
    const { pinnedRecipeCount } = await setProductActive(ctx, { productId: id, active: b.active });
    return jsonOk({ pinnedRecipeCount });
  } catch (e) {
    if (e instanceof ProductError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 4: Run the conversion script for the other routes and the clients**

Save this as `$TEMP/catalog-tier-e.mjs`. It asserts every match count before writing, so a drifted file stops it cold. Then run it from the repo root:

```js
import { readFileSync, writeFileSync } from "node:fs";

const edit = (path, steps) => {
  let src = readFileSync(path, "utf8");
  for (const [from, to, expected] of steps) {
    const n = src.split(from).length - 1;
    if (n !== expected) throw new Error(`${path}: expected ${expected} × ${JSON.stringify(from)}, found ${n}`);
    src = src.split(from).join(to);
  }
  writeFileSync(path, src);
  console.log("ok", path);
};

const B = 'assertStepUp(ctx, "B")', A = 'assertStepUp(ctx, "A")', E = 'assertStepUp(ctx, "E")';
for (const f of [
  "app/api/admin/recipes/route.ts", "app/api/admin/recipes/full/route.ts",
  "app/api/admin/recipes/[id]/inputs/route.ts", "app/api/admin/recipes/[id]/outputs/route.ts",
  "app/api/admin/recipes/edges/route.ts", "app/api/admin/skus/route.ts", "app/api/admin/products/route.ts",
  "app/api/admin/items/[itemId]/sold-directly/route.ts", "app/api/admin/menu-items/route.ts",
  "app/api/admin/menu-items/[id]/price/route.ts", "app/api/admin/weights/route.ts",
]) edit(f, [[B, E, 1]]);
for (const [f, n] of [
  ["app/api/admin/catalog/item-type/[id]/route.ts", 1], ["app/api/admin/products/[id]/route.ts", 1],
  ["app/api/admin/products/[id]/members/route.ts", 2], ["app/api/admin/products/[id]/primary/route.ts", 1],
  ["app/api/admin/skus/[id]/pack-chain/route.ts", 1], ["app/api/admin/skus/[id]/price/route.ts", 1],
  ["app/api/admin/skus/[id]/location-settings/route.ts", 1],
]) edit(f, [[A, E, n]]);

const GRANTS_IMPORT = 'import { assertStepUp } from "@/lib/admin/step-up";\nimport { consumeStepUpGrant } from "@/lib/admin/step-up-grants";';
edit("app/api/admin/recipes/[id]/route.ts", [
  ['import { assertStepUp } from "@/lib/admin/step-up";', GRANTS_IMPORT, 1],
  ['  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");\n  const su = assertStepUp(ctx, "B");',
   '  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");\n  // Catalog Phase 1: a header edit rides the 15-minute edit window.\n  const su = assertStepUp(ctx, "E");', 1],
  ['  if (ROLES[ctx.user.role].level < RECIPE_DELETE_MIN) return jsonError(403, "forbidden");\n  const su = assertStepUp(ctx, "B");\n  if (!su.ok) return jsonError(403, su.code);',
   '  if (ROLES[ctx.user.role].level < RECIPE_DELETE_MIN) return jsonError(403, "forbidden");\n  // Deleting a recipe is an always-prompt act: a ONE-SHOT grant for exactly this recipe (catalog Phase 1).\n  const grant = await consumeStepUpGrant(ctx, "recipe.delete", id);\n  if (!grant.ok) return jsonError(403, grant.code);', 1],
]);
edit("app/api/admin/skus/[id]/route.ts", [
  ['import { assertStepUp } from "@/lib/admin/step-up";', GRANTS_IMPORT, 1],
  ['//   {active}-only        → deactivateSku  (GM+ ≥7, Tier A)\n//   else (other fields)  → updateSku      (GM+ ≥7, Tier A)',
   '//   {active:false}       → deactivateSku  (GM+ ≥7, one-shot grant "sku.deactivate" — asks every time)\n//   {active:true}        → deactivateSku  (GM+ ≥7, Tier E — reactivation is an ordinary edit)\n//   else (other fields)  → updateSku      (GM+ ≥7, Tier E — the 15-minute catalog edit window)', 1],
  ['  // Both deactivate + update are GM+ Tier A.\n  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");\n  const su = assertStepUp(ctx, "A");\n  if (!su.ok) return jsonError(403, su.code);',
   '  // GM+. Deactivating a SKU is destructive: a ONE-SHOT grant for exactly this SKU (catalog\n  // Phase 1, Astra r1 P1-2). Every other write here rides the 15-minute edit window.\n  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");\n  if (hasActive && b.active === false) {\n    const grant = await consumeStepUpGrant(ctx, "sku.deactivate", id);\n    if (!grant.ok) return jsonError(403, grant.code);\n  } else {\n    const su = assertStepUp(ctx, "E");\n    if (!su.ok) return jsonError(403, su.code);\n  }', 1],
]);

// ── clients ────────────────────────────────────────────────────────────────
const HOOK = 'import { useStepUp } from "@/components/admin/StepUpProvider";';
const HOOK_PLUS = `${HOOK}\nimport { useStepUpPost } from "@/components/admin/useStepUpPost";`;
const DESTRUCT = "  const { requestStepUp } = useStepUp();";
const DESTRUCT_SEND = "  const { requestStepUp } = useStepUp();\n  const send = useStepUpPost();";
const DESTRUCT_GRANT_SEND = "  const { requestStepUp, requestStepUpGrant } = useStepUp();\n  const send = useStepUpPost();";
const TOGGLE_OLD = '    if ((await requestStepUp("E")) !== "ok") return;\n    setBusy(true);\n    const result = await send(`/api/admin/skus/${sku.id}`, { active: !sku.active }, "PATCH");';
const TOGGLE_NEW = '    // Deactivating a SKU is destructive: a one-shot password for THIS SKU, every time.\n    // Reactivating is an ordinary edit inside the 15-minute window.\n    const gate = sku.active\n      ? await requestStepUpGrant({ action: "sku.deactivate", targetId: sku.id })\n      : await requestStepUp("E");\n    if (gate !== "ok") return;\n    setBusy(true);\n    const result = await send(`/api/admin/skus/${sku.id}`, { active: !sku.active }, "PATCH");';
for (const f of ["components/admin/skus/SkuCatalogClient.tsx", "components/admin/skus/VendorSkusCard.tsx"]) {
  edit(f, [
    ['requestStepUp("B")', 'requestStepUp("E")', 1],
    ['requestStepUp("A")', 'requestStepUp("E")', 3],
    ["await postJson(", "await send(", 5],
    ['import { postJson, resolveErrorKey, formatSkuPack } from "./shared";', 'import { resolveErrorKey, formatSkuPack } from "./shared";', 1],
    [HOOK, HOOK_PLUS, 1],
    [DESTRUCT, DESTRUCT_GRANT_SEND, 1],
    [TOGGLE_OLD, TOGGLE_NEW, 1],
  ]);
}
for (const f of ["components/admin/skus/SkuCostPanel.tsx", "components/admin/skus/SkuLocationOverlay.tsx"]) {
  edit(f, [
    ['requestStepUp("A")', 'requestStepUp("E")', 1],
    ["await postJson(", "await send(", 1],
    ['import { postJson, resolveErrorKey } from "./shared";', 'import { resolveErrorKey } from "./shared";', 1],
    [HOOK, HOOK_PLUS, 1],
    [DESTRUCT, DESTRUCT_SEND, 1],
  ]);
}
edit("components/admin/products/ProductsClient.tsx", [
  ['tier: "A" | "B"', "tier: StepUpGate", 8],
  ['    if ((await requestStepUp(tier)) !== "ok") return false;',
   '    const gate = typeof tier === "string" ? await requestStepUp(tier) : await requestStepUpGrant(tier);\n    if (gate !== "ok") return false;', 1],
  ["await postJson(url, body, method)", "await send(url, body, method)", 1],
  ['onMutate("A"', 'onMutate("E"', 3],
  ['\n                "A",\n', '\n                "E",\n', 1],
  ['onMutate("B", "/api/admin/products", {', 'onMutate("E", "/api/admin/products", {', 1],
  ['    const ok = await onMutate("B", `/api/admin/products/${product.id}/active`, { active });',
   '    // Retiring is destructive: a one-shot password for THIS product, every time. Restoring is an\n    // ordinary edit inside the 15-minute window.\n    const ok = await onMutate(active ? "E" : { action: "product.retire", targetId: product.id }, `/api/admin/products/${product.id}/active`, { active });', 1],
  ['import { postJson, resolveErrorKey } from "./shared";',
   'import { resolveErrorKey } from "./shared";\nimport type { StepUpGate } from "@/lib/admin/step-up-shared";', 1],
  [HOOK, HOOK_PLUS, 1],
  [DESTRUCT, DESTRUCT_GRANT_SEND, 1],
]);
edit("components/admin/items/ItemRow.tsx", [
  [HOOK, HOOK_PLUS, 1],
  [DESTRUCT, DESTRUCT_SEND, 1],
  ['    if ((await requestStepUp("B")) !== "ok") return;\n    setSavingSoldDirect(true);\n    const result = await postJson(',
   '    if ((await requestStepUp("E")) !== "ok") return;\n    setSavingSoldDirect(true);\n    const result = await send(', 1],
]);
edit("components/admin/weights/WeightBoardClient.tsx", [
  [HOOK, HOOK_PLUS, 1],
  [DESTRUCT, DESTRUCT_SEND, 1],
  ['    if ((await requestStepUp("B")) !== "ok") return;\n    setBusy(true);\n    const result = await postJson("/api/admin/weights", {',
   '    if ((await requestStepUp("E")) !== "ok") return;\n    setBusy(true);\n    const result = await send("/api/admin/weights", {', 1],
  ["/** Commit the session: step-up B → POST → refresh. */", "/** Commit the session: the edit window (Tier E) → POST → refresh. */", 1],
]);
edit("components/admin/menu-costing/MenuPriceEditor.tsx", [
  [DESTRUCT, "  const { requestStepUp, forgetStepUp } = useStepUp();", 1],
  ['if (await requestStepUp("B") !== "ok") return;', 'if (await requestStepUp("E") !== "ok") return;', 1],
  ['      if ((body.code === "step_up_required" || body.code === "step_up_stale") && await requestStepUp("B") === "ok") {',
   '      if (body.code === "step_up_required" || body.code === "step_up_stale") forgetStepUp();\n      if ((body.code === "step_up_required" || body.code === "step_up_stale") && await requestStepUp("E") === "ok") {', 1],
]);
edit("components/admin/recipes/RecipeBuilder.tsx", [
  ['requestStepUp("B")', 'requestStepUp("E")', 11],
  ["await postJson(", "await send(", 11],
  ['import { postJson, resolveErrorKey } from "./shared";', 'import { resolveErrorKey } from "./shared";', 1],
  [HOOK, HOOK_PLUS, 1],
  [DESTRUCT, DESTRUCT_GRANT_SEND, 3],
  ['    if ((await requestStepUp("E")) !== "ok") return;\n    setDeleteBusy(true);',
   '    // Deleting a recipe is destructive: a one-shot password for THIS recipe, every time.\n    if ((await requestStepUpGrant({ action: "recipe.delete", targetId: recipe.id })) !== "ok") return;\n    setDeleteBusy(true);', 1],
]);
```

```bash
cd /c/Users/conta/co-ops-guides && node "$TEMP/catalog-tier-e.mjs"
```

Expected: 29 `ok …` lines (20 routes, 9 clients) and no error. If a count assertion fails, the file has drifted from this plan: stop and re-read it before editing by hand.

- [ ] **Step 5: The new error codes and strings**

Add `"step_up_grant_required",` directly after `"step_up_stale",` in `KNOWN_ERROR_CODES` of each of `components/admin/recipes/shared.ts`, `components/admin/skus/shared.ts` and `components/admin/products/shared.ts`. In `components/admin/recipes/shared.ts` also add `"line_changed",` after it.

`lib/i18n/en.json`: insert each line right after its anchor line.
- after `  "admin.skus.error.step_up_stale": "Your confirmation expired — please confirm your password again.",`:
```json
  "admin.skus.error.step_up_grant_required": "This one asks for your password every time. Tap it again and confirm your password.",
```
- after `  "admin.products.error.step_up_stale": "That confirmation expired. Confirm your password again.",`:
```json
  "admin.products.error.step_up_grant_required": "This one asks for your password every time. Tap it again and confirm your password.",
```
- after `  "recipes.error.step_up_stale": "Your confirmation expired — confirm your password again.",`:
```json
  "recipes.error.step_up_grant_required": "This one asks for your password every time. Tap it again and confirm your password.",
  "recipes.error.line_changed": "Someone else changed this line first. Reload the page to see it, then edit again.",
```

`lib/i18n/es.json`:
- after `  "admin.skus.error.step_up_stale": "Tu confirmación expiró — confirma tu contraseña de nuevo.",`:
```json
  "admin.skus.error.step_up_grant_required": "Esto pide tu contraseña cada vez. Tócalo otra vez y confirma tu contraseña.",
```
- after `  "admin.products.error.step_up_stale": "Esa confirmación venció. Confirma tu contraseña otra vez.",`:
```json
  "admin.products.error.step_up_grant_required": "Esto pide tu contraseña cada vez. Tócalo otra vez y confirma tu contraseña.",
```
- after `  "recipes.error.step_up_stale": "Tu confirmación expiró — confirma tu contraseña de nuevo.",`:
```json
  "recipes.error.step_up_grant_required": "Esto pide tu contraseña cada vez. Tócalo otra vez y confirma tu contraseña.",
  "recipes.error.line_changed": "Alguien más cambió esta línea primero. Recarga la página para verla y edítala otra vez.",
```

- [ ] **Step 6: Write the law into `AGENTS.md`**

Insert this bullet as the last bullet of `### Auth & sessions`, directly before `### Audit & append-only conventions`:

```markdown
- **Step-up: three tiers, TWO clocks, and one-shot grants** (catalog Phase 1, 2026-10-15, Astra r1; migration 0257). **A** = `sessions.step_up_unlocked`, any age · **B** = that flag + `step_up_unlocked_at` within 120 s, and the client always prompts · **E** = the catalog/recipe **edit window** on its OWN clock, `sessions.catalog_edit_unlocked_at`: stamped ONLY by a password typed on the admin surface (`catalogWindow`), a FIXED 15 minutes from that password — never extended by saving, never cleared by navigation or background requests (a deliberate design: a window that closes on a prefetch or a language toggle is a window nobody can rely on); it ends at expiry or with the session (logout, revoke, expiry). Checked by the pure `assertStepUp` on every write. Neither clock ever slides: only `unlockStepUp` stamps them (pinned). **Retire a product, delete a recipe and deactivate a SKU take NO tier**: each consumes a one-shot grant (`step_up_grants`, `lib/admin/step-up-grants.ts`) minted by the step-up POST for exactly that (action, target), bound to session + user, 120 s, consumed by ONE conditional UPDATE (replay, wrong action/target/session and expiry refused). Step-up is chosen per ROUTE, never by `DESTRUCTIVE_ACTIONS` membership. A client that gets `step_up_required`/`step_up_stale` must `forgetStepUp()` (`useStepUpPost` does). Tier and grant maps are pinned in `tests/step-up-tier-map.test.ts`.
```

In the Dynamic pars section, replace the sentence `The admin overlay route keeps its Tier-A step-up untouched.` with `The admin overlay route keeps its own step-up — the Tier E catalog edit window since catalog Phase 1 (it was Tier A).`

- [ ] **Step 7: Run the tests and tsc**

Run: `npx vitest run tests/step-up-tier-map.test.ts tests/step-up-grants.test.ts tests/dynamic-pars-write.test.ts tests/menu-prices-data.test.ts tests/menu-prices-ui.test.ts tests/product-item-links-ui.test.ts tests/admin-sku-write-contracts.test.ts tests/yield-stats-server.test.ts`
Expected: PASS, 0 failed.

Run: `npx tsc --noEmit 2>&1 | grep -v TS2307 | grep "error TS"`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add -A app/api/admin components/admin tests lib/i18n AGENTS.md
git commit -F - <<'EOF'
feat(step-up): every catalog edit rides the window; retire/delete/deactivate take one-shot grants

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 6: The pure recipe-line surface

**Files:**
- Create: `lib/recipe-line-shared.ts`
- Test: `tests/recipe-line-shared.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/recipe-line-shared.test.ts`:

```ts
/** Catalog Phase 1 — the recipe LINE (one recipe_inputs row), pure surface. */
import { describe, expect, it } from "vitest";
import {
  diffRecipeLine,
  lineDraftFromView,
  lineFromRow,
  lineSnapshotFromView,
  beginLineEdit,
  lineToRow,
  lineUnitChoices,
  normalizeRecipeLine,
  parseRecipeLineEdit,
  parseRecipeLinePatch,
  parseRecipeLineSnapshot,
  recipeLineKind,
  type RecipeLineFields,
} from "@/lib/recipe-line-shared";
import type { RecipeInputView } from "@/lib/recipes-shared";

const sku = (over: Partial<RecipeLineFields> = {}): RecipeLineFields => ({
  componentSkuId: "sku-ham", componentItemId: null, componentProductId: null,
  quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false, ...over,
});
const view = (over: Partial<RecipeInputView> = {}): RecipeInputView => ({
  id: "line-1", componentSkuId: "sku-ham", componentItemId: null, componentProductId: null,
  componentName: "Ham", kind: "sku", componentRetired: false, quantity: 4, unit: " oz ",
  eachContainerLabel: null, portioned: false, displayOrder: 1, ...over,
});

describe("parseRecipeLinePatch — the wire shape of one whole NEW line", () => {
  it("accepts a SKU line and normalises its text", () => {
    expect(parseRecipeLinePatch({ componentSkuId: " sku-1 ", quantity: 4, unit: " oz ", eachContainerLabel: "", portioned: true }))
      .toEqual({ ok: true, line: { componentSkuId: "sku-1", componentItemId: null, componentProductId: null, quantity: 4, unit: "oz", eachContainerLabel: null, portioned: true } });
  });

  it("an item line never carries a container label or portioned", () => {
    expect(parseRecipeLinePatch({ componentItemId: "item-1", quantity: 2, unit: "qt", eachContainerLabel: "bag", portioned: true }))
      .toEqual({ ok: true, line: { componentSkuId: null, componentItemId: "item-1", componentProductId: null, quantity: 2, unit: "qt", eachContainerLabel: null, portioned: false } });
  });

  it("a product line needs a unit (WHICH units is the server's measure-registry check)", () => {
    expect(parseRecipeLinePatch({ componentProductId: "p-1", quantity: 3 })).toEqual({ ok: false, code: "product_line_needs_measure_unit" });
  });

  it("exactly one target; quantity a positive finite NUMBER; typed fields", () => {
    expect(parseRecipeLinePatch({ quantity: 1 })).toEqual({ ok: false, code: "invalid_component" });
    expect(parseRecipeLinePatch({ componentSkuId: "a", componentItemId: "b", quantity: 1 })).toEqual({ ok: false, code: "invalid_component" });
    for (const quantity of ["4", 0, -1, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(parseRecipeLinePatch({ componentSkuId: "a", quantity })).toEqual({ ok: false, code: "invalid_quantity" });
    }
    for (const raw of [null, [], "x", { componentSkuId: 5, quantity: 1 }, { componentSkuId: "  ", quantity: 1 },
      { componentSkuId: "a", quantity: 1, unit: 3 }, { componentSkuId: "a", quantity: 1, portioned: "yes" }]) {
      expect(parseRecipeLinePatch(raw)).toEqual({ ok: false, code: "invalid_payload" });
    }
  });
});

describe("the EXPECTED line (compare-and-set, Astra r1 P2-4)", () => {
  it("a snapshot keeps text RAW — it must equal the stored value byte for byte", () => {
    expect(parseRecipeLineSnapshot({ componentSkuId: "sku-ham", quantity: 4, unit: " oz ", eachContainerLabel: null, portioned: false }))
      .toEqual(sku({ unit: " oz " }));
  });

  it("a snapshot of a legacy product line without a unit is still a snapshot", () => {
    expect(parseRecipeLineSnapshot({ componentProductId: "p-1", quantity: 1, unit: null, portioned: true }))
      .toEqual({ componentSkuId: null, componentItemId: null, componentProductId: "p-1", quantity: 1, unit: null, eachContainerLabel: null, portioned: true });
  });

  it("a malformed snapshot is null", () => {
    for (const raw of [null, [], {}, { componentSkuId: "a", componentItemId: "b", quantity: 1 }, { componentSkuId: "a", quantity: 0 }, { componentSkuId: "a", quantity: 1, portioned: "x" }]) {
      expect(parseRecipeLineSnapshot(raw)).toBeNull();
    }
  });

  it("parseRecipeLineEdit needs both halves", () => {
    expect(parseRecipeLineEdit({ line: { componentSkuId: "sku-ham", quantity: 5, unit: "oz" }, expected: { componentSkuId: "sku-ham", quantity: 4, unit: " oz " } }))
      .toEqual({ ok: true, line: sku({ quantity: 5 }), expected: sku({ unit: " oz " }) });
    expect(parseRecipeLineEdit({ line: { componentSkuId: "sku-ham", quantity: 5 } })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeLineEdit({ line: { quantity: 5 }, expected: {} })).toEqual({ ok: false, code: "invalid_component" });
    expect(parseRecipeLineEdit(null)).toEqual({ ok: false, code: "invalid_payload" });
  });

  it("view → snapshot is raw; view → draft is normalised", () => {
    expect(lineSnapshotFromView(view())).toEqual(sku({ unit: " oz " }));
    expect(lineDraftFromView(view())).toEqual({ ...sku(), componentName: "Ham" });
  });

  it("beginLineEdit captures BOTH halves at the moment editing begins (Astra r2 #1)", () => {
    const started = beginLineEdit(view());
    // The page refreshes mid-edit: another manager swapped the ingredient. The capture must not follow.
    const refreshed = view({ componentSkuId: "sku-turkey", componentName: "Turkey" });
    expect(refreshed.componentSkuId).toBe("sku-turkey");
    expect(started).toEqual({ id: "line-1", initial: { ...sku(), componentName: "Ham" }, expected: sku({ unit: " oz " }) });
  });
});

describe("row ↔ line, normalise, diff, kind", () => {
  it("lineFromRow reads numeric strings and blank text the way the column stores them", () => {
    expect(lineFromRow({ component_sku_id: "sku-ham", component_item_id: null, component_product_id: null, quantity: "4", unit: " oz ", each_container_label: "", portioned: null }))
      .toEqual(sku());
  });

  it("lineToRow is the exact column patch", () => {
    expect(lineToRow(sku({ quantity: 5 }))).toEqual({
      component_sku_id: "sku-ham", component_item_id: null, component_product_id: null,
      quantity: 5, unit: "oz", each_container_label: null, portioned: false,
    });
  });

  it("normalizeRecipeLine trims text only", () => {
    expect(normalizeRecipeLine(sku({ unit: " oz ", eachContainerLabel: "  " }))).toEqual(sku());
  });

  it("diffRecipeLine names exactly the fields that moved", () => {
    expect(diffRecipeLine(sku(), sku())).toEqual([]);
    expect(diffRecipeLine(sku(), sku({ quantity: 5, unit: "lb" }))).toEqual(["quantity", "unit"]);
    expect(diffRecipeLine(sku(), sku({ componentSkuId: null, componentProductId: "p-1" }))).toEqual(["componentSkuId", "componentProductId"]);
  });

  it("recipeLineKind follows the one non-null target", () => {
    expect(recipeLineKind(sku())).toBe("sku");
    expect(recipeLineKind(sku({ componentSkuId: null, componentItemId: "i" }))).toBe("item");
    expect(recipeLineKind(sku({ componentSkuId: null, componentProductId: "p" }))).toBe("product");
  });
});

describe("lineUnitChoices — the server's unit rules, offered up front", () => {
  const pack = { packFormat: "case", eachContainerLabel: "bag", eachMeasure: "lb" };
  const measures = ["each", "gal", "lb", "oz"];

  it("a PRODUCT line offers every active measure-registry unit and never a vendor's pack label", () => {
    expect(lineUnitChoices("product", pack, measures, "case")).toEqual(["each", "gal", "lb", "oz"]);
  });

  it("a SKU line keeps its own unit first, then its pack labels, then the measures, without duplicates", () => {
    expect(lineUnitChoices("sku", pack, measures, "log")).toEqual(["log", "case", "bag", "lb", "each", "gal", "oz"]);
    expect(lineUnitChoices("sku", { packFormat: " ", eachContainerLabel: null, eachMeasure: null }, measures, null)).toEqual(["each", "gal", "lb", "oz"]);
  });

  it("a prep-item line keeps its free-text unit (null = no list)", () => {
    expect(lineUnitChoices("item", null, measures, "qt")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/recipe-line-shared.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/recipe-line-shared"`.

- [ ] **Step 3: Create `lib/recipe-line-shared.ts`**

```ts
/**
 * Recipe LINE (one recipe_inputs row) — CLIENT-SAFE pure surface (catalog redesign Phase 1,
 * 2026-10-15). Used by the edit route (parse), the lib (row ↔ line, diff, the compare-and-set
 * shape) and the builder (unit choices, "nothing changed", the expected snapshot), so all three
 * agree on what a line IS and when it changed.
 *
 * An edit carries the WHOLE new line AND the line the client saw (`expected`). The server
 * writes only if the stored row still equals `expected` (Astra r1 P2-4): a concurrent edit is
 * a named 409, never a silent overwrite, and the audit's "before" is the row that matched.
 * `expected` is a RAW snapshot — text untrimmed — because it must equal the stored value byte
 * for byte; the diff compares it NORMALISED, so whitespace alone never counts as a change.
 */
import type { RecipeInputView } from "@/lib/recipes-shared";

export type RecipeLineKind = "sku" | "item" | "product";

export interface RecipeLineFields {
  componentSkuId: string | null;
  componentItemId: string | null;
  componentProductId: string | null;
  quantity: number;
  unit: string | null;
  eachContainerLabel: string | null;
  portioned: boolean;
}

/** A line plus the name the builder shows for its target. */
export interface RecipeLineDraft extends RecipeLineFields {
  componentName: string;
}

/** The recipe_inputs columns a line owns, as the database spells them. */
export interface RecipeLineRow {
  component_sku_id: string | null;
  component_item_id: string | null;
  component_product_id: string | null;
  quantity: number | string;
  unit: string | null;
  each_container_label: string | null;
  portioned: boolean | null;
}

export const RECIPE_LINE_FIELDS = [
  "componentSkuId",
  "componentItemId",
  "componentProductId",
  "quantity",
  "unit",
  "eachContainerLabel",
  "portioned",
] as const satisfies ReadonlyArray<keyof RecipeLineFields>;

export type RecipeLineParseError =
  | "invalid_payload"
  | "invalid_component"
  | "invalid_quantity"
  | "product_line_needs_measure_unit";

export type RecipeLineParse =
  | { ok: true; line: RecipeLineFields }
  | { ok: false; code: RecipeLineParseError };

export type RecipeLineEditParse =
  | { ok: true; line: RecipeLineFields; expected: RecipeLineFields }
  | { ok: false; code: RecipeLineParseError };

/** Trimmed text, or null for absent/blank — the same rule lib/recipes.ts normStr applies at insert. */
export function normLineText(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

const isAbsent = (v: unknown) => v === undefined || v === null;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The shared shape checks: typed ids (non-blank strings), typed text, typed portioned. */
function shapeOk(b: Record<string, unknown>): boolean {
  for (const id of [b.componentSkuId, b.componentItemId, b.componentProductId]) {
    if (!isAbsent(id) && (typeof id !== "string" || id.trim() === "")) return false;
  }
  for (const text of [b.unit, b.eachContainerLabel]) {
    if (!isAbsent(text) && typeof text !== "string") return false;
  }
  return isAbsent(b.portioned) || typeof b.portioned === "boolean";
}

const idOf = (v: unknown): string | null => (typeof v === "string" ? v.trim() : null);
const positive = (q: unknown): q is number => typeof q === "number" && Number.isFinite(q) && q > 0;

export function parseRecipeLinePatch(raw: unknown): RecipeLineParse {
  if (!isObject(raw) || !shapeOk(raw)) return { ok: false, code: "invalid_payload" };
  const skuId = idOf(raw.componentSkuId);
  const itemId = idOf(raw.componentItemId);
  const productId = idOf(raw.componentProductId);
  if ([skuId, itemId, productId].filter((v) => v !== null).length !== 1) return { ok: false, code: "invalid_component" };
  if (!positive(raw.quantity)) return { ok: false, code: "invalid_quantity" };
  const unit = normLineText(raw.unit as string | null | undefined);
  if (productId !== null && unit === null) return { ok: false, code: "product_line_needs_measure_unit" };
  return {
    ok: true,
    line: {
      componentSkuId: skuId,
      componentItemId: itemId,
      componentProductId: productId,
      quantity: raw.quantity,
      unit,
      // A container label is a SKU's own word; an item or product line never carries one.
      eachContainerLabel: skuId !== null ? normLineText(raw.eachContainerLabel as string | null | undefined) : null,
      // Portioning is a bought-ingredient idea; a prep-item line is never portioned.
      portioned: itemId !== null ? false : raw.portioned === true,
    },
  };
}

/** The line as the client SAW it — raw text, no business rules beyond the table's own. Null = malformed. */
export function parseRecipeLineSnapshot(raw: unknown): RecipeLineFields | null {
  if (!isObject(raw) || !shapeOk(raw)) return null;
  const skuId = typeof raw.componentSkuId === "string" ? raw.componentSkuId : null;
  const itemId = typeof raw.componentItemId === "string" ? raw.componentItemId : null;
  const productId = typeof raw.componentProductId === "string" ? raw.componentProductId : null;
  if ([skuId, itemId, productId].filter((v) => v !== null).length !== 1) return null;
  if (!positive(raw.quantity)) return null;
  return {
    componentSkuId: skuId,
    componentItemId: itemId,
    componentProductId: productId,
    quantity: raw.quantity,
    unit: typeof raw.unit === "string" ? raw.unit : null,
    eachContainerLabel: typeof raw.eachContainerLabel === "string" ? raw.eachContainerLabel : null,
    portioned: raw.portioned === true,
  };
}

export function parseRecipeLineEdit(raw: unknown): RecipeLineEditParse {
  if (!isObject(raw)) return { ok: false, code: "invalid_payload" };
  const line = parseRecipeLinePatch(raw.line);
  if (!line.ok) return line;
  const expected = parseRecipeLineSnapshot(raw.expected);
  if (!expected) return { ok: false, code: "invalid_payload" };
  return { ok: true, line: line.line, expected };
}

export function normalizeRecipeLine(l: RecipeLineFields): RecipeLineFields {
  return { ...l, unit: normLineText(l.unit), eachContainerLabel: normLineText(l.eachContainerLabel) };
}

export function recipeLineKind(
  l: Pick<RecipeLineFields, "componentSkuId" | "componentItemId" | "componentProductId">,
): RecipeLineKind {
  if (l.componentProductId !== null) return "product";
  if (l.componentItemId !== null) return "item";
  return "sku";
}

export function lineFromRow(r: RecipeLineRow): RecipeLineFields {
  return {
    componentSkuId: r.component_sku_id,
    componentItemId: r.component_item_id,
    componentProductId: r.component_product_id,
    quantity: Number(r.quantity),
    unit: normLineText(r.unit),
    eachContainerLabel: normLineText(r.each_container_label),
    portioned: r.portioned === true,
  };
}

export function lineToRow(l: RecipeLineFields): {
  component_sku_id: string | null;
  component_item_id: string | null;
  component_product_id: string | null;
  quantity: number;
  unit: string | null;
  each_container_label: string | null;
  portioned: boolean;
} {
  return {
    component_sku_id: l.componentSkuId,
    component_item_id: l.componentItemId,
    component_product_id: l.componentProductId,
    quantity: l.quantity,
    unit: l.unit,
    each_container_label: l.eachContainerLabel,
    portioned: l.portioned,
  };
}

/** The fields that differ, in RECIPE_LINE_FIELDS order. Empty = nothing to write. */
export function diffRecipeLine(before: RecipeLineFields, after: RecipeLineFields): Array<keyof RecipeLineFields> {
  return RECIPE_LINE_FIELDS.filter((k) => before[k] !== after[k]);
}

/**
 * The unit choices for a line's target. null = free text (prep-item lines, as before).
 * PRODUCT: every ACTIVE measure-registry label, any dimension (AGENTS.md "measure-registry unit";
 * a pack label means a different thing per vendor — deviation D3). SKU: the line's current unit
 * first (an edit never silently changes it), then the SKU's pack labels, then the measure
 * registry (ozForRecipeInput step 3 resolves those for any SKU).
 */
export function lineUnitChoices(
  kind: RecipeLineKind,
  sku: { packFormat: string | null; eachContainerLabel: string | null; eachMeasure: string | null } | null,
  measureLabels: readonly string[],
  current: string | null,
): string[] | null {
  if (kind === "item") return null;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string | null | undefined) => {
    const t = typeof v === "string" ? v.trim() : "";
    if (t !== "" && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };
  if (kind === "product") {
    for (const m of measureLabels) push(m);
    return out;
  }
  push(current);
  push(sku?.packFormat);
  push(sku?.eachContainerLabel);
  push(sku?.eachMeasure);
  for (const m of measureLabels) push(m);
  return out;
}

/** The editor's starting line (normalised). */
export function lineDraftFromView(v: RecipeInputView): RecipeLineDraft {
  return {
    componentSkuId: v.componentSkuId,
    componentItemId: v.componentItemId,
    componentProductId: v.componentProductId,
    quantity: v.quantity,
    unit: normLineText(v.unit),
    eachContainerLabel: normLineText(v.eachContainerLabel),
    portioned: v.portioned,
    componentName: v.componentName,
  };
}

/** The compare-and-set `expected` (RAW, exactly as loadRecipe returned it). */
export function lineSnapshotFromView(v: RecipeInputView): RecipeLineFields {
  return {
    componentSkuId: v.componentSkuId,
    componentItemId: v.componentItemId,
    componentProductId: v.componentProductId,
    quantity: v.quantity,
    unit: v.unit,
    eachContainerLabel: v.eachContainerLabel,
    portioned: v.portioned,
  };
}

/** A live edit's state, captured ONCE when editing begins (Astra r2 #1). */
export interface LineEditStart {
  id: string;
  /** What the editor starts from (normalised). */
  initial: RecipeLineDraft;
  /** What the server must still hold for the save to land (raw). */
  expected: RecipeLineFields;
}

/**
 * Capture the editor's starting line AND the compare-and-set snapshot at the moment the person
 * taps Edit. Both are copies: a router.refresh() mid-edit hands the row a NEW view (another
 * manager's change), but the save must still be compared against what this person SAW — so a
 * stale save is a 409, never a silent overwrite of the other manager's change.
 */
export function beginLineEdit(v: RecipeInputView): LineEditStart {
  return { id: v.id, initial: lineDraftFromView(v), expected: lineSnapshotFromView(v) };
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run tests/recipe-line-shared.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add lib/recipe-line-shared.ts tests/recipe-line-shared.test.ts
git commit -F - <<'EOF'
feat(recipes): pure recipe-line surface — parse, expected snapshot, diff, unit choices

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 7: `updateRecipeInput` — compare-and-set, one validator with add, a true audit trail

**Files:**
- Modify: `lib/recipes.ts`, `lib/destructive-actions.ts`, `lib/audit-actions.ts`, `lib/dynamic-pars.ts`
- Test: `tests/recipe-line-edit-server.test.ts` (lib half)

- [ ] **Step 1: Write the failing test**

Create `tests/recipe-line-edit-server.test.ts`:

```ts
/**
 * Catalog Phase 1 — editing a recipe line in place, over the PREDICATE-AWARE fake (Astra r1
 * P2-4 + P2-5): the write really is scoped to (id, recipe_id, expected values); a concurrent
 * change is a 409 with nothing written; the product-unit rule and the item cycle guard refuse
 * through BOTH add and update; the audit's before/after are the matched and returned rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Row } from "./fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeDb,
  audit: vi.fn(),
  session: vi.fn(),
  step: vi.fn(),
}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/session", () => ({ requireSession: h.session }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: h.step }));

import { addRecipeInput, updateRecipeInput } from "@/lib/recipes";
import { isDestructive } from "@/lib/destructive-actions";
import { NON_DESTRUCTIVE_ACTIONS } from "@/lib/audit-actions";
import { beginLineEdit, type RecipeLineFields } from "@/lib/recipe-line-shared";
import type { AuthContext } from "@/lib/session";

const R = "recipe-1";
const R2 = "recipe-2";
const LINE = "line-1";
const gm = { user: { id: "u-gm", role: "gm" } } as unknown as AuthContext;
const agm = { user: { id: "u-agm", role: "agm" } } as unknown as AuthContext;

beforeEach(() => {
  vi.clearAllMocks();
  h.step.mockReturnValue({ ok: true });
  // R outputs item-x. R2 outputs item-y and CONSUMES item-x — so item-y (and item-x itself)
  // inside R would close a loop.
  h.db = fakeSupabase({
    recipe_inputs: [
      { id: LINE, recipe_id: R, component_sku_id: "sku-ham", component_item_id: null, component_product_id: null, quantity: 4, unit: "oz", each_container_label: null, portioned: false, display_order: 1 },
      { id: "line-r2", recipe_id: R2, component_sku_id: "sku-salt", component_item_id: null, component_product_id: null, quantity: 1, unit: "oz", each_container_label: null, portioned: false, display_order: 1 },
      { id: "line-r2-x", recipe_id: R2, component_sku_id: null, component_item_id: "item-x", component_product_id: null, quantity: 1, unit: "qt", each_container_label: null, portioned: false, display_order: 2 },
    ],
    recipe_outputs: [
      { id: "out-1", recipe_id: R, output_item_id: "item-x", output_menu_item_id: null },
      { id: "out-2", recipe_id: R2, output_item_id: "item-y", output_menu_item_id: null },
    ],
    products: [{ id: "p-ham", active: true }, { id: "p-old", active: false }],
    measure_units: [{ label: "oz", active: true }, { label: "each", active: true }],
  });
});

const line = (over: Partial<RecipeLineFields> = {}): RecipeLineFields => ({
  componentSkuId: "sku-ham", componentItemId: null, componentProductId: null,
  quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false, ...over,
});
const edit = (actor: AuthContext, next: RecipeLineFields, expected = line(), recipeId = R, inputId = LINE) =>
  updateRecipeInput(actor, { recipeId, inputId, line: next, expected });
const add = (over: Record<string, unknown>) =>
  addRecipeInput(gm, { recipeId: R, quantity: 1, ...over } as Parameters<typeof addRecipeInput>[1]);
const rowOf = (id: string) => (h.db.tables.recipe_inputs as Row[]).find((r) => r.id === id)!;
const updates = () => h.db.writes.filter((w) => w.op === "update");

describe("updateRecipeInput — the lib is the authority", () => {
  it("refuses below GM, two targets, or a zero quantity before any database work", async () => {
    await expect(edit(agm, line({ quantity: 5 }))).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(edit(gm, line({ componentItemId: "item-1" }))).rejects.toMatchObject({ code: "invalid_component" });
    await expect(edit(gm, line({ quantity: 0 }))).rejects.toMatchObject({ code: "invalid_quantity" });
    expect(h.db.writes).toEqual([]);
  });

  it("an edit that changes nothing writes nothing and audits nothing (whitespace is not a change)", async () => {
    await expect(edit(gm, line(), line({ unit: " oz " }))).resolves.toEqual({ changed: false });
    expect(h.db.writes).toEqual([]);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("updates IN PLACE only while the row still equals what the client saw, and audits the true before/after", async () => {
    await expect(edit(gm, line({ quantity: 5 }))).resolves.toEqual({ changed: true });
    expect(updates()).toHaveLength(1);
    expect(updates()[0]!.matched).toBe(1);
    expect(rowOf(LINE).quantity).toBe(5);
    expect(h.audit).toHaveBeenCalledTimes(1);
    expect(h.audit.mock.calls[0]![0]).toMatchObject({
      actorId: "u-gm", action: "recipe_input.update", resourceTable: "recipe_inputs", resourceId: LINE,
      metadata: {
        recipe_id: R, changed_fields: ["quantity"],
        before: { component_sku_id: "sku-ham", quantity: 4, unit: "oz" },
        after: { component_sku_id: "sku-ham", quantity: 5, unit: "oz" },
      },
    });
  });

  it("someone else changed the line first → 409 line_changed, nothing overwritten, nothing audited", async () => {
    rowOf(LINE).quantity = 6;
    await expect(edit(gm, line({ quantity: 5 }))).rejects.toMatchObject({ status: 409, code: "line_changed" });
    expect(rowOf(LINE).quantity).toBe(6);
    expect(updates()[0]!.matched).toBe(0);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("refresh while editing (Astra r2 #1): another manager swaps the ingredient, the page refreshes, the stale save is a 409", async () => {
    // Editing began on the line as it stood: Ham, 4 oz.
    const started = beginLineEdit({
      id: LINE, componentSkuId: "sku-ham", componentItemId: null, componentProductId: null, componentName: "Ham",
      kind: "sku", componentRetired: false, quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false, displayOrder: 1,
    });
    rowOf(LINE).component_sku_id = "sku-turkey"; // the other manager's save; the refreshed view now says Turkey
    await expect(edit(gm, { ...started.initial, quantity: 5 }, started.expected)).rejects.toMatchObject({ status: 409, code: "line_changed" });
    expect(rowOf(LINE)).toMatchObject({ component_sku_id: "sku-turkey", quantity: 4 });
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("a line id from ANOTHER recipe is a 404 and the row is untouched (the recipe bind is real)", async () => {
    const otherSeen = line({ componentSkuId: "sku-salt", unit: "oz", quantity: 1 });
    await expect(edit(gm, { ...otherSeen, quantity: 2 }, otherSeen, R, "line-r2")).rejects.toMatchObject({ status: 404, code: "edge_not_found" });
    expect(rowOf("line-r2").quantity).toBe(1);
    expect(updates()[0]!.matched).toBe(0);
  });

  it("swapping the ingredient is ONE update that sets the new target and clears the others", async () => {
    await expect(edit(gm, line({ componentSkuId: null, componentProductId: "p-ham", unit: "each" }))).resolves.toEqual({ changed: true });
    expect(rowOf(LINE)).toMatchObject({ component_sku_id: null, component_item_id: null, component_product_id: "p-ham", unit: "each" });
  });
});

describe("the SAME rules refuse through add AND update", () => {
  it("a product line measured in a vendor's pack label", async () => {
    await expect(add({ componentProductId: "p-ham", unit: "case" })).rejects.toMatchObject({ code: "product_line_needs_measure_unit" });
    await expect(edit(gm, line({ componentSkuId: null, componentProductId: "p-ham", unit: "case" }))).rejects.toMatchObject({ code: "product_line_needs_measure_unit" });
    expect(h.db.writes).toEqual([]);
  });

  it("a retired product", async () => {
    await expect(add({ componentProductId: "p-old", unit: "oz" })).rejects.toMatchObject({ code: "invalid_component_product" });
    await expect(edit(gm, line({ componentSkuId: null, componentProductId: "p-old", unit: "oz" }))).rejects.toMatchObject({ code: "invalid_component_product" });
    expect(h.db.writes).toEqual([]);
  });

  it("an item line that would make the recipe consume its own output (directly or through another recipe)", async () => {
    await expect(add({ componentItemId: "item-x", unit: "qt" })).rejects.toMatchObject({ code: "would_create_cycle" });
    await expect(add({ componentItemId: "item-y", unit: "qt" })).rejects.toMatchObject({ code: "would_create_cycle" });
    await expect(edit(gm, line({ componentSkuId: null, componentItemId: "item-y", unit: "qt" }))).rejects.toMatchObject({ code: "would_create_cycle" });
    expect(h.db.writes).toEqual([]);
  });

  it("…and a harmless item line goes through both", async () => {
    await expect(add({ componentItemId: "item-z", unit: "qt" })).resolves.toEqual({ id: expect.any(String) });
    await expect(edit(gm, line({ componentSkuId: null, componentItemId: "item-z", unit: "qt" }))).resolves.toEqual({ changed: true });
  });
});

describe("recipe_input.update is a human change to the kitchen", () => {
  it("is registered destructive, like its add and remove siblings", () => {
    expect(isDestructive("recipe_input.add")).toBe(true);
    expect(isDestructive("recipe_input.remove")).toBe(true);
    expect(isDestructive("recipe_input.update")).toBe(true);
    expect((NON_DESTRUCTIVE_ACTIONS as readonly string[]).includes("recipe_input.update")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/recipe-line-edit-server.test.ts`
Expected: FAIL. `updateRecipeInput` is not a function; `add({ componentItemId: "item-x" })` resolves (no cycle guard on add today); the registry test fails at `isDestructive("recipe_input.update")`.

- [ ] **Step 3: Move `recipe_input.update` into the destructive registry**

In `lib/destructive-actions.ts`, replace:

```ts
  "recipe_input.remove",
```

with:

```ts
  "recipe_input.remove",
  // Catalog Phase 1 (2026-10-15): a human edits a recipe line in place (qty, unit, or the
  // ingredient itself) — the same act as remove + add, so it answers "who changed the
  // kitchen?" like its siblings. Seeds 22/25/32 wrote it earlier as non-destructive; those
  // rows keep the flag they were written with (audit rows are never updated).
  "recipe_input.update",
```

In `lib/audit-actions.ts`, delete the line `  "recipe_input.update",` (directly after `  "recipe.input_unit_normalize",`) from `NON_DESTRUCTIVE_ACTIONS`.

In `lib/dynamic-pars.ts`, replace:

```ts
 * The plan names "`recipe_input.*` / `recipe.update`"; live, `recipe_input.*` is three
 * spellings — add + remove sit in DESTRUCTIVE_ACTIONS, update in NON_DESTRUCTIVE — and
 * all three change the flatten. Verified against both registries rather than assumed: an
```

with:

```ts
 * The plan names "`recipe_input.*` / `recipe.update`"; live, `recipe_input.*` is three
 * spellings — add, remove and (since catalog Phase 1, 2026-10-15) update all sit in
 * DESTRUCTIVE_ACTIONS — and all three change the flatten. The recipe builder's in-place
 * line edit emits update, so it resets the velocity series like an add or a remove.
 * Verified against both registries rather than assumed: an
```

- [ ] **Step 4: The shared validator and `updateRecipeInput` in `lib/recipes.ts`**

Add after the `@/lib/recipes-shared` import block:

```ts
import {
  diffRecipeLine,
  lineFromRow,
  lineToRow,
  normalizeRecipeLine,
  type RecipeLineFields,
  type RecipeLineRow,
} from "@/lib/recipe-line-shared";
```

Add directly after `componentTargets` (`itemConsumesTransitively` is a hoisted function declaration further down):

```ts
/**
 * ONE validator for a line about to be written — shared by addRecipeInput and
 * updateRecipeInput (catalog Phase 1), so an edit can never author what an add would refuse.
 *  · a PRODUCT line: an active product measured in an ACTIVE measure-registry unit of any
 *    dimension (D3, assertProductLineIsValid above);
 *  · an ITEM line: must not make this recipe consume its own output, directly or through a
 *    chain of prep recipes. createRecipeFull always had this guard; addRecipeInput did not,
 *    so a single added line could close a loop the flatten then had to survive.
 * Mass balance is NOT a write rule: it is the costing board's read-time consistency check
 * (lib/menu-costing-shared.ts massBalanceIndex) and applies to any line once it is saved.
 */
async function assertInputLineIsValid(
  sb: ReturnType<typeof getServiceRoleClient>,
  recipeId: string,
  line: { componentItemId: string | null; componentProductId: string | null; unit: string | null },
): Promise<void> {
  if (line.componentProductId !== null) await assertProductLineIsValid(sb, line.componentProductId, line.unit);
  if (line.componentItemId !== null) {
    const { data: outs, error } = await sb
      .from("recipe_outputs")
      .select("output_item_id")
      .eq("recipe_id", recipeId)
      .not("output_item_id", "is", null)
      .returns<Array<{ output_item_id: string }>>();
    if (error) throw new Error(`assertInputLineIsValid outputs: ${error.message}`);
    for (const o of outs ?? []) {
      if (await itemConsumesTransitively(line.componentItemId, o.output_item_id)) {
        throw new RecipeError(400, "would_create_cycle");
      }
    }
  }
}
```

In `addRecipeInput`, replace:

```ts
  if (productId !== null) await assertProductLineIsValid(sb, productId, input.unit ?? null);
```

with:

```ts
  await assertInputLineIsValid(sb, input.recipeId, { componentItemId: itemId, componentProductId: productId, unit: input.unit ?? null });
```

Add `updateRecipeInput` directly after `addRecipeInput`:

```ts
/**
 * Edit ONE recipe line in place (catalog redesign Phase 1, 2026-10-15): quantity, unit, and the
 * ingredient itself (any of the three targets).
 *
 * THE STORAGE RULE. recipe_inputs rows are CONFIG EDGES, not history: no active/superseded/
 * updated_at columns, a removal is a hard DELETE whose before-row rides the audit, and nothing
 * keys on a line's id — production_inputs snapshot the SKU and the ounces of each batch (0102),
 * so an edit never rewrites a past batch, count or sale. A line's history lives in audit_log,
 * as it already does for add and remove. Seeds 22/25/32 edit lines this way under this action.
 *
 * COMPARE-AND-SET (Astra r1 P2-4). The UPDATE is conditional on (id, recipe_id) AND on every
 * column equalling `expected` — the line the client saw — and RETURNS the written row. 0 rows:
 * the row still on this recipe → 409 line_changed (someone else edited it first; nothing is
 * overwritten); gone or on another recipe → 404 edge_not_found. The audit's `before` is the
 * matched expected line and its `after` is the returned row — never a separate read that could
 * race. Same validator as add (assertInputLineIsValid). An edit that changes nothing (compared
 * normalised) writes and audits nothing. No migration: full expected values, no version column.
 */
export async function updateRecipeInput(
  actor: AuthContext,
  input: { recipeId: string; inputId: string; line: RecipeLineFields; expected: RecipeLineFields },
): Promise<{ changed: boolean }> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  const { line, expected } = input;
  if (componentTargets(line).count !== 1) throw new RecipeError(400, "invalid_component");
  if (!(Number.isFinite(line.quantity) && line.quantity > 0)) throw new RecipeError(400, "invalid_quantity");
  if (componentTargets(expected).count !== 1) throw new RecipeError(400, "invalid_payload");

  const changed = diffRecipeLine(normalizeRecipeLine(expected), line);
  if (changed.length === 0) return { changed: false };

  const sb = getServiceRoleClient();
  await assertInputLineIsValid(sb, input.recipeId, line);

  const seen = lineToRow(expected);
  const match: Array<[string, string | number | boolean | null]> = [
    ["component_sku_id", seen.component_sku_id],
    ["component_item_id", seen.component_item_id],
    ["component_product_id", seen.component_product_id],
    ["quantity", seen.quantity],
    ["unit", seen.unit],
    ["each_container_label", seen.each_container_label],
    ["portioned", seen.portioned],
  ];
  let write = sb.from("recipe_inputs").update(lineToRow(line)).eq("id", input.inputId).eq("recipe_id", input.recipeId);
  for (const [col, value] of match) write = value === null ? write.is(col, null) : write.eq(col, value);
  const { data: written, error } = await write
    .select("component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned")
    .returns<RecipeLineRow[]>();
  if (error) throw new Error(`updateRecipeInput: ${error.message}`);

  const row = written?.[0];
  if (!row) {
    const { data: still, error: readErr } = await sb
      .from("recipe_inputs")
      .select("id")
      .eq("id", input.inputId)
      .eq("recipe_id", input.recipeId)
      .maybeSingle<{ id: string }>();
    if (readErr) throw new Error(`updateRecipeInput recheck: ${readErr.message}`);
    throw still ? new RecipeError(409, "line_changed") : new RecipeError(404, "edge_not_found");
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "recipe_input.update",
    resourceTable: "recipe_inputs",
    resourceId: input.inputId,
    metadata: { recipe_id: input.recipeId, changed_fields: changed, before: seen, after: lineToRow(lineFromRow(row)) },
    ipAddress: null,
    userAgent: null,
  });
  return { changed: true };
}
```

- [ ] **Step 5: Run the tests and tsc**

Run: `npx vitest run tests/recipe-line-edit-server.test.ts tests/audit-actions.test.ts tests/recipe-line-shared.test.ts`
Expected: PASS, 0 failed.

Run: `npx tsc --noEmit 2>&1 | grep -v TS2307 | grep "error TS"`
Expected: no output. The filter builder's `.eq` and `.is` return the builder's own type, so reassigning `write` in the loop type-checks.

- [ ] **Step 6: Commit**

```bash
git add lib/recipes.ts lib/destructive-actions.ts lib/audit-actions.ts lib/dynamic-pars.ts tests/recipe-line-edit-server.test.ts
git commit -F - <<'EOF'
feat(recipes): edit a recipe line in place — compare-and-set, one validator with add, true audit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 8: `PATCH /api/admin/recipes/[id]/inputs/[inputId]`

**Files:**
- Create: `app/api/admin/recipes/[id]/inputs/[inputId]/route.ts`
- Modify: `components/admin/recipes/shared.ts`, `tests/recipe-line-edit-server.test.ts`, `tests/step-up-tier-map.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/recipe-line-edit-server.test.ts`, add these imports at the top, directly after `import { addRecipeInput, updateRecipeInput } from "@/lib/recipes";`:

```ts
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/admin/recipes/[id]/inputs/[inputId]/route";
```

Append:

```ts
describe("PATCH /api/admin/recipes/[id]/inputs/[inputId]", () => {
  const call = (body: unknown) =>
    PATCH(
      new NextRequest(`http://localhost/api/admin/recipes/${R}/inputs/${LINE}`, { method: "PATCH", body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: R, inputId: LINE }) },
    );
  const body = { line: { componentSkuId: "sku-ham", quantity: 5, unit: "oz" }, expected: { componentSkuId: "sku-ham", quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false } };

  it("401 without a session", async () => {
    h.session.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await call(body)).status).toBe(401);
  });

  it("403 below GM, before the step-up check", async () => {
    h.session.mockResolvedValue(agm);
    expect((await call(body)).status).toBe(403);
    expect(h.step).not.toHaveBeenCalled();
  });

  it("asks for the Tier E edit window and stops on a stale unlock", async () => {
    h.session.mockResolvedValue(gm);
    h.step.mockReturnValue({ ok: false, code: "step_up_stale" });
    const res = await call(body);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("step_up_stale");
    expect(h.step).toHaveBeenCalledWith(gm, "E");
    expect(h.db.writes).toEqual([]);
  });

  it("400 on a malformed line or a missing expected line, before any database work", async () => {
    h.session.mockResolvedValue(gm);
    expect((await (await call({ ...body, line: { componentSkuId: "sku-ham", quantity: 0 } })).json()).code).toBe("invalid_quantity");
    expect((await call({ line: body.line })).status).toBe(400);
    expect(h.db.writes).toEqual([]);
  });

  it("200 { changed: true } on a real edit; 409 line_changed when the line moved underneath", async () => {
    h.session.mockResolvedValue(gm);
    const ok = await call(body);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, changed: true });
    const stale = await call({ ...body, line: { ...body.line, quantity: 7 } }); // expected still says 4; the row is 5 now
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("line_changed");
  });
});
```

In `tests/step-up-tier-map.test.ts` `SERVER_TIER_MAP`, add after `"app/api/admin/recipes/[id]/inputs/route.ts": ["E"],`:

```ts
  // Catalog Phase 1: edit one recipe line in place (compare-and-set).
  "app/api/admin/recipes/[id]/inputs/[inputId]/route.ts": ["E"],
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/recipe-line-edit-server.test.ts tests/step-up-tier-map.test.ts`
Expected: FAIL with `Failed to resolve import "@/app/api/admin/recipes/[id]/inputs/[inputId]/route"`; the server map is missing the new route.

- [ ] **Step 3: Create the route**

`app/api/admin/recipes/[id]/inputs/[inputId]/route.ts`:

```ts
/**
 * PATCH /api/admin/recipes/[id]/inputs/[inputId] — edit ONE recipe line in place (catalog
 * redesign Phase 1, 2026-10-15). Body: { line, expected } — the WHOLE new line and the line the
 * client saw (raw). GM+ (RECIPE_WRITE_MIN) and the Tier E edit window; the lib re-checks the
 * level and every line rule and writes only if the row still equals `expected`
 * (lib/recipes.ts updateRecipeInput). 200 { ok, changed } · 409 line_changed · 404 edge_not_found.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { updateRecipeInput, RecipeError, RECIPE_WRITE_MIN } from "@/lib/recipes";
import { parseRecipeLineEdit } from "@/lib/recipe-line-shared";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; inputId: string }> },
) {
  const { id, inputId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/recipes/${id}/inputs/${inputId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const edit = parseRecipeLineEdit(parsed);
  if (!edit.ok) return jsonError(400, edit.code);

  try {
    const result = await updateRecipeInput(ctx, { recipeId: id, inputId, line: edit.line, expected: edit.expected });
    return jsonOk({ ok: true, changed: result.changed });
  } catch (e) {
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
```

- [ ] **Step 4: The product-line codes get their own messages**

In `components/admin/recipes/shared.ts`, add to `KNOWN_ERROR_CODES` after `"invalid_shelf_life_days",`:

```ts
  // Catalog Phase 1 — the line editor reaches these through add AND edit (the keys already exist).
  "invalid_component_product",
  "product_line_needs_measure_unit",
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/recipe-line-edit-server.test.ts tests/step-up-tier-map.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add "app/api/admin/recipes/[id]/inputs/[inputId]/route.ts" components/admin/recipes/shared.ts tests/recipe-line-edit-server.test.ts tests/step-up-tier-map.test.ts
git commit -F - <<'EOF'
feat(recipes): PATCH one recipe line (line + expected) behind the edit window

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 9: The pure ingredient picker

**Files:**
- Create: `lib/ingredient-picker-shared.ts`
- Test: `tests/ingredient-picker-shared.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ingredient-picker-shared.test.ts`:

```ts
/** Catalog Phase 1 — the searchable ingredient picker, pure half. */
import { describe, expect, it } from "vitest";
import {
  buildIngredientOptions,
  filterIngredientOptions,
  ingredientKey,
  lineTargetKey,
  moveActive,
  normalizeSearch,
  optionForLine,
} from "@/lib/ingredient-picker-shared";

const options = buildIngredientOptions({
  skus: [
    { id: "s-ham-b", name: "Ham", vendorName: "Baldor" },
    { id: "s-ham-p", name: "Ham", vendorName: "PFG" },
    { id: "s-honey", name: "Honey Ham", vendorName: "Baldor" },
    { id: "s-graham", name: "Graham Crackers", vendorName: null },
    { id: "s-jal", name: "Jalapeño Slices", vendorName: "Sysco" },
  ],
  items: [{ id: "i-ham-salad", name: "Ham Salad" }],
  products: [{ id: "p-ham", name: "Ham" }],
});

describe("buildIngredientOptions", () => {
  it("merges all three kinds, sorted by name then kind (product, SKU, item), with stable keys", () => {
    expect(options.map((o) => o.key)).toEqual([
      "sku:s-graham", "product:p-ham", "sku:s-ham-b", "sku:s-ham-p", "item:i-ham-salad", "sku:s-honey", "sku:s-jal",
    ]);
    expect(options.find((o) => o.key === "sku:s-ham-b")).toEqual({ key: "sku:s-ham-b", kind: "sku", id: "s-ham-b", name: "Ham", vendorName: "Baldor" });
    expect(options.find((o) => o.key === "item:i-ham-salad")?.vendorName).toBeNull();
  });
});

describe("filterIngredientOptions", () => {
  it("an empty query lists everything, capped, with the true total", () => {
    expect(filterIngredientOptions(options, "  ", 3)).toEqual({ matches: options.slice(0, 3), total: options.length });
  });

  it("ignores case and accents", () => {
    expect(normalizeSearch("  JalapeÑo   SLICES ")).toBe("jalapeno slices");
    expect(filterIngredientOptions(options, "jalapeno").matches.map((o) => o.id)).toEqual(["s-jal"]);
  });

  it("matches the vendor name, and every word must match somewhere", () => {
    expect(filterIngredientOptions(options, "pfg").matches.map((o) => o.id)).toEqual(["s-ham-p"]);
    expect(filterIngredientOptions(options, "ham baldor").matches.map((o) => o.id)).toEqual(["s-ham-b", "s-honey"]);
  });

  it("ranks a name that STARTS with the query first, then a word start, then anywhere", () => {
    expect(filterIngredientOptions(options, "ham").matches.map((o) => o.id)).toEqual([
      "p-ham", "s-ham-b", "s-ham-p", "i-ham-salad", "s-honey", "s-graham",
    ]);
  });

  it("caps the list but reports how many matched", () => {
    const many = buildIngredientOptions({
      skus: Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, name: `Salt ${String(i).padStart(2, "0")}`, vendorName: null })),
      items: [], products: [],
    });
    const r = filterIngredientOptions(many, "salt", 50);
    expect(r.matches).toHaveLength(50);
    expect(r.total).toBe(60);
  });
});

describe("moveActive — arrow keys clamp to the list (P3-8)", () => {
  it("moves within bounds and never past either end", () => {
    expect(moveActive(0, 1, 3)).toBe(1);
    expect(moveActive(2, 1, 3)).toBe(2);
    expect(moveActive(0, -1, 3)).toBe(0);
    expect(moveActive(5, -1, 0)).toBe(0);
  });
});

describe("a line's target as a picker option", () => {
  it("finds the offered option for a line", () => {
    const line = { componentSkuId: "s-ham-p", componentItemId: null, componentProductId: null, componentName: "Ham" };
    expect(lineTargetKey(line)).toBe("sku:s-ham-p");
    expect(optionForLine(line, options)).toBe(options.find((o) => o.key === "sku:s-ham-p"));
  });

  it("synthesises an option for a target the picker no longer offers (a retired product keeps its name)", () => {
    const line = { componentSkuId: null, componentItemId: null, componentProductId: "p-gone", componentName: "Old Ham" };
    expect(optionForLine(line, options)).toEqual({ key: ingredientKey("product", "p-gone"), kind: "product", id: "p-gone", name: "Old Ham", vendorName: null });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/ingredient-picker-shared.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/ingredient-picker-shared"`.

- [ ] **Step 3: Create `lib/ingredient-picker-shared.ts`**

```ts
/**
 * Searchable ingredient picker — CLIENT-SAFE pure half (catalog redesign Phase 1, 2026-10-15).
 * Replaces three unsearchable <select>s (every SKU, every item, every product) with ONE list a
 * manager can type into on a phone: name · vendor · kind.
 *
 * Search is accent-blind and case-blind; every typed word must appear in the name or the vendor
 * ("ham baldor"). Ranking: the name STARTS with the whole query, then any word of the name starts
 * with the first word, then anywhere; ties by name, kind (product, SKU, item — the product is the
 * vendor-proof pin), vendor, id.
 */
export type IngredientKind = "sku" | "item" | "product";

export interface IngredientOption {
  key: string;
  kind: IngredientKind;
  id: string;
  name: string;
  /** A SKU's vendor; null for items, products and vendorless SKUs. */
  vendorName: string | null;
}

export const INGREDIENT_RESULT_LIMIT = 50;

const KIND_ORDER: Record<IngredientKind, number> = { product: 0, sku: 1, item: 2 };

export function ingredientKey(kind: IngredientKind, id: string): string {
  return `${kind}:${id}`;
}

function compareOptions(a: IngredientOption, b: IngredientOption): number {
  return (
    a.name.localeCompare(b.name) ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    (a.vendorName ?? "").localeCompare(b.vendorName ?? "") ||
    a.id.localeCompare(b.id)
  );
}

export function buildIngredientOptions(input: {
  skus: ReadonlyArray<{ id: string; name: string; vendorName?: string | null }>;
  items: ReadonlyArray<{ id: string; name: string }>;
  products: ReadonlyArray<{ id: string; name: string }>;
}): IngredientOption[] {
  const out: IngredientOption[] = [
    ...input.products.map((p) => ({ key: ingredientKey("product", p.id), kind: "product" as const, id: p.id, name: p.name, vendorName: null })),
    ...input.skus.map((s) => ({ key: ingredientKey("sku", s.id), kind: "sku" as const, id: s.id, name: s.name, vendorName: s.vendorName ?? null })),
    ...input.items.map((i) => ({ key: ingredientKey("item", i.id), kind: "item" as const, id: i.id, name: i.name, vendorName: null })),
  ];
  return out.sort(compareOptions);
}

/** Lower-case, accents stripped, whitespace collapsed. */
export function normalizeSearch(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function filterIngredientOptions(
  options: readonly IngredientOption[],
  query: string,
  limit: number = INGREDIENT_RESULT_LIMIT,
): { matches: IngredientOption[]; total: number } {
  const q = normalizeSearch(query);
  if (q === "") return { matches: options.slice(0, limit), total: options.length };
  const tokens = q.split(" ");
  const first = tokens[0] ?? q;
  const scored: Array<{ o: IngredientOption; rank: number }> = [];
  for (const o of options) {
    const name = normalizeSearch(o.name);
    const hay = o.vendorName ? `${name} ${normalizeSearch(o.vendorName)}` : name;
    if (!tokens.every((t) => hay.includes(t))) continue;
    const rank = name.startsWith(q) ? 0 : name.split(" ").some((w) => w.startsWith(first)) ? 1 : 2;
    scored.push({ o, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || compareOptions(a.o, b.o));
  return { matches: scored.slice(0, limit).map((s) => s.o), total: scored.length };
}

/** The keyboard's next active row: one step, clamped to the list. */
export function moveActive(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(current + delta, 0), count - 1);
}

type LineTarget = {
  componentSkuId: string | null;
  componentItemId: string | null;
  componentProductId: string | null;
};

export function lineTargetKey(line: LineTarget): string {
  if (line.componentProductId !== null) return ingredientKey("product", line.componentProductId);
  if (line.componentItemId !== null) return ingredientKey("item", line.componentItemId);
  return ingredientKey("sku", line.componentSkuId ?? "");
}

/** The option for a line's current target — synthesised when the picker no longer offers it
 *  (a retired product or a deactivated SKU), so the editor still shows what the line names. */
export function optionForLine(line: LineTarget & { componentName: string }, options: readonly IngredientOption[]): IngredientOption {
  const key = lineTargetKey(line);
  const found = options.find((o) => o.key === key);
  if (found) return found;
  const kind: IngredientKind = line.componentProductId !== null ? "product" : line.componentItemId !== null ? "item" : "sku";
  const id = (kind === "product" ? line.componentProductId : kind === "item" ? line.componentItemId : line.componentSkuId) ?? "";
  return { key, kind, id, name: line.componentName, vendorName: null };
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run tests/ingredient-picker-shared.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add lib/ingredient-picker-shared.ts tests/ingredient-picker-shared.test.ts
git commit -F - <<'EOF'
feat(recipes): pure searchable ingredient picker (name · vendor · kind, ranked, keyboard clamp)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 10: One loader for both recipe pages; SKUs carry their vendor's name

**Files:**
- Create: `lib/admin/recipe-builder-data.ts`
- Rewrite: `app/admin/recipes/[id]/page.tsx`, `app/admin/recipes/new/page.tsx`
- Modify: `components/admin/recipes/RecipeBuilder.tsx` (the `RecipeBuilderSku` type)

This is DB-coupled loader code. It is verified by `tsc` here and on the sim in Task 20; the spine is pure-only.

- [ ] **Step 1: Add `vendorName` to `RecipeBuilderSku`**

In `components/admin/recipes/RecipeBuilder.tsx`, replace:

```tsx
export interface RecipeBuilderSku extends RecipeInputSku {
  id: string;
  name: string;
}
```

with:

```tsx
export interface RecipeBuilderSku extends RecipeInputSku {
  id: string;
  name: string;
  /** The SKU's vendor, for the picker's "name · vendor · kind" label; null = no vendor. */
  vendorName: string | null;
}
```

- [ ] **Step 2: Run tsc and watch it fail**

Run: `npx tsc --noEmit 2>&1 | grep -v TS2307 | grep "error TS"`
Expected: two errors, `Property 'vendorName' is missing`, in `app/admin/recipes/[id]/page.tsx` and `app/admin/recipes/new/page.tsx`.

- [ ] **Step 3: Create `lib/admin/recipe-builder-data.ts`**

```ts
/**
 * The picker universe both recipe builder pages load (/admin/recipes/[id] and /new) — ONE
 * loader so the two pages cannot drift (they carried byte-identical copies until catalog
 * Phase 1, 2026-10-15). Service-role reads with the same filters as before: active SKUs that
 * are not inventory-only, active items, ACTIVE products (load-bearing — a retired product
 * refuses at the resolution ladder, Juan's ruling A+, and assertProductLineIsValid refuses the
 * write anyway), the units registry and the measure registry. New: each SKU carries its
 * vendor's NAME so the searchable picker can say "Ham · Baldor · SKU".
 *
 * Errors keep the pages' old posture — a failed read yields an empty list — and a failed
 * vendors read only drops the names.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import type { RecipeBuilderProduct, RecipeBuilderSku } from "@/components/admin/recipes/RecipeBuilder";

export interface RecipeBuilderCatalog {
  skus: RecipeBuilderSku[];
  items: Array<{ id: string; name: string }>;
  products: RecipeBuilderProduct[];
  unitOptions: Array<{ id: string; label: string }>;
  measures: Map<string, MeasureUnitFactor>;
}

export async function loadRecipeBuilderCatalog(): Promise<RecipeBuilderCatalog> {
  const sb = getServiceRoleClient();
  const [skusRes, itemsRes, unitsRes, measuresRes, productsRes, vendorsRes] = await Promise.all([
    sb
      .from("vendor_items")
      .select("id, name, vendor_id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
      .eq("active", true)
      .eq("inventory_only", false)
      .order("name")
      .returns<Array<{
        id: string; name: string; vendor_id: string | null;
        pack_format: string | null;
        each_container_label: string | null;
        units_per_pack: number | string | null;
        each_size: number | string | null;
        each_measure: string | null;
        avg_oz_per_each: number | string | null;
      }>>(),
    sb.from("items").select("id, name").eq("active", true).order("name").returns<Array<{ id: string; name: string }>>(),
    sb.from("units").select("id, label").order("label").returns<Array<{ id: string; label: string }>>(),
    sb
      .from("measure_units")
      .select("label, dimension, to_base_factor")
      .returns<Array<{ label: string; dimension: string; to_base_factor: number | string }>>(),
    sb
      .from("products")
      .select("id, name, unit_oz")
      .eq("active", true)
      .order("name")
      .returns<Array<{ id: string; name: string; unit_oz: number | string | null }>>(),
    sb.from("vendors").select("id, name").returns<Array<{ id: string; name: string }>>(),
  ]);

  const vendorNameById = new Map((vendorsRes.data ?? []).map((v) => [v.id, v.name]));
  const skus: RecipeBuilderSku[] = (skusRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    vendorName: s.vendor_id ? (vendorNameById.get(s.vendor_id) ?? null) : null,
    packFormat: s.pack_format ?? null,
    eachContainerLabel: s.each_container_label ?? null,
    unitsPerPack: s.units_per_pack != null ? Number(s.units_per_pack) : null,
    eachSize: s.each_size != null ? Number(s.each_size) : null,
    eachMeasure: s.each_measure ?? null,
    avgOzPerEach: s.avg_oz_per_each != null ? Number(s.avg_oz_per_each) : null,
  }));
  const items = (itemsRes.data ?? []).map((i) => ({ id: i.id, name: i.name }));
  const products: RecipeBuilderProduct[] = (productsRes.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    unitOz: p.unit_oz != null ? Number(p.unit_oz) : null,
  }));
  const unitOptions = (unitsRes.data ?? []).map((u) => ({ id: u.id, label: u.label }));
  const measures = new Map<string, MeasureUnitFactor>(
    (measuresRes.data ?? []).map((m) => [
      m.label,
      { dimension: m.dimension as MeasureUnitFactor["dimension"], toBaseFactor: Number(m.to_base_factor) },
    ]),
  );
  return { skus, items, products, unitOptions, measures };
}
```

- [ ] **Step 4: Rewrite `app/admin/recipes/[id]/page.tsx`** (replace the whole file)

```tsx
/**
 * /admin/recipes/[id] — Recipe detail + builder page. Server component.
 *
 * Loads the recipe + the builder's picker universe (lib/admin/recipe-builder-data.ts, shared
 * with /new) + readiness + the catering flags of its menu outputs. Gate: >= RECIPE_READ_MIN (6).
 */

import { notFound, redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadRecipe, RECIPE_READ_MIN } from "@/lib/recipes";
import { loadGraphReadiness } from "@/lib/admin/readiness-load";
import { loadRecipeBuilderCatalog } from "@/lib/admin/recipe-builder-data";
import type { Readiness } from "@/lib/readiness";
import { RECIPE_WRITE_MIN } from "@/lib/recipes-shared";
import { RecipeBuilder } from "@/components/admin/recipes/RecipeBuilder";
import { RecipeCateringFlags, type RecipeMenuOutputFlags } from "@/components/admin/recipes/RecipeCateringFlags";

export default async function AdminRecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const auth = await requireSessionFromHeaders("/admin/recipes");
  const level = getRoleLevel(auth.user.role);
  if (level < RECIPE_READ_MIN) redirect("/dashboard");

  const sb = getServiceRoleClient();
  const [recipe, catalog] = await Promise.all([loadRecipe(auth, id), loadRecipeBuilderCatalog()]);
  if (!recipe) notFound();

  // Catering flags for this recipe's MENU_ITEM outputs (piece 2) — batch load
  // the current flag columns for every sub the recipe produces.
  const menuOutputIds = [
    ...new Set(recipe.outputs.map((o) => o.outputMenuItemId).filter((v): v is string => v != null)),
  ];
  let cateringFlags: RecipeMenuOutputFlags[] = [];
  if (menuOutputIds.length > 0) {
    const { data: flagRows } = await sb
      .from("menu_items")
      .select("id, name, catering_available, catering_only, catering_portionable, serves, seasonal")
      .in("id", menuOutputIds)
      .returns<Array<{
        id: string; name: string; catering_available: boolean; catering_only: boolean;
        catering_portionable: boolean | null; serves: number | string | null; seasonal: boolean;
      }>>();
    cateringFlags = (flagRows ?? []).map((r) => ({
      menuItemId: r.id,
      name: r.name,
      cateringAvailable: r.catering_available,
      cateringOnly: r.catering_only,
      cateringPortionable: r.catering_portionable ?? false,
      serves: r.serves == null ? null : Number(r.serves),
      seasonal: r.seasonal,
    }));
  }

  let readiness: Readiness | null = null;
  try {
    const g = await loadGraphReadiness(auth);
    readiness = g.recipeReadiness.get(id) ?? null;
  } catch (e) {
    console.error("readiness load failed (rendering without banner)", e);
  }

  return (
    <div>
      <RecipeBuilder
        recipe={recipe}
        skus={catalog.skus}
        items={catalog.items}
        products={catalog.products}
        unitOptions={catalog.unitOptions}
        measures={catalog.measures}
        level={level}
        readiness={readiness}
      />
      {menuOutputIds.length > 0 ? (
        <RecipeCateringFlags outputs={cateringFlags} canEdit={level >= RECIPE_WRITE_MIN} />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Rewrite `app/admin/recipes/new/page.tsx`** (replace the whole file)

```tsx
/**
 * /admin/recipes/new — Draft recipe creation page. Server component.
 *
 * Loads the builder's picker universe (lib/admin/recipe-builder-data.ts, shared with
 * [id]/page.tsx) and renders RecipeBuilder in draft mode (recipe=null). On Save,
 * RecipeBuilder POSTs to /api/admin/recipes/full.
 *
 * searchParams may carry ?type=production|consumer to pre-select recipe type.
 * Gate: >= RECIPE_READ_MIN (6, AGM+).
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { RECIPE_READ_MIN } from "@/lib/recipes";
import { loadRecipeBuilderCatalog } from "@/lib/admin/recipe-builder-data";
import { RecipeBuilder } from "@/components/admin/recipes/RecipeBuilder";
import { PageHeader } from "@/components/ui/PageHeader";
import type { RecipeType } from "@/lib/recipes";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";

const rk = (k: string): TranslationKey => k as TranslationKey;

export default async function AdminRecipesNewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rawType = typeof sp["type"] === "string" ? sp["type"] : undefined;
  const defaultType: RecipeType = rawType === "consumer" ? "consumer" : "production";

  const auth = await requireSessionFromHeaders("/admin/recipes/new");
  const level = getRoleLevel(auth.user.role);
  if (level < RECIPE_READ_MIN) redirect("/dashboard");

  const lang = auth.user.language;
  const catalog = await loadRecipeBuilderCatalog();

  return (
    <div>
      <PageHeader
        title={serverT(lang, rk("recipes.new.title"))}
        subtitle={serverT(lang, rk("recipes.new.subtitle"))}
      />
      <RecipeBuilder
        recipe={null}
        skus={catalog.skus}
        items={catalog.items}
        products={catalog.products}
        unitOptions={catalog.unitOptions}
        measures={catalog.measures}
        level={level}
        defaultType={defaultType}
      />
    </div>
  );
}
```

- [ ] **Step 6: Run tsc**

Run: `npx tsc --noEmit 2>&1 | grep -v TS2307 | grep "error TS"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add lib/admin/recipe-builder-data.ts "app/admin/recipes/[id]/page.tsx" app/admin/recipes/new/page.tsx components/admin/recipes/RecipeBuilder.tsx
git commit -F - <<'EOF'
refactor(recipes): one picker loader for both builder pages; SKUs carry their vendor name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 11: `IngredientPicker` + `RecipeLineEditor` and their strings

**Files:**
- Create: `components/admin/recipes/IngredientPicker.tsx`, `components/admin/recipes/RecipeLineEditor.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`
- Test: `tests/ingredient-picker-ui.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ingredient-picker-ui.test.ts`:

```ts
/** Catalog Phase 1 — the picker renders as an accessible combobox with 44px rows, in en and es. */
import { readFileSync } from "node:fs";
import { type ReactNode } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import { IngredientPicker } from "@/components/admin/recipes/IngredientPicker";
import { buildIngredientOptions } from "@/lib/ingredient-picker-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const render = (children: ReactNode, language: Language = "en") =>
  renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children }));
const options = buildIngredientOptions({
  skus: [{ id: "s-ham", name: "Ham", vendorName: "Baldor" }],
  items: [{ id: "i-slaw", name: "Slaw" }],
  products: [{ id: "p-turkey", name: "Turkey" }],
});

describe("IngredientPicker", () => {
  it("with nothing chosen it is an open combobox listing name · vendor · kind in 44px rows", () => {
    const html = render(jsx(IngredientPicker, { options, value: null, onChange: () => {} }));
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="listbox"');
    expect(html.match(/role="option"/g)).toHaveLength(3);
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain("Baldor");
    expect(html).toContain(en["recipes.picker.kind.item"]);
  });

  it("with a choice it shows the choice and a Change button, and no list", () => {
    const html = render(jsx(IngredientPicker, { options, value: options[0]!, onChange: () => {} }), "es");
    expect(html).not.toContain('role="listbox"');
    expect(html).toContain(es["recipes.picker.change"]);
  });

  it("keyboard: arrows use the clamp and the active option scrolls into view (P3-8)", () => {
    const src = readFileSync("components/admin/recipes/IngredientPicker.tsx", "utf8");
    expect(src).toContain("moveActive(i, 1, matches.length)");
    expect(src).toContain("moveActive(i, -1, matches.length)");
    expect(src).toContain('scrollIntoView({ block: "nearest" })');
  });
});

describe("every new string exists in en AND es", () => {
  const keys = [
    "recipes.builder.add_ingredient", "recipes.builder.add_ingredient_title",
    "recipes.picker.label", "recipes.picker.placeholder", "recipes.picker.results", "recipes.picker.no_matches",
    "recipes.picker.more", "recipes.picker.no_vendor", "recipes.picker.change", "recipes.picker.change_aria",
    "recipes.picker.kind.sku", "recipes.picker.kind.item", "recipes.picker.kind.product",
    "recipes.input.sku_unit_unresolved",
    "recipes.row.edit", "recipes.row.edit_aria", "recipes.row.edit_title", "recipes.row.save_changes",
    "recipes.error.line_changed", "recipes.error.step_up_grant_required",
    "admin.skus.error.step_up_grant_required", "admin.products.error.step_up_grant_required",
  ];
  it.each(keys)("%s", (k) => {
    expect((en as Record<string, string>)[k]).toBeTruthy();
    expect((es as Record<string, string>)[k]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/ingredient-picker-ui.test.ts`
Expected: FAIL with `Failed to resolve import "@/components/admin/recipes/IngredientPicker"`.

- [ ] **Step 3: Add the strings**

`lib/i18n/en.json`, insert right after `  "recipes.row.cancel": "Cancel",`:

```json
  "recipes.row.edit": "Edit",
  "recipes.row.edit_aria": "Edit the line {name}",
  "recipes.row.edit_title": "Edit this line",
  "recipes.row.save_changes": "Save changes",
  "recipes.builder.add_ingredient": "+ Add ingredient",
  "recipes.builder.add_ingredient_title": "Add an ingredient",
  "recipes.picker.label": "Ingredient",
  "recipes.picker.placeholder": "Type to search SKUs, prep items and products",
  "recipes.picker.results": "Matching ingredients",
  "recipes.picker.no_matches": "Nothing matches. Try fewer letters or the vendor's name.",
  "recipes.picker.more": "{n} more. Keep typing to narrow it down.",
  "recipes.picker.no_vendor": "No vendor",
  "recipes.picker.change": "Change",
  "recipes.picker.change_aria": "Change the ingredient {name}",
  "recipes.picker.kind.sku": "SKU",
  "recipes.picker.kind.item": "Prep item",
  "recipes.picker.kind.product": "Product · any vendor",
  "recipes.input.sku_unit_unresolved": "This unit can't be turned into ounces for this SKU yet. Pick its pack or oz, or add the SKU's weight first.",
```

`lib/i18n/es.json`, insert right after `  "recipes.row.cancel": "Cancelar",`:

```json
  "recipes.row.edit": "Editar",
  "recipes.row.edit_aria": "Editar la línea {name}",
  "recipes.row.edit_title": "Editar esta línea",
  "recipes.row.save_changes": "Guardar cambios",
  "recipes.builder.add_ingredient": "+ Agregar ingrediente",
  "recipes.builder.add_ingredient_title": "Agrega un ingrediente",
  "recipes.picker.label": "Ingrediente",
  "recipes.picker.placeholder": "Escribe para buscar SKUs, preparaciones y productos",
  "recipes.picker.results": "Ingredientes que coinciden",
  "recipes.picker.no_matches": "Nada coincide. Prueba con menos letras o con el nombre del proveedor.",
  "recipes.picker.more": "{n} más. Sigue escribiendo para filtrar.",
  "recipes.picker.no_vendor": "Sin proveedor",
  "recipes.picker.change": "Cambiar",
  "recipes.picker.change_aria": "Cambiar el ingrediente {name}",
  "recipes.picker.kind.sku": "SKU",
  "recipes.picker.kind.item": "Preparación",
  "recipes.picker.kind.product": "Producto · cualquier proveedor",
  "recipes.input.sku_unit_unresolved": "Esta unidad todavía no se puede pasar a onzas para este SKU. Elige su empaque u oz, o agrega primero el peso del SKU.",
```

- [ ] **Step 4: Create `components/admin/recipes/IngredientPicker.tsx`**

```tsx
"use client";

/**
 * IngredientPicker — the searchable ingredient field (catalog redesign Phase 1, 2026-10-15).
 * An ARIA 1.2 combobox: type to filter (lib/ingredient-picker-shared.ts), ↑/↓ to move (clamped,
 * and the active row scrolls into view), Enter to choose, Escape to close back to the current
 * choice. Options are 44px rows that work by tap (mousedown keeps focus in the input so a tap
 * never blurs the list away). The list flows in the page (no absolute overlay), so it never
 * clips at phone width; rows truncate long names instead of widening the page.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import {
  filterIngredientOptions,
  INGREDIENT_RESULT_LIMIT,
  moveActive,
  type IngredientKind,
  type IngredientOption,
} from "@/lib/ingredient-picker-shared";

const rk = (k: string): TranslationKey => k as TranslationKey;

const fieldCls =
  "min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

export function IngredientPicker({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: IngredientOption[];
  /** The chosen option, or null. A line whose target is no longer offered passes a synthesised option. */
  value: IngredientOption | null;
  onChange: (next: IngredientOption | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(value === null);
  const [active, setActive] = useState(0);

  const { matches, total } = useMemo(
    () => filterIngredientOptions(options, query, INGREDIENT_RESULT_LIMIT),
    [options, query],
  );

  // P3-8: the keyboard's active row is always visible inside the scrolling list.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${baseId}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, baseId]);

  const kindLabel = (k: IngredientKind) => t(rk(`recipes.picker.kind.${k}`));
  const vendorLabel = (o: IngredientOption) => (o.kind === "sku" ? (o.vendorName ?? t(rk("recipes.picker.no_vendor"))) : null);

  const choose = (o: IngredientOption) => {
    onChange(o);
    setQuery("");
    setOpen(false);
    setActive(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => moveActive(i, 1, matches.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => moveActive(i, -1, matches.length));
    } else if (e.key === "Enter") {
      const o = matches[active];
      if (open && o) {
        e.preventDefault();
        choose(o);
      }
    } else if (e.key === "Escape" && value) {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  };

  if (value && !open) {
    return (
      <div className="mt-1 flex min-h-[44px] items-center justify-between gap-2 rounded-lg border-2 border-co-border bg-co-surface pl-3">
        <span className="min-w-0 truncate text-base text-co-text">
          {[value.name, vendorLabel(value), kindLabel(value.kind)].filter(Boolean).join(" · ")}
        </span>
        <button
          type="button"
          disabled={disabled}
          aria-label={t(rk("recipes.picker.change_aria"), { name: value.name })}
          onClick={() => {
            setOpen(true);
            setActive(0);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="inline-flex min-h-[44px] shrink-0 items-center px-3 text-xs font-bold text-co-text underline underline-offset-2 disabled:opacity-50"
        >
          {t(rk("recipes.picker.change"))}
        </button>
      </div>
    );
  }

  const activeOption = matches[active];
  return (
    <div className="mt-1">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeOption ? optionId(active) : undefined}
        aria-label={t(rk("recipes.picker.label"))}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className={fieldCls}
        value={query}
        disabled={disabled}
        placeholder={t(rk("recipes.picker.placeholder"))}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t(rk("recipes.picker.results"))}
          className="mt-1 max-h-72 overflow-y-auto rounded-lg border-2 border-co-border bg-co-surface"
        >
          {matches.length === 0 ? (
            <li role="presentation" className="flex min-h-[44px] items-center px-3 text-sm text-co-text-muted">
              {t(rk("recipes.picker.no_matches"))}
            </li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.key}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2 px-3 text-sm text-co-text ${i === active ? "bg-co-surface-2" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate font-bold">{o.name}</span>
                {vendorLabel(o) ? (
                  <span className="max-w-[40%] shrink-0 truncate text-xs text-co-text-muted">{vendorLabel(o)}</span>
                ) : null}
                <span className="shrink-0 rounded bg-co-gold/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-co-text">
                  {kindLabel(o.kind)}
                </span>
              </li>
            ))
          )}
          {total > matches.length ? (
            <li role="presentation" className="px-3 py-2 text-xs text-co-text-muted">
              {t(rk("recipes.picker.more"), { n: total - matches.length })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Create `components/admin/recipes/RecipeLineEditor.tsx`**

```tsx
"use client";

/**
 * RecipeLineEditor — ONE form for adding a recipe line AND editing one in place, saved or
 * draft (catalog redesign Phase 1, 2026-10-15). Replaces the three per-kind add forms and their
 * unsearchable selects: the ingredient comes from the searchable IngredientPicker, then qty + unit.
 *
 * The unit rules are the server's, offered up front (lib/recipe-line-shared.ts lineUnitChoices):
 * a PRODUCT line offers every active measure-registry unit and no pack label (D3); a SKU line
 * offers its pack labels plus the measure registry and keeps its current unit first; a prep-item
 * line keeps its free-text unit. The server re-checks every rule (assertInputLineIsValid).
 * Edit mode disables Save until something changed (diffRecipeLine — the server's own test).
 */
import { useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { ozForRecipeInput, type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";
import { productInputBasis } from "@/lib/products-shared";
import { diffRecipeLine, lineUnitChoices, type RecipeLineDraft } from "@/lib/recipe-line-shared";
import { lineTargetKey, optionForLine, type IngredientOption } from "@/lib/ingredient-picker-shared";
import { IngredientPicker } from "./IngredientPicker";
import type { RecipeBuilderProduct, RecipeBuilderSku } from "./RecipeBuilder";

const rk = (k: string): TranslationKey => k as TranslationKey;

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

export function RecipeLineEditor({
  title,
  submitLabel,
  options,
  skus,
  products,
  measures,
  initial,
  busy,
  errorMsg,
  onSubmit,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  options: IngredientOption[];
  skus: RecipeBuilderSku[];
  products: RecipeBuilderProduct[];
  measures: Map<string, MeasureUnitFactor>;
  /** null = add a new line; a line = edit it in place. */
  initial: RecipeLineDraft | null;
  busy: boolean;
  errorMsg: string | null;
  onSubmit: (line: RecipeLineDraft) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<IngredientOption | null>(() => (initial ? optionForLine(initial, options) : null));
  const [qty, setQty] = useState(initial ? String(initial.quantity) : "");
  const [unit, setUnit] = useState(initial?.unit ?? "");
  const [portioned, setPortioned] = useState(initial?.portioned ?? false);
  const [localError, setLocalError] = useState<string | null>(null);

  const measureLabels = useMemo(() => [...measures.keys()].sort((a, b) => a.localeCompare(b)), [measures]);
  const keepsTarget = initial !== null && choice !== null && lineTargetKey(initial) === choice.key;
  const sku = choice?.kind === "sku" ? (skus.find((s) => s.id === choice.id) ?? null) : null;
  const product = choice?.kind === "product" ? (products.find((p) => p.id === choice.id) ?? null) : null;
  const unitChoices = choice
    ? lineUnitChoices(choice.kind, sku, measureLabels, keepsTarget ? (initial?.unit ?? null) : null)
    : [];

  const pick = (next: IngredientOption | null) => {
    setChoice(next);
    setLocalError(null);
    const keeps = initial !== null && next !== null && lineTargetKey(initial) === next.key;
    setUnit(keeps ? (initial?.unit ?? "") : "");
    if (next?.kind === "item") setPortioned(false);
  };

  const qtyNum = Number(qty);
  const qtyOk = qty.trim() !== "" && Number.isFinite(qtyNum) && qtyNum > 0;
  const basis: RecipeInputSku | null =
    sku ?? (product ? productInputBasis({ productId: product.id, unitOz: product.unitOz }, null) : null);
  const oz = basis && unit !== "" && qtyOk ? ozForRecipeInput(qtyNum, unit, basis, measures) : null;
  const productNeedsUnitOz =
    product != null && product.unitOz == null && unit !== "" && measures.get(unit)?.dimension !== "weight";
  const skuUnitUnresolved = sku != null && unit !== "" && qtyOk && oz == null;

  const draft: RecipeLineDraft | null = choice
    ? {
        componentSkuId: choice.kind === "sku" ? choice.id : null,
        componentItemId: choice.kind === "item" ? choice.id : null,
        componentProductId: choice.kind === "product" ? choice.id : null,
        quantity: qtyNum,
        unit: unit.trim() || null,
        eachContainerLabel:
          choice.kind !== "sku" ? null : keepsTarget ? (initial?.eachContainerLabel ?? null) : (sku?.eachContainerLabel ?? null),
        portioned: choice.kind === "item" ? false : portioned,
        componentName: choice.name,
      }
    : null;
  const unchanged = initial !== null && draft !== null && diffRecipeLine(initial, draft).length === 0;
  const canSave = !busy && draft !== null && qtyOk && !unchanged;

  const submit = () => {
    setLocalError(null);
    if (!draft) { setLocalError(t(rk("recipes.error.invalid_component"))); return; }
    if (!qtyOk) { setLocalError(t(rk("recipes.error.invalid_quantity"))); return; }
    if (draft.componentProductId !== null && draft.unit === null) {
      setLocalError(t(rk("recipes.error.product_line_needs_measure_unit")));
      return;
    }
    onSubmit(draft);
  };

  const shownError = localError ?? errorMsg;

  return (
    <div className="rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
      <h3 className="text-sm font-extrabold text-co-text">{title}</h3>
      <div className="mt-3 flex flex-col gap-3">
        <div>
          <span className="text-sm font-bold text-co-text">{t(rk("recipes.picker.label"))}</span>
          <IngredientPicker options={options} value={choice} onChange={pick} disabled={busy} />
        </div>
        {choice?.kind === "product" ? (
          <p className="text-xs text-co-text-muted">{t(rk("recipes.input.product_hint"))}</p>
        ) : null}
        <label className="block">
          <span className="text-sm font-bold text-co-text">{t(rk("recipes.input.quantity"))}</span>
          <input
            className={fieldCls}
            type="number"
            min={0.001}
            step="any"
            inputMode="decimal"
            value={qty}
            disabled={busy || choice === null}
            onChange={(e) => setQty(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold text-co-text">{t(rk("recipes.input.unit"))}</span>
          {unitChoices === null ? (
            <input
              className={fieldCls}
              type="text"
              value={unit}
              disabled={busy || choice === null}
              placeholder={t(rk("recipes.input.unit_placeholder"))}
              onChange={(e) => setUnit(e.target.value)}
            />
          ) : (
            <select className={fieldCls} value={unit} disabled={busy || choice === null} onChange={(e) => setUnit(e.target.value)}>
              <option value="">{t(rk("recipes.input.unit_placeholder"))}</option>
              {unitChoices.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          )}
        </label>
        {oz != null ? (
          <p className="text-xs text-co-text-muted">{qty} {unit} ≈ {oz.toFixed(1)} oz</p>
        ) : null}
        {productNeedsUnitOz ? <p className="text-xs text-co-warning-text">{t(rk("recipes.input.product_needs_unit_oz"))}</p> : null}
        {skuUnitUnresolved ? <p className="text-xs text-co-warning-text">{t(rk("recipes.input.sku_unit_unresolved"))}</p> : null}
        {choice !== null && choice.kind !== "item" ? (
          <label className="flex min-h-[44px] items-center gap-2">
            <input
              type="checkbox"
              checked={portioned}
              disabled={busy}
              onChange={(e) => setPortioned(e.target.checked)}
              className="h-5 w-5 rounded border-2 border-co-border"
            />
            <span className="text-sm font-bold text-co-text">{t(rk("recipes.input.portioned"))}</span>
          </label>
        ) : null}
        {shownError ? <p role="alert" className="text-sm text-co-cta-text">{shownError}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50"
          >
            {t(rk("recipes.builder.cancel"))}
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={submit}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the tests and tsc**

Run: `npx vitest run tests/ingredient-picker-ui.test.ts`
Expected: PASS, 0 failed.

Run: `npx tsc --noEmit 2>&1 | grep -v TS2307 | grep "error TS"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add components/admin/recipes/IngredientPicker.tsx components/admin/recipes/RecipeLineEditor.tsx lib/i18n/en.json lib/i18n/es.json tests/ingredient-picker-ui.test.ts
git commit -F - <<'EOF'
feat(recipes): searchable ingredient picker and one add/edit line form (en + es)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 12: Wire the builder — saved AND draft lines edit in place; add with the picker

**Files:**
- Modify: `components/admin/recipes/RecipeBuilder.tsx` (CONSUMES section + DraftInputRow + call site)
- Modify: `components/admin/recipes/RecipeInputRow.tsx`
- Test: `tests/recipe-line-edit-ui.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/recipe-line-edit-ui.test.ts`:

```ts
/** Catalog Phase 1 — saved and draft lines edit in place; ingredients come from the picker. Source pins. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");
const builder = read("components/admin/recipes/RecipeBuilder.tsx");
const consumes = builder.slice(builder.indexOf("function ConsumesSection"), builder.indexOf("function DraftInputRow"));
const draftRow = builder.slice(builder.indexOf("function DraftInputRow"), builder.indexOf("// ── PRODUCES section"));

describe("CONSUMES — one searchable picker, one line form", () => {
  it("the three unsearchable selects are gone from the line form", () => {
    expect(consumes).not.toContain("skus.map((s) => (<option");
    expect(consumes).not.toContain("items.map((i) => (<option");
    expect(consumes).not.toContain("products.map((p) => (<option");
    expect(consumes).toContain("buildIngredientOptions(");
    expect(consumes.match(/<RecipeLineEditor/g)).toHaveLength(3); // add + live edit + draft edit
  });

  it("a saved line is edited IN PLACE through PATCH …/inputs/[inputId], behind the window", () => {
    const lane = consumes.slice(consumes.indexOf("const submitLiveEdit"), consumes.indexOf("const submitDraftEdit"));
    expect(lane).toContain("/inputs/${start.id}`");
    expect(lane).toContain("{ line: lineBody(line), expected: start.expected }");
    expect(lane).toContain('"PATCH"');
    expect(lane.indexOf('requestStepUp("E")')).toBeGreaterThan(-1);
    expect(lane.indexOf('requestStepUp("E")')).toBeLessThan(lane.indexOf("send("));
  });

  it("the expected line is captured when editing BEGINS, never re-read from a refreshed row (Astra r2 #1)", () => {
    expect(consumes).toContain('setEditing({ kind: "live", ...beginLineEdit(inp) })');
    expect(consumes).toContain("initial={live.initial}");
    expect(consumes).not.toContain("lineSnapshotFromView(");
    expect(consumes).not.toContain("initial={lineDraftFromView(inp)}");
  });

  it("a DRAFT line is edited in place locally (P2-7) — no request, no password", () => {
    const lane = consumes.slice(consumes.indexOf("const submitDraftEdit"), consumes.indexOf("return ("));
    expect(lane).toContain("onUpdateDraftInput(");
    expect(lane).not.toContain("send(");
    expect(lane).not.toContain("requestStepUp");
    expect(draftRow).toContain("onEdit");
    expect(builder).toContain("onUpdateDraftInput={updateDraftInput}");
  });

  it("a live add asks for the window; a draft add writes nothing and asks for nothing", () => {
    const lane = consumes.slice(consumes.indexOf("const submitAdd"), consumes.indexOf("const submitLiveEdit"));
    expect(lane.indexOf("if (isDraft)")).toBeLessThan(lane.indexOf('requestStepUp("E")'));
  });

  it("RecipeInputRow offers Edit beside Remove", () => {
    const row = read("components/admin/recipes/RecipeInputRow.tsx");
    expect(row).toContain("onEdit");
    expect(row).toContain('rk("recipes.row.edit")');
    expect(row).toContain('rk("recipes.row.edit_aria")');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/recipe-line-edit-ui.test.ts`
Expected: FAIL. The selects are still present, `<RecipeLineEditor` is matched 0 times, and there is no `submitLiveEdit`, `onUpdateDraftInput` or `onEdit`.

- [ ] **Step 3: Add Edit to `RecipeInputRow.tsx`**

Replace ` * RecipeInputRow — one existing recipe_input edge with a remove (✕) button.` with:

```tsx
 * RecipeInputRow — one existing recipe_input edge with Edit (in place — catalog Phase 1)
 * and Remove buttons.
```

Replace the props block:

```tsx
export function RecipeInputRow({
  input,
  canEdit,
  onRemove,
}: {
  input: RecipeInputView;
  canEdit: boolean;
  onRemove: (id: string) => void;
}) {
```

with:

```tsx
export function RecipeInputRow({
  input,
  canEdit,
  onEdit,
  onRemove,
}: {
  input: RecipeInputView;
  canEdit: boolean;
  /** Open the in-place line editor for this row. */
  onEdit?: () => void;
  onRemove: (id: string) => void;
}) {
```

Replace:

```tsx
        {canEdit ? (
          <button
            type="button"
            onClick={() => setConfirming((v) => !v)}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta-text hover:border-co-cta-text"
          >
            {t(rk("recipes.row.remove"))}
          </button>
        ) : null}
```

with:

```tsx
        {canEdit ? (
          <div className="flex shrink-0 gap-2">
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                aria-label={t(rk("recipes.row.edit_aria"), { name: input.componentName })}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text"
              >
                {t(rk("recipes.row.edit"))}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setConfirming((v) => !v)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta-text hover:border-co-cta-text"
            >
              {t(rk("recipes.row.remove"))}
            </button>
          </div>
        ) : null}
```

- [ ] **Step 4: Imports and the draft-update lane in `RecipeBuilder.tsx`**

Replace `import { useState } from "react";` with `import { useMemo, useState } from "react";`.

Add after `import { useStepUpPost } from "@/components/admin/useStepUpPost";` (added in Task 5):

```tsx
import { buildIngredientOptions } from "@/lib/ingredient-picker-shared";
import { beginLineEdit, recipeLineKind, type LineEditStart, type RecipeLineDraft } from "@/lib/recipe-line-shared";
import { RecipeLineEditor } from "./RecipeLineEditor";
```

Replace:

```tsx
  const removeDraftInput = (key: number) =>
    setDraftInputs((prev) => prev.filter((x) => x._key !== key));
```

with:

```tsx
  const removeDraftInput = (key: number) =>
    setDraftInputs((prev) => prev.filter((x) => x._key !== key));
  /** Catalog Phase 1 (P2-7): a draft line is edited in place, keeping its key and position. */
  const updateDraftInput = (key: number, di: Omit<DraftInput, "_key">) =>
    setDraftInputs((prev) => prev.map((x) => (x._key === key ? { ...di, _key: key } : x)));
```

In the `<ConsumesSection … />` call, replace:

```tsx
        onRemoveDraftInput={removeDraftInput}
        onRemoveLive={(id) => void removeEdge("recipe_inputs", id)}
      />

      {/* ── PRODUCES ── */}
```

with:

```tsx
        onRemoveDraftInput={removeDraftInput}
        onUpdateDraftInput={updateDraftInput}
        onRemoveLive={(id) => void removeEdge("recipe_inputs", id)}
      />

      {/* ── PRODUCES ── */}
```

- [ ] **Step 5: Replace the CONSUMES section and DraftInputRow**

Save the block below to `$TEMP/consumes-section.txt`, then splice it over everything from the line starting `// ── CONSUMES section` up to (not including) the line starting `// ── PRODUCES section`:

```bash
cd /c/Users/conta/co-ops-guides
node -e '
const fs = require("fs");
const p = "components/admin/recipes/RecipeBuilder.tsx";
const s = fs.readFileSync(p, "utf8");
const a = s.indexOf("// ── CONSUMES section");
const b = s.indexOf("// ── PRODUCES section");
if (a < 0 || b < 0 || b < a) throw new Error("anchors not found");
fs.writeFileSync(p, s.slice(0, a) + fs.readFileSync(process.argv[1], "utf8") + s.slice(b));
' "$TEMP/consumes-section.txt"
```

The block (it ends with a blank line):

```tsx
// ── CONSUMES section ─────────────────────────────────────────────────────────
// ONE add/edit form for all three kinds (catalog redesign Phase 1, 2026-10-15): the searchable
// IngredientPicker replaced the per-kind forms and their unsearchable selects. A SAVED line is
// edited in place through PATCH …/inputs/[inputId] with the line the client saw (compare-and-set);
// a DRAFT line is edited in place locally — it is not on the server until the recipe saves.
// A live edit captures its starting line AND the compare-and-set snapshot ONCE, when Edit is
// tapped (beginLineEdit): a router.refresh() mid-edit must not quietly move "what I saw" (r2 #1).
type LineEditing = ({ kind: "live" } & LineEditStart) | { kind: "draft"; key: number } | null;

function ConsumesSection({
  recipeId,
  liveInputs,
  draftInputs,
  skus,
  items,
  products,
  measures,
  canEdit,
  isDraft,
  onAddDraftInput,
  onRemoveDraftInput,
  onUpdateDraftInput,
  onRemoveLive,
}: {
  recipeId: string | null;
  liveInputs: RecipeInputView[];
  draftInputs: DraftInput[];
  skus: RecipeBuilderSku[];
  items: Array<{ id: string; name: string }>;
  products: RecipeBuilderProduct[];
  measures: Map<string, MeasureUnitFactor>;
  /** Kept so the call site is unchanged; the line editor needs neither. */
  unitRegistryOptions: RegistryOption[];
  level: number;
  canEdit: boolean;
  isDraft: boolean;
  onAddDraftInput: (di: Omit<DraftInput, "_key">) => void;
  onRemoveDraftInput: (key: number) => void;
  onUpdateDraftInput: (key: number, di: Omit<DraftInput, "_key">) => void;
  onRemoveLive: (id: string) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LineEditing>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Disclosure (D3: PRIMARY work section → default-open; D10: locked open while a form is in
  // progress so the dirty line stays mounted).
  const [sectionOpen, setSectionOpen] = useState(true);
  const formInProgress = adding || editing !== null;
  const isOpen = sectionOpen || formInProgress;
  const live = editing?.kind === "live" ? editing : null;

  const options = useMemo(() => buildIngredientOptions({ skus, items, products }), [skus, items, products]);

  const lineBody = (line: RecipeLineDraft) => ({
    componentSkuId: line.componentSkuId,
    componentItemId: line.componentItemId,
    componentProductId: line.componentProductId,
    quantity: line.quantity,
    unit: line.unit,
    eachContainerLabel: line.eachContainerLabel,
    portioned: line.portioned,
  });
  const toDraftInput = (line: RecipeLineDraft): Omit<DraftInput, "_key"> =>
    ({ kind: recipeLineKind(line), ...lineBody(line), componentName: line.componentName });
  const draftLine = (di: DraftInput): RecipeLineDraft => ({
    componentSkuId: di.componentSkuId,
    componentItemId: di.componentItemId,
    componentProductId: di.componentProductId,
    quantity: di.quantity,
    unit: di.unit,
    eachContainerLabel: di.eachContainerLabel,
    portioned: di.portioned,
    componentName: di.componentName,
  });

  const closeForms = () => {
    setAdding(false);
    setEditing(null);
    setErrorMsg(null);
  };

  const submitAdd = async (line: RecipeLineDraft) => {
    if (busy) return;
    setErrorMsg(null);
    if (isDraft) {
      // A draft line is local until the whole recipe saves — that save asks for the window.
      onAddDraftInput(toDraftInput(line));
      closeForms();
      return;
    }
    if (!recipeId) return;
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const result = await send(`/api/admin/recipes/${recipeId}/inputs`, lineBody(line));
    setBusy(false);
    if (result.ok) { closeForms(); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const submitLiveEdit = async (start: LineEditStart, line: RecipeLineDraft) => {
    if (busy || !recipeId) return;
    setErrorMsg(null);
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const result = await send(
      `/api/admin/recipes/${recipeId}/inputs/${start.id}`,
      { line: lineBody(line), expected: start.expected },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) { closeForms(); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const submitDraftEdit = (key: number, line: RecipeLineDraft) => {
    onUpdateDraftInput(key, toDraftInput(line));
    closeForms();
  };

  return (
    <div className="mt-4">
    <CollapsibleSection
      idBase="recipe-consumes"
      title={t(rk("recipes.builder.consumes_title"))}
      count={t(rk("recipes.builder.consumes_count"), { n: liveInputs.length + draftInputs.length })}
      open={isOpen}
      onToggle={() => { if (!formInProgress) setSectionOpen((v) => !v); }}
    >
      <p className="mt-1 text-xs text-co-text-muted">{t(rk("recipes.builder.consumes_subtitle"))}</p>

      {/* Saved rows — each one edits in place */}
      {liveInputs.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {liveInputs.map((inp) =>
            live && live.id === inp.id ? (
              <RecipeLineEditor
                key={inp.id}
                title={t(rk("recipes.row.edit_title"))}
                submitLabel={t(rk("recipes.row.save_changes"))}
                options={options}
                skus={skus}
                products={products}
                measures={measures}
                initial={live.initial}
                busy={busy}
                errorMsg={errorMsg}
                onSubmit={(line) => void submitLiveEdit(live, line)}
                onCancel={closeForms}
              />
            ) : (
              <RecipeInputRow
                key={inp.id}
                input={inp}
                canEdit={canEdit && !formInProgress}
                onEdit={() => { setAdding(false); setErrorMsg(null); setEditing({ kind: "live", ...beginLineEdit(inp) }); }}
                onRemove={onRemoveLive}
              />
            ),
          )}
        </div>
      ) : null}

      {/* Draft rows — edit in place too (P2-7) */}
      {draftInputs.length > 0 ? (
        <div className={`${liveInputs.length > 0 ? "mt-2" : "mt-3"} flex flex-col gap-2`}>
          {draftInputs.map((di) =>
            editing?.kind === "draft" && editing.key === di._key ? (
              <RecipeLineEditor
                key={di._key}
                title={t(rk("recipes.row.edit_title"))}
                submitLabel={t(rk("recipes.row.save_changes"))}
                options={options}
                skus={skus}
                products={products}
                measures={measures}
                initial={draftLine(di)}
                busy={busy}
                errorMsg={errorMsg}
                onSubmit={(line) => submitDraftEdit(di._key, line)}
                onCancel={closeForms}
              />
            ) : (
              <DraftInputRow
                key={di._key}
                di={di}
                skus={skus}
                products={products}
                measures={measures}
                onEdit={formInProgress ? undefined : () => { setAdding(false); setErrorMsg(null); setEditing({ kind: "draft", key: di._key }); }}
                onRemove={() => onRemoveDraftInput(di._key)}
              />
            ),
          )}
        </div>
      ) : null}

      {liveInputs.length === 0 && draftInputs.length === 0 ? (
        <p className="mt-3 text-xs text-co-text-muted">{t(rk("recipes.builder.consumes_empty"))}</p>
      ) : null}

      {canEdit ? (
        <div className="mt-4">
          {adding ? (
            <RecipeLineEditor
              title={t(rk("recipes.builder.add_ingredient_title"))}
              submitLabel={t(rk("recipes.builder.save"))}
              options={options}
              skus={skus}
              products={products}
              measures={measures}
              initial={null}
              busy={busy}
              errorMsg={errorMsg}
              onSubmit={(line) => void submitAdd(line)}
              onCancel={closeForms}
            />
          ) : editing === null ? (
            <button
              type="button"
              onClick={() => { setErrorMsg(null); setAdding(true); }}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text"
            >
              {t(rk("recipes.builder.add_ingredient"))}
            </button>
          ) : null}
        </div>
      ) : null}
    </CollapsibleSection>
    </div>
  );
}

// ── DraftInputRow — a pending draft input with Edit and Remove ───────────────
function DraftInputRow({
  di,
  skus,
  products,
  measures,
  onEdit,
  onRemove,
}: {
  di: DraftInput;
  skus: RecipeBuilderSku[];
  products: RecipeBuilderProduct[];
  measures: Map<string, MeasureUnitFactor>;
  /** Open the in-place editor; absent while another line form is open. */
  onEdit?: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  const label = [
    di.quantity > 0 ? String(di.quantity) : null,
    di.unit ?? null,
    di.componentName,
  ].filter(Boolean).join(" ");

  // oz readout for draft SKU input
  let ozNote: string | null = null;
  if (di.kind === "sku" && di.componentSkuId && di.unit) {
    const sku = skus.find((s) => s.id === di.componentSkuId);
    if (sku) {
      const oz = ozForRecipeInput(di.quantity, di.unit, sku, measures);
      if (oz != null) ozNote = `≈ ${oz.toFixed(1)} oz`;
    }
  }
  // …and for a draft PRODUCT input, through the SAME measure-only basis the flatten
  // uses (productInputBasis), never through whichever member happens to be primary.
  if (di.kind === "product" && di.componentProductId && di.unit) {
    const p = products.find((x) => x.id === di.componentProductId);
    if (p) {
      const oz = ozForRecipeInput(di.quantity, di.unit, productInputBasis({ productId: p.id, unitOz: p.unitOz }, null), measures);
      if (oz != null) ozNote = `≈ ${oz.toFixed(1)} oz`;
    }
  }

  const metaParts: string[] = [];
  if (di.eachContainerLabel) metaParts.push(t(rk("recipes.input.container_label")) + ": " + di.eachContainerLabel);
  if (di.portioned) metaParts.push(t(rk("recipes.input.portioned_tag")));
  metaParts.push(
    di.kind === "product" ? t(rk("recipes.input.product_tag"))
      : di.kind === "sku" ? t(rk("recipes.input.sku_tag"))
        : t(rk("recipes.input.item_tag")),
  );
  if (ozNote) metaParts.push(ozNote);
  const meta = metaParts.join(" · ");

  return (
    <div className="rounded-lg border-2 border-co-gold-deep/50 bg-co-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-co-text">{label}</p>
          {meta ? <p className="text-xs text-co-text-muted">{meta}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              aria-label={t(rk("recipes.row.edit_aria"), { name: di.componentName })}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text"
            >
              {t(rk("recipes.row.edit"))}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setConfirming((v) => !v)}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta-text hover:border-co-cta-text"
          >
            {t(rk("recipes.row.remove"))}
          </button>
        </div>
      </div>
      {confirming ? (
        <div className="mt-3 rounded-lg border-2 border-co-cta-text bg-co-cta/10 p-3">
          <p className="text-sm font-bold text-co-text">{t(rk("recipes.row.confirm_remove"))}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text">
              {t(rk("recipes.row.cancel"))}
            </button>
            <button type="button" onClick={() => { setConfirming(false); onRemove(); }}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-cta px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text">
              {t(rk("recipes.row.remove"))}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

```

- [ ] **Step 6: Run the tests and tsc**

Run: `npx vitest run tests/recipe-line-edit-ui.test.ts tests/step-up-tier-map.test.ts tests/ingredient-picker-ui.test.ts`
Expected: PASS, 0 failed. RecipeBuilder still maps to `["E"]` and `["recipe.delete"]`.

Run: `npx tsc --noEmit 2>&1 | grep -v TS2307 | grep "error TS"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add components/admin/recipes/RecipeBuilder.tsx components/admin/recipes/RecipeInputRow.tsx tests/recipe-line-edit-ui.test.ts
git commit -F - <<'EOF'
feat(recipes): saved and draft recipe lines edit in place; add ingredients with the picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 13: Deep-link builders that land on the item

**Files:**
- Modify: `lib/admin/product-item-links-shared.ts`, `tests/product-item-links.test.ts`
- Test: `tests/catalog-deep-links.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/catalog-deep-links.test.ts`:

```ts
/** Catalog Phase 1 — deep links land on the exact item, never a whole list. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { prepItemHref, productHref, readFocusParam, skuCatalogHref } from "@/lib/admin/product-item-links-shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");

describe("the href builders", () => {
  it("a SKU link opens the row (?sku=) AND scrolls to it (#id)", () => {
    expect(skuCatalogHref("7d0c1f2e-0000-4000-8000-000000000001"))
      .toBe("/admin/skus?sku=7d0c1f2e-0000-4000-8000-000000000001#7d0c1f2e-0000-4000-8000-000000000001");
  });

  it("product and prep-item links keep the shapes their pages already read", () => {
    expect(productHref("ham")).toBe("/admin/products?product=ham#ham");
    expect(prepItemHref("slaw")).toBe("/admin/items?view=registry#slaw");
  });

  it("ids are URL-encoded", () => {
    expect(skuCatalogHref("a b")).toBe("/admin/skus?sku=a%20b#a%20b");
  });
});

describe("readFocusParam — a deep-link param as one plain id, or nothing", () => {
  it("accepts a uuid and a plain slug, trimmed", () => {
    expect(readFocusParam(" 7d0c1f2e-0000-4000-8000-000000000001 ")).toBe("7d0c1f2e-0000-4000-8000-000000000001");
    expect(readFocusParam("bacon_2")).toBe("bacon_2");
  });

  it("ignores arrays, absences, blanks and anything that is not a plain id", () => {
    expect(readFocusParam(undefined)).toBeNull();
    expect(readFocusParam(["a", "b"])).toBeNull();
    expect(readFocusParam("")).toBeNull();
    expect(readFocusParam("x\"><script>")).toBeNull();
    expect(readFocusParam("a".repeat(65))).toBeNull();
  });
});
```

(`read` is used by the source pins that Tasks 14 and 15 append to this file.)

In `tests/product-item-links.test.ts`, replace:

```ts
    expect(registryLinkHref(bacon)).toBe("/admin/skus#bacon");
```

with:

```ts
    expect(registryLinkHref(bacon)).toBe("/admin/skus?sku=bacon#bacon");
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/catalog-deep-links.test.ts tests/product-item-links.test.ts`
Expected: FAIL. `skuCatalogHref is not a function`, and `/admin/skus#bacon` does not equal `/admin/skus?sku=bacon#bacon`.

- [ ] **Step 3: The builders in `lib/admin/product-item-links-shared.ts`**

Replace:

```ts
export function registryLinkHref(link: RegistryLink): string {
  const id = encodeURIComponent(link.id);
  if (link.kind === "item") return `/admin/items?view=registry#${id}`;
  if (link.kind === "product") return `/admin/products?product=${id}#${id}`;
  return `/admin/skus#${id}`;
}
```

with:

```ts
/**
 * Deep links that land ON the item, never on a whole list (catalog redesign Phase 1,
 * 2026-10-15). The query param is read to open/expand the row; the hash scrolls to its anchor
 * (every row carries id={its id} + scroll-mt-24). One builder per destination.
 */
export function skuCatalogHref(skuId: string): string {
  const id = encodeURIComponent(skuId);
  return `/admin/skus?sku=${id}#${id}`;
}
export function productHref(productId: string): string {
  const id = encodeURIComponent(productId);
  return `/admin/products?product=${id}#${id}`;
}
export function prepItemHref(itemId: string): string {
  return `/admin/items?view=registry#${encodeURIComponent(itemId)}`;
}

/** A deep-link query param as ONE plain id (uuid or slug), else null. Arrays, blanks and anything else are ignored. */
export function readFocusParam(v: string | string[] | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(t) ? t : null;
}

export function registryLinkHref(link: RegistryLink): string {
  if (link.kind === "item") return prepItemHref(link.id);
  if (link.kind === "product") return productHref(link.id);
  return skuCatalogHref(link.id);
}
```

- [ ] **Step 4: Run them**

Run: `npx vitest run tests/catalog-deep-links.test.ts tests/product-item-links.test.ts tests/product-item-links-ui.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add lib/admin/product-item-links-shared.ts tests/catalog-deep-links.test.ts tests/product-item-links.test.ts
git commit -F - <<'EOF'
feat(catalog): deep-link builders that land on the exact SKU, product or prep item

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 14: `/admin/skus?sku=` opens, rings and scrolls — on first load AND client navigation

**Files:**
- Create: `lib/admin/sku-focus-shared.ts`
- Modify: `app/admin/skus/page.tsx`, `components/admin/skus/SkuCatalogClient.tsx`
- Modify: `tests/catalog-deep-links.test.ts`

- [ ] **Step 1: Write the failing test**

Add this import at the top of `tests/catalog-deep-links.test.ts`, after the existing imports:

```ts
import { SKU_FILTER_ALL, skuFocusPatch } from "@/lib/admin/sku-focus-shared";
```

Append:

```ts
describe("skuFocusPatch — how a param change patches the catalog's state (Astra r1 P2-6)", () => {
  const vendors = new Set(["v-baldor", "v-pfg"]);
  const none = { focusSkuId: null, vendorParam: null };

  it("first load with ?sku= expands that row and clears every filter that could hide it", () => {
    expect(skuFocusPatch(none, { focusSkuId: "A", vendorParam: null }, vendors))
      .toEqual({ expand: "A", vendorFilter: SKU_FILTER_ALL, resetOtherFilters: true });
  });

  it("sequential client navigation ?sku=A → ?sku=B patches again; the same params patch nothing", () => {
    const a = { focusSkuId: "A", vendorParam: null };
    expect(skuFocusPatch(a, { focusSkuId: "B", vendorParam: null }, vendors))
      .toEqual({ expand: "B", vendorFilter: SKU_FILTER_ALL, resetOtherFilters: true });
    expect(skuFocusPatch(a, a, vendors)).toBeNull();
  });

  it("a retained vendor filter that would hide the target clears itself", () => {
    expect(skuFocusPatch({ focusSkuId: null, vendorParam: "v-pfg" }, { focusSkuId: "B", vendorParam: "v-pfg" }, vendors))
      .toEqual({ expand: "B", vendorFilter: SKU_FILTER_ALL, resetOtherFilters: true });
  });

  it("?vendor= alone preselects a KNOWN vendor and ignores an unknown one", () => {
    expect(skuFocusPatch(none, { focusSkuId: null, vendorParam: "v-baldor" }, vendors))
      .toEqual({ expand: null, vendorFilter: "v-baldor", resetOtherFilters: false });
    expect(skuFocusPatch(none, { focusSkuId: null, vendorParam: "v-gone" }, vendors)).toBeNull();
  });
});

describe("the SKU catalog honours the deep link", () => {
  it("the page reads ?sku= and ?vendor= and only focuses a SKU it actually loaded", () => {
    const page = read("app/admin/skus/page.tsx");
    expect(page).toContain("readFocusParam(sp.sku)");
    expect(page).toContain("readFocusParam(sp.vendor)");
    expect(page).toContain("skus.some((s) => s.id === focusParam)");
    expect(page).toContain("focusSkuId={focusSkuId}");
    expect(page).toContain("initialVendorFilter={vendorParam}");
  });

  it("the client syncs params with the during-render prev-compare (never an effect), rings and scrolls", () => {
    const client = read("components/admin/skus/SkuCatalogClient.tsx");
    expect(client).toContain("if (seenParams.focusSkuId !== focusSkuId || seenParams.vendorParam !== initialVendorFilter)");
    expect(client).toContain("skuFocusPatch(seenParams,");
    expect(client).toContain("scrollIntoView");
    expect(client).toContain('s.id === focusSkuId ? " rounded-lg ring-4 ring-co-gold/60" : ""');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/catalog-deep-links.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/admin/sku-focus-shared"`.

- [ ] **Step 3: Create `lib/admin/sku-focus-shared.ts`**

```ts
/**
 * How a ?sku= / ?vendor= deep link patches the SKU catalog's client state (catalog Phase 1,
 * Astra r1 P2-6). Pure. The catalog component keeps filters and expansion in useState; a
 * client-side navigation ?sku=A → ?sku=B keeps it mounted, so initialisers alone would ignore
 * B. The component therefore re-applies this patch whenever the params change, using the
 * during-render prev-compare pattern (AGENTS.md), never an effect.
 *
 * A focused SKU wins over every filter: lens, query, errand filter and vendor reset, so a
 * retained filter can never hide the row the link names.
 */
export const SKU_FILTER_ALL = "__all__";

export interface SkuFocusParams {
  focusSkuId: string | null;
  vendorParam: string | null;
}

export interface SkuFocusPatch {
  /** Row to expand, or null. */
  expand: string | null;
  /** New vendor filter, or null = leave it. */
  vendorFilter: string | null;
  /** Reset lens, query and the errand filter. */
  resetOtherFilters: boolean;
}

export function skuFocusPatch(
  prev: SkuFocusParams,
  next: SkuFocusParams,
  vendorIds: ReadonlySet<string>,
): SkuFocusPatch | null {
  if (prev.focusSkuId === next.focusSkuId && prev.vendorParam === next.vendorParam) return null;
  if (next.focusSkuId) return { expand: next.focusSkuId, vendorFilter: SKU_FILTER_ALL, resetOtherFilters: true };
  if (next.vendorParam && vendorIds.has(next.vendorParam)) {
    return { expand: null, vendorFilter: next.vendorParam, resetOtherFilters: false };
  }
  return null;
}
```

- [ ] **Step 4: Read the params in `app/admin/skus/page.tsx`**

Add after `import type { SkuDataShop } from "@/lib/sku-data-readiness";`:

```tsx
import { readFocusParam } from "@/lib/admin/product-item-links-shared";
```

Replace:

```tsx
export default async function AdminSkusPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < 6) redirect("/dashboard");
  const lang = auth.user.language;
```

with:

```tsx
export default async function AdminSkusPage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string | string[]; vendor?: string | string[] }>;
}) {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < 6) redirect("/dashboard");
  const lang = auth.user.language;
  // Catalog Phase 1 deep links: ?sku=<id> lands ON the row; ?vendor=<id> preselects the filter.
  const sp = await searchParams;
  const focusParam = readFocusParam(sp.sku);
  const vendorParam = readFocusParam(sp.vendor);
```

Directly after the `const [skus, vendors, packFormats, measureUnits, locRes] = await Promise.all([ … ]);` statement, add:

```tsx
  const focusSkuId = focusParam && skus.some((s) => s.id === focusParam) ? focusParam : null;
```

In the `<SkuCatalogClient … />` props, replace:

```tsx
        canManage={level >= SKU_WRITE_MIN}
      />
```

with:

```tsx
        canManage={level >= SKU_WRITE_MIN}
        focusSkuId={focusSkuId}
        initialVendorFilter={vendorParam}
      />
```

- [ ] **Step 5: Focus and sync in `components/admin/skus/SkuCatalogClient.tsx`**

Replace `import { useMemo, useState } from "react";` with `import { useEffect, useMemo, useState } from "react";`.

Add after `import { SKU_CLASSES } from "@/lib/admin/catalog-shared";`:

```tsx
import { SKU_FILTER_ALL, skuFocusPatch } from "@/lib/admin/sku-focus-shared";
```

Replace `const FILTER_ALL = "__all__";` with `const FILTER_ALL = SKU_FILTER_ALL;`.

Replace:

```tsx
  actorLevel,
  canManage,
}: {
```

with:

```tsx
  actorLevel,
  canManage,
  focusSkuId = null,
  initialVendorFilter = null,
}: {
```

Replace:

```tsx
  canManage: boolean; // GM+
}) {
```

with:

```tsx
  canManage: boolean; // GM+
  /** ?sku=<id> deep link (catalog Phase 1): the row opens, scrolls into view and is ringed. */
  focusSkuId?: string | null;
  /** ?vendor=<id> deep link: preselect the vendor filter (a focused SKU wins). */
  initialVendorFilter?: string | null;
}) {
```

Replace:

```tsx
  const [vendorFilter, setVendorFilter] = useState<string>(FILTER_ALL);
```

with:

```tsx
  // The deep link's FIRST patch seeds the initial state; later param changes re-patch below.
  const [initialPatch] = useState(() =>
    skuFocusPatch({ focusSkuId: null, vendorParam: null }, { focusSkuId, vendorParam: initialVendorFilter }, new Set(vendors.map((v) => v.id))),
  );
  const [vendorFilter, setVendorFilter] = useState<string>(initialPatch?.vendorFilter ?? FILTER_ALL);
```

Replace:

```tsx
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
```

with:

```tsx
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialPatch?.expand ? [initialPatch.expand] : []));

  // P2-6: a client-side navigation ?sku=A → ?sku=B keeps this component mounted, so the params
  // are re-applied with the during-render prev-compare pattern (AGENTS.md), never an effect.
  const vendorIds = useMemo(() => new Set(vendors.map((v) => v.id)), [vendors]);
  const [seenParams, setSeenParams] = useState({ focusSkuId, vendorParam: initialVendorFilter });
  if (seenParams.focusSkuId !== focusSkuId || seenParams.vendorParam !== initialVendorFilter) {
    const patch = skuFocusPatch(seenParams, { focusSkuId, vendorParam: initialVendorFilter }, vendorIds);
    setSeenParams({ focusSkuId, vendorParam: initialVendorFilter });
    if (patch) {
      if (patch.vendorFilter !== null) setVendorFilter(patch.vendorFilter);
      if (patch.resetOtherFilters) {
        setLens("all");
        setQuery("");
        setNeedsErrand(false);
      }
      const target = patch.expand;
      if (target) setExpanded((prev) => new Set(prev).add(target));
    }
  }

  // The hash already scrolls on a full load; this covers a client-side navigation (A → B) too.
  useEffect(() => {
    if (!focusSkuId) return;
    document.getElementById(focusSkuId)?.scrollIntoView({ block: "start" });
  }, [focusSkuId]);
```

(`lens`, `query` and `needsErrand` are declared above `expanded` in this component, so their setters exist by this point.)

In `renderRow`, replace:

```tsx
        "scroll-mt-24 " + (s.active ? "" : "opacity-60")
```

with:

```tsx
        "scroll-mt-24 " + (s.active ? "" : "opacity-60") + (s.id === focusSkuId ? " rounded-lg ring-4 ring-co-gold/60" : "")
```

- [ ] **Step 6: Run the test and tsc**

Run: `npx vitest run tests/catalog-deep-links.test.ts`
Expected: PASS, 0 failed.

Run: `npx tsc --noEmit 2>&1 | grep -v TS2307 | grep "error TS"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add lib/admin/sku-focus-shared.ts app/admin/skus/page.tsx components/admin/skus/SkuCatalogClient.tsx tests/catalog-deep-links.test.ts
git commit -F - <<'EOF'
feat(skus): ?sku= opens, rings and scrolls on load and client navigation; ?vendor= preselects

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 15: Rewire the links that landed on lists

Inventory (verified on `main`), and what this task does with each:

| Link | Today | After |
|---|---|---|
| Items catalog → the item's SKUs (`CatalogClient.tsx:376`) | `/admin/skus` with the names joined | One link per SKU → `skuCatalogHref(id)` |
| Vendor import "needs a person" (`lib/vendor-import.ts:212`) | `/admin/skus` | `skuCatalogHref(match.sku_id)`. The no-match fallback stays the order guide. |
| Vendor import table, needs-person row (`VendorImportPanel.tsx:131`) | `/admin/skus?vendor=…` (never read) | The matched SKU's row; with no match, `?vendor=` (Task 14 honours it) |
| Registry relationships (items/products pages) | `/admin/skus#id` | `?sku=` + `#id` (Task 13) |
| Costing drawer: blocking SKUs, retired products, inconsistent/unweighed prep items | plain names | links to the fixing page |
| **Deferred:** ordering walk "check par" | — | Phase 2 item page "Ordering" section. The walk is a level-4+ surface with no actor level in props, and the par edit lives in the admin SKU editor. |
| **Deferred:** items catalog → catering packages | `/admin/catering/packages` | Package rows have no anchors (catering, out of scope). |
| Readiness errands | text on the item's own row/page | No link needed. |

**Files:**
- Modify: `lib/admin/catalog-shared.ts`, `lib/admin/catalog.ts`, `components/admin/catalog/CatalogClient.tsx`, `lib/vendor-import.ts`, `components/admin/vendors/VendorImportPanel.tsx`, `components/admin/menu-costing/MenuCostingClient.tsx`, `tests/catalog-deep-links.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/catalog-deep-links.test.ts`:

```ts
describe("no catalog deep link lands on a whole list any more", () => {
  it("the items catalog links each SKU to its own row", () => {
    const src = read("components/admin/catalog/CatalogClient.tsx");
    expect(src).not.toContain('href="/admin/skus"');
    expect(src).toContain("href={skuCatalogHref(r.id)}");
    expect(read("lib/admin/catalog-shared.ts")).toContain("skus: CatalogEdgeRef[];");
  });

  it("vendor import's needs-a-person links name the matched SKU", () => {
    expect(read("lib/vendor-import.ts")).toContain("href: o.match.sku_id ? skuCatalogHref(o.match.sku_id) :");
    expect(read("components/admin/vendors/VendorImportPanel.tsx")).toContain("o.match.sku_id ? skuCatalogHref(o.match.sku_id) :");
  });

  it("the costing drawer links every name it blames", () => {
    const src = read("components/admin/menu-costing/MenuCostingClient.tsx");
    expect(src).toContain("href={skuCatalogHref(id)}");
    expect(src).toContain("prepItemHref)");
    expect(src).toContain("productHref,");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/catalog-deep-links.test.ts`
Expected: FAIL. The 3 new tests fail.

- [ ] **Step 3: SKU edges carry ids**

`lib/admin/catalog-shared.ts`: replace

```ts
  /** items: leaf SKU names (display-capped). */
  skuNames: string[];
```

with

```ts
  /** items: leaf SKUs (display-capped) — each links to its own row in /admin/skus (catalog Phase 1). */
  skus: CatalogEdgeRef[];
```

`lib/admin/catalog.ts` (`CatalogEdgeRef` is already imported there): replace

```ts
    const skuNames = skuKeys.slice(0, SKU_NAME_CAP).map((k) => skuNameById.get(k) ?? "—");
```

with

```ts
    const skus: CatalogEdgeRef[] = skuKeys.slice(0, SKU_NAME_CAP).map((k) => ({ id: k, name: skuNameById.get(k) ?? "—" }));
```

and make the three replacements:
- `        producedBy, build: null, skuNames, componentItems: [],` → `        producedBy, build: null, skus, componentItems: [],`
- `        producedBy: [], build: buildRef, skuNames: [], componentItems,` → `        producedBy: [], build: buildRef, skus: [], componentItems,`
- `        producedBy: [], build: null, skuNames: [], componentItems: [],` → `        producedBy: [], build: null, skus: [], componentItems: [],`

`components/admin/catalog/CatalogClient.tsx`: add after `import { ITEM_TYPES, deriveRoleBadges } from "@/lib/admin/catalog-shared";`

```tsx
import { skuCatalogHref } from "@/lib/admin/product-item-links-shared";
```

and replace

```tsx
          {e.kind === "item" && (
            <EdgeList label={t("admin.catalog.edge.skus")}>
              {e.edges.skuNames.length > 0
                ? <Link href="/admin/skus" className={linkCls}>{e.edges.skuNames.join(", ")}</Link>
                : none}
            </EdgeList>
          )}
```

with

```tsx
          {e.kind === "item" && (
            <EdgeList label={t("admin.catalog.edge.skus")}>
              {e.edges.skus.length > 0
                ? e.edges.skus.map((r, i) => (
                    <Link key={r.id} href={skuCatalogHref(r.id)} className={linkCls}>
                      {r.name}{i < e.edges.skus.length - 1 ? "," : ""}
                    </Link>
                  ))
                : none}
            </EdgeList>
          )}
```

- [ ] **Step 4: Vendor import**

`lib/vendor-import.ts`: add after `import { buildPackChain, chainRootLabel, type PackChainLevel } from "@/lib/pack-chain-shared";`

```ts
import { skuCatalogHref } from "@/lib/admin/product-item-links-shared";
```

replace

```ts
      href: o.match.sku_id ? "/admin/skus" : `/admin/vendors/${vendorId}#order-guide-${vendorId}` });
```

with

```ts
      href: o.match.sku_id ? skuCatalogHref(o.match.sku_id) : `/admin/vendors/${vendorId}#order-guide-${vendorId}` });
```

`components/admin/vendors/VendorImportPanel.tsx`: add after `import { resolveErrorKey } from "./shared";`

```tsx
import { skuCatalogHref } from "@/lib/admin/product-item-links-shared";
```

and replace

```tsx
href={`/admin/skus?vendor=${encodeURIComponent(vendorId)}`}
```

with

```tsx
href={o.match.sku_id ? skuCatalogHref(o.match.sku_id) : `/admin/skus?vendor=${encodeURIComponent(vendorId)}`}
```

- [ ] **Step 5: Costing drawer (`components/admin/menu-costing/MenuCostingClient.tsx`)**

Add after `import { SummaryRow } from "@/components/ui/SummaryRow";`:

```tsx
import { prepItemHref, productHref, skuCatalogHref } from "@/lib/admin/product-item-links-shared";
```

Add directly above `/** Group render order — mirrors the sort ranking in menu-costing-shared. */`:

```tsx
/** A name the drawer blames is a link to the place that fixes it (catalog Phase 1). 44px tap floor. */
const drawerLinkCls = "inline-flex min-h-[44px] items-center underline decoration-2 underline-offset-2 hover:text-co-gold-text";
```

Replace

```tsx
  const nameList = (
    ids: string[],
    labelKey: TranslationKey,
    names: Record<string, { en: string; es: string | null }>,
    unknownKey: TranslationKey,
  ) => (
```

with

```tsx
  const nameList = (
    ids: string[],
    labelKey: TranslationKey,
    names: Record<string, { en: string; es: string | null }>,
    unknownKey: TranslationKey,
    hrefFor: (id: string) => string,
  ) => (
```

and inside it replace

```tsx
            <li key={id} className="text-xs font-medium text-co-text">
              {(language === "es" ? name?.es ?? name?.en : name?.en) ?? t(unknownKey)}
            </li>
```

with

```tsx
            <li key={id} className="text-xs font-medium text-co-text">
              <a href={hrefFor(id)} className={drawerLinkCls}>
                {(language === "es" ? name?.es ?? name?.en : name?.en) ?? t(unknownKey)}
              </a>
            </li>
```

Replace `    nameList(ids, labelKey, itemNames, "admin.menu_costing.drawer.unknown_item");` with `    nameList(ids, labelKey, itemNames, "admin.menu_costing.drawer.unknown_item", prepItemHref);`.

Replace

```tsx
            "admin.menu_costing.drawer.unknown_product",
          )}
```

with

```tsx
            "admin.menu_costing.drawer.unknown_product",
            productHref,
          )}
```

Replace

```tsx
              <li key={id} className="text-xs font-medium text-co-text">
                {skuNames[id] ?? t("admin.menu_costing.drawer.unknown_sku")}
              </li>
```

with

```tsx
              <li key={id} className="text-xs font-medium text-co-text">
                <a href={skuCatalogHref(id)} className={drawerLinkCls}>
                  {skuNames[id] ?? t("admin.menu_costing.drawer.unknown_sku")}
                </a>
              </li>
```

- [ ] **Step 6: Run the tests and tsc**

Run: `npx vitest run tests/catalog-deep-links.test.ts tests/menu-prices-ui.test.ts tests/vendor-import-routes.test.ts tests/catalog-issues.test.ts`
Expected: PASS, 0 failed.

Run: `npx tsc --noEmit 2>&1 | grep -v TS2307 | grep "error TS"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add lib/admin/catalog-shared.ts lib/admin/catalog.ts components/admin/catalog/CatalogClient.tsx lib/vendor-import.ts components/admin/vendors/VendorImportPanel.tsx components/admin/menu-costing/MenuCostingClient.tsx tests/catalog-deep-links.test.ts
git commit -F - <<'EOF'
feat(catalog): catalog, vendor-import and costing links land on the exact item

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 16: The avg-weight dead end on chained SKUs

**Files:**
- Modify: `lib/admin/catalog-shared.ts` (`chainNeedsAvgOzPerEach`), `components/admin/skus/SkuBuilder.tsx`, `tests/sku-builder-shared.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/sku-builder-shared.test.ts`, add `chainNeedsAvgOzPerEach,` to the `@/lib/admin/catalog-shared` import list after `defaultWizardLevelLabel,`. Append:

```ts
// ── chainNeedsAvgOzPerEach (catalog Phase 1 — the avg-weight dead end) ─────────
describe("chainNeedsAvgOzPerEach — exactly when the server would say leaf_needs_avg", () => {
  const dims = new Map<string, string>([["lb", "weight"], ["oz", "weight"], ["each", "count"], ["gal", "volume"]]);
  const lvl = (containsMeasureUnit: string | null) => ({ containsMeasureUnit });

  it("a raw chain ending in a count or volume unit needs it", () => {
    expect(chainNeedsAvgOzPerEach([lvl(null), lvl("each")], dims, "raw")).toBe(true);
    expect(chainNeedsAvgOzPerEach([lvl(null), lvl("gal")], dims, "raw")).toBe(true);
  });

  it("a raw chain ending in weight does not", () => {
    expect(chainNeedsAvgOzPerEach([lvl(null), lvl("lb")], dims, "raw")).toBe(false);
  });

  it("non-raw classes never need it (the server only checks structure for them)", () => {
    expect(chainNeedsAvgOzPerEach([lvl(null), lvl("each")], dims, "packaging")).toBe(false);
    expect(chainNeedsAvgOzPerEach([lvl("each")], dims, "cleaning")).toBe(false);
  });

  it("an unregistered unit is not this errand (the server says unknown_measure instead)", () => {
    expect(chainNeedsAvgOzPerEach([lvl("bushel")], dims, "raw")).toBe(false);
    expect(chainNeedsAvgOzPerEach([], dims, "raw")).toBe(false);
  });
});

describe("SkuBuilder offers the avg field where leaf_needs_avg can occur (source pin)", () => {
  it("the chained edit branch renders it and the chain save sends it", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../components/admin/skus/SkuBuilder.tsx", import.meta.url), "utf8");
    const chained = src.slice(src.indexOf("CHAINED SKU → inline chain builder"), src.indexOf("// UNCHAINED (add flow"));
    expect(chained).toContain("chainNeedsAvg ? (");
    expect(chained).toContain('t("admin.skus.field.avg_oz_per_each")');
    const save = src.slice(src.indexOf("const saveChain = async"), src.indexOf("// ── Wizard save"));
    expect(save).toContain("onSaveChain(payload, needsAvg ? avg : undefined)");
    expect(save).toContain('t("admin.skus.error.leaf_needs_avg")');
    expect(save).toContain('t("admin.skus.error.invalid_avg_oz_per_each")');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/sku-builder-shared.test.ts`
Expected: FAIL. `chainNeedsAvgOzPerEach is not a function`, and the source pin fails.

- [ ] **Step 3: Add `chainNeedsAvgOzPerEach` to `lib/admin/catalog-shared.ts`** (directly after the `StarterChainLevel` interface)

```ts
/**
 * Does this chain need the SKU's avg oz per each? (catalog Phase 1 — the avg-weight dead
 * end.) True exactly when the server's class-aware leaf law (lib/admin/pack-chain.ts) would
 * throw `leaf_needs_avg` for a missing avg: a RAW SKU whose chain ends in a REGISTERED measure
 * that is not a weight (count or volume). Non-raw classes are checked for structure only, and
 * an unregistered unit is the server's `unknown_measure` — a different errand.
 */
export function chainNeedsAvgOzPerEach(
  levels: ReadonlyArray<{ containsMeasureUnit: string | null }>,
  dimensionByLabel: ReadonlyMap<string, string>,
  skuClass: SkuClass,
): boolean {
  if (skuClass !== "raw") return false;
  return levels.some((l) => {
    const unit = l.containsMeasureUnit?.trim();
    if (!unit) return false;
    const dimension = dimensionByLabel.get(unit);
    return dimension !== undefined && dimension !== "weight";
  });
}
```

- [ ] **Step 4: Wire it into `components/admin/skus/SkuBuilder.tsx`**

Replace `import { SKU_CLASSES } from "@/lib/admin/catalog-shared";` with:

```tsx
import { SKU_CLASSES, chainNeedsAvgOzPerEach } from "@/lib/admin/catalog-shared";
```

In the `onSaveChain` prop doc, replace:

```tsx
   *  oz-resolvable at validation time (undefined → the chain editor's path,
   *  which never changes the avg). */
```

with:

```tsx
   *  oz-resolvable at validation time. The chain editor passes it too when its
   *  chain ends in a count/volume unit on a raw SKU (catalog Phase 1); otherwise
   *  undefined → the avg is left alone). */
```

Directly after the `displayChain` `useMemo` (the statement ending `[initialChain, chainSavedTick],\n  );`), add:

```tsx
  // The avg-weight dead end (catalog Phase 1, 2026-10-15): a chained RAW SKU whose chain ends
  // in a count/volume unit needs avg_oz_per_each, and the field used to live only inside the
  // wizard, which never renders for a chained SKU, so leaf_needs_avg had no fix on the edit
  // path. The field now renders wherever that error can occur, bound to the SAME avgOzPerEach
  // state the identity Save already sends, with the server's rule (a positive number).
  const dimensionByLabel = useMemo(
    () => new Map(measureUnits.map((m) => [m.label, m.dimension] as const)),
    [measureUnits],
  );
  const chainNeedsAvg =
    isEdit && hasChain &&
    chainNeedsAvgOzPerEach(chainOpen ? editorRowsToPayload(chainRows) : displayChain, dimensionByLabel, skuClass);
```

Replace:

```tsx
  const saveChain = async () => {
    if (chainBusy || !onSaveChain) return;
    setChainErr(null);
    const payload = editorRowsToPayload(chainRows);
    setChainBusy(true);
    const ok = await onSaveChain(payload);
```

with:

```tsx
  const saveChain = async () => {
    if (chainBusy || !onSaveChain) return;
    setChainErr(null);
    const payload = editorRowsToPayload(chainRows);
    const needsAvg = chainNeedsAvgOzPerEach(payload, dimensionByLabel, skuClass);
    const avg = parseNum(avgOzPerEach);
    if (needsAvg && avg === null) { setChainErr(t("admin.skus.error.leaf_needs_avg")); return; }
    if (needsAvg && avg !== null && !(Number.isFinite(avg) && avg > 0)) {
      setChainErr(t("admin.skus.error.invalid_avg_oz_per_each"));
      return;
    }
    setChainBusy(true);
    // With an avg, the parent PATCHes it onto the SKU BEFORE the chain save (one step-up).
    const ok = await onSaveChain(payload, needsAvg ? avg : undefined);
```

In the chained branch, replace:

```tsx
                onCancel={() => { setChainOpen(false); setChainErr(null); }}
              />
            )}
          </div>
        ) : (
          // UNCHAINED (add flow, or an unchained edit) → the class-aware WIZARD.
```

with:

```tsx
                onCancel={() => { setChainOpen(false); setChainErr(null); }}
              />
            )}
            {chainNeedsAvg ? (
              // The same field PackChainWizard shows for a count/volume leaf. While the chain
              // editor is open it rides the chain save; otherwise the identity Save sends it.
              <label className="block">
                <span className="text-[11px] font-bold text-co-text-muted">{t("admin.skus.field.avg_oz_per_each")}</span>
                <input
                  className={fieldCls}
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={avgOzPerEach}
                  disabled={busy || chainBusy}
                  onChange={(e) => setAvgOzPerEach(e.target.value)}
                />
                <span className="mt-1 block text-[11px] text-co-text-muted">{t("admin.skus.avg_oz_per_each_hint")}</span>
              </label>
            ) : null}
          </div>
        ) : (
          // UNCHAINED (add flow, or an unchained edit) → the class-aware WIZARD.
```

- [ ] **Step 5: Run the tests and tsc**

Run: `npx vitest run tests/sku-builder-shared.test.ts tests/pack-chain.test.ts`
Expected: PASS, 0 failed.

Run: `npx tsc --noEmit 2>&1 | grep -v TS2307 | grep "error TS"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add lib/admin/catalog-shared.ts components/admin/skus/SkuBuilder.tsx tests/sku-builder-shared.test.ts
git commit -F - <<'EOF'
fix(skus): avg oz per each can be set on a chained SKU — no more leaf_needs_avg dead end

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 17: Delete the dead `SkuPackChainPanel`

**Files:**
- Delete: `components/admin/skus/SkuPackChainPanel.tsx`
- Modify: `tests/step-up-tier-map.test.ts`
- Test: `tests/dead-code-removed.test.ts`

- [ ] **Step 1: Confirm nothing imports it**

Run: `grep -rnE "from ['\"](\./|@/components/admin/skus/)SkuPackChainPanel['\"]" app components lib tests scripts`
Expected: no output. Only comments mention the name.

- [ ] **Step 2: Write the failing test**

Create `tests/dead-code-removed.test.ts`:

```ts
/** Catalog Phase 1 — SkuPackChainPanel was dead (SkuBuilder replaced it, 2026-07-27) and is gone. */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("dead code stays dead", () => {
  it("components/admin/skus/SkuPackChainPanel.tsx no longer exists", () => {
    expect(existsSync(join(ROOT, "components", "admin", "skus", "SkuPackChainPanel.tsx"))).toBe(false);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run tests/dead-code-removed.test.ts`
Expected: FAIL with `expected true to be false`.

- [ ] **Step 4: Delete the file and its tier-map entry**

```bash
cd /c/Users/conta/co-ops-guides && git rm components/admin/skus/SkuPackChainPanel.tsx
```

In `tests/step-up-tier-map.test.ts` `CLIENT_TIER_MAP`, delete the line `  "components/admin/skus/SkuPackChainPanel.tsx": ["A"],`.

- [ ] **Step 5: Run the tests and tsc**

Run: `npx vitest run tests/dead-code-removed.test.ts tests/step-up-tier-map.test.ts`
Expected: PASS, 0 failed.

Run: `npx tsc --noEmit 2>&1 | grep -v TS2307 | grep "error TS"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add tests/dead-code-removed.test.ts tests/step-up-tier-map.test.ts
git commit -F - <<'EOF'
chore(skus): delete the dead SkuPackChainPanel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 18: Manager guide — one password per 15 minutes, edit a line, the ingredient search (en + es)

Photos are deferred. These steps carry "(not shown)" per the voice sheet, and all screens changed in Phases 1–5 get one retake pass after Phase 5 (spec §7 as amended in Task 19).

**Files:**
- Modify: `docs/guides/manager-guide.md`
- Test (existing): `tests/guides-reading-level.test.ts`, `tests/guides-v2-shape.test.ts`, `tests/guides-markdown.test.ts`

- [ ] **Step 1: Run the guide tests first (the baseline)**

Run: `npx vitest run tests/guides-reading-level.test.ts tests/guides-v2-shape.test.ts tests/guides-markdown.test.ts`
Expected: PASS. Record the result: the new text must keep it green.

- [ ] **Step 2: Add the English section**

In `docs/guides/manager-guide.md`, insert this block directly **before** the line `### En español` that follows the `### The admin pages` section (the `## Manager tools` Spanish block):

```markdown
### Recipes and the catalog

GMs and up change recipes and SKUs.

#### 1. One password for 15 minutes (not shown)

**What to do** — The first time you save a change on an admin page, the app asks **Confirm your password**. Type it once. Then keep working.

**Worth knowing**

- After your password, editing stays unlocked for 15 minutes on this phone or computer. Saves in that time do not ask again.
- The 15 minutes count from your password. Saving does not add time. When they run out, the app asks again.
- Logging out ends it right away.
- Three things ask every time: retire a product, delete a recipe, and deactivate a SKU.
- If the app says your confirmation expired, tap save again and type your password.

#### 2. Change a recipe line (not shown)

**What to do** — Open the recipe. In **Consumes (inputs)**, tap **Edit** on the line. Change the amount, the unit or the ingredient. Tap **Save changes**.

**Worth knowing**

- **Save changes** stays gray until you change something.
- Lines on a new recipe you have not saved yet have **Edit** too.
- If someone else changed the same line first, the app tells you. Reload the page, then try again.
- A product line takes a measure unit only, like oz, lb or each. A vendor's pack name means a different thing at each vendor.

#### 3. Find an ingredient (not shown)

**What to do** — Tap **+ Add ingredient**. Type part of the name, or the vendor's name. Tap the one you want.

**Worth knowing**

- Each row shows the name, the vendor and the kind: SKU, prep item or product.
- On a computer, use the arrow keys and Enter.
```

- [ ] **Step 3: Add the Spanish section**

Append to the end of `docs/guides/manager-guide.md` (the file ends with the `#### Las páginas de Admin` paragraph of the same `### En español` block), after a blank line:

```markdown
#### Recetas y el catálogo

Los gerentes generales y roles más altos cambian recetas y SKUs.

1. **Una contraseña por 15 minutos.** La primera vez que guardas un cambio en una página de Admin, la app pide **Confirma tu contraseña**. Después, editar queda desbloqueado por 15 minutos en este teléfono o computadora; en ese tiempo no la vuelve a pedir. Los 15 minutos cuentan desde tu contraseña: guardar no suma tiempo. Cuando se acaban, la app la pide otra vez. Salir de la app los termina. Tres cosas la piden siempre: retirar un producto, borrar una receta y desactivar un SKU. Si la app dice que tu confirmación venció, toca guardar otra vez y escribe tu contraseña.
2. **Cambia una línea de la receta.** Abre la receta. En **Consume (entradas)**, toca **Editar** en la línea. Cambia la cantidad, la unidad o el ingrediente y toca **Guardar cambios**. El botón sigue gris hasta que cambias algo. Las líneas de una receta nueva que aún no guardas también tienen **Editar**. Si alguien más cambió esa línea antes, la app te avisa: recarga la página y vuelve a intentarlo. Una línea de producto solo acepta una unidad de medida, como oz, lb o each.
3. **Busca un ingrediente.** Toca **+ Agregar ingrediente**. Escribe parte del nombre o el nombre del proveedor y toca el que quieres. Cada fila muestra el nombre, el proveedor y el tipo: SKU, preparación o producto.
```

- [ ] **Step 4: Run the guide tests**

Run: `npx vitest run tests/guides-reading-level.test.ts tests/guides-v2-shape.test.ts tests/guides-markdown.test.ts`
Expected: PASS, 0 failed. If "Manager tools" is reported above grade 6, shorten the named longest sentences. Never delete facts to pass.

- [ ] **Step 5: Commit** (docs-only, but it ships in the same PR as the code it describes)

```bash
git add docs/guides/manager-guide.md
git commit -F - <<'EOF'
docs(guides): manager guide — 15-minute edit password, edit a recipe line, ingredient search (en + es)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 19: Spec amendments — photos in one pass after Phase 5; the product-line unit rule

Two one-line amendments so the spec and this plan agree:
- Spec §7 says every phase ships "guide text + photo updates", but the plan defers photos (Task 18; Astra r2 #5).
- Spec §1 "Keep" says product lines are measured "only in oz / each", but AGENTS.md and the code say any ACTIVE measure-registry unit (Astra r3 #3).

This is a docs-only change and needs no unit test; the checks are the greps below.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-catalog-redesign-design.md` (§1 "Keep" line; §7 "Each phase:" line)

- [ ] **Step 1: Confirm the current wording**

Run: `grep -n "then guide text + photo updates for the changed screens." docs/superpowers/specs/2026-10-15-catalog-redesign-design.md`
Expected: one line (`101:Each phase: …`).

Run: `grep -n "product lines measured only in oz / each;" docs/superpowers/specs/2026-10-15-catalog-redesign-design.md`
Expected: one line (`22:Append-only price history; …`).

- [ ] **Step 2: Amend it**

Replace `then guide text + photo updates for the changed screens.` with:

```markdown
then guide TEXT updates for the changed screens every phase; photo retakes happen in ONE pass after Phase 5, because the screens change every phase (amended 2026-10-15, Phase 1 plan review).
```

In §1 "Keep", replace `product lines measured only in oz / each;` with:

```markdown
product lines measured only in an ACTIVE measure-registry unit of any dimension — weight, volume or count, never a vendor's pack label (AGENTS.md "measure-registry unit"; amended 2026-10-15);
```

- [ ] **Step 3: Check them**

Run: `grep -c "photo retakes happen in ONE pass after Phase 5" docs/superpowers/specs/2026-10-15-catalog-redesign-design.md`
Expected: `1`

Run: `grep -c "only in oz / each" docs/superpowers/specs/2026-10-15-catalog-redesign-design.md`
Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-15-catalog-redesign-design.md
git commit -F - <<'EOF'
docs(spec): catalog redesign — photo retakes once after Phase 5; product lines in any measure-registry unit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 20: Full verification, the sim walk, and the PR

- [ ] **Step 1: Run the whole unit spine**

Run: `npx vitest run`
Expected: every file passes, 0 failed. The count is the previous total plus the 12 new test files.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exactly the 6 known pre-existing `TS2307` errors (Leaflet module typings) and nothing else.

- [ ] **Step 3: Production build**

Run: `npx next build`
Expected: `✓ Compiled successfully`, and the route table lists `/api/admin/recipes/[id]/inputs/[inputId]`.

- [ ] **Step 4: Apply 0257 to the SIM** (MCP, sim project only; never prod from here)

Run the PRE-FLIGHT queries from the migration header, apply the migration, then run the VERIFY queries. Expected values are in the header. Do not stamp the file yet; the stamp lands with the prod apply.

- [ ] **Step 5: Manual sim checklist** (http://localhost:3100, `node scripts/sim/dev-sim.mjs`; never prod)

Sign in as **Marcus Webb (GM)** from `scripts/sim/personas.md`. Use a 390 px window for items 3, 5 and 8, then repeat 3 at desktop width.

1. **One unlock, 15 minutes, from any admin modal.** On `/admin/items` change an item's type (its own password modal), then open a recipe and change the batch yield: **no second prompt**. Separately, starting from a recipe: change the batch yield and the password prompt appears **once**. Change the name, add a line, edit a line, remove a line, open `/admin/skus`, edit a SKU, record a price, change a shop par in the overlay, and edit a product's unit weight: **no further prompts**. In sim SQL, `select metadata from audit_log where action = 'auth_step_up_success' order by occurred_at desc limit 1` → `{"edit_window_seconds": 900, "grant": null}`.
2. **Destructive acts ask every time.** Inside the window: **Delete recipe** (as a level-8+ sim account), **Retire** a product and **Deactivate** a SKU each prompt for the password **every time**, including twice in a row. Each latest `auth_step_up_success` row carries `grant` with that action and target, and `select action, consumed_at from step_up_grants order by created_at desc limit 3` shows them consumed. Reactivating the SKU and restoring the product do **not** prompt inside the window.
3. **Searchable picker.** Tap "+ Add ingredient" and type `ham`. Rows read `name · vendor · kind`, each at least 44 px, with no sideways scroll at 390 px. Arrow down past the visible rows: the active row stays in view. Enter chooses (desktop); a tap chooses (phone). A vendor's name filters to its SKUs, and an accent-free spelling matches an accented name.
4. **Edit in place, both kinds.** On a saved line tap **Edit**. Save stays disabled until something changes. Change qty → Save: the row updates in place. Swap to a product: registry units only. Swap to a prep item: free-text unit and no Portioned. In `/admin/recipes/new`, add two lines, tap **Edit** on one, change it: it updates in place, keeps its position, and no password is asked until **Save**.
5. **Concurrent edit, including a refresh mid-edit.** Open the same recipe in two tabs. In tab 2 tap **Edit** on a line. In tab 1 swap that line's ingredient and save, then let tab 2 refresh (save any other line there). Save tab 2's edit: "Someone else changed this line first…", and the tab-1 value stays in the DB. In `audit_log`, the `recipe_input.update` row has `before` = the value tab 1 saw, `after` = what it wrote, and `destructive = true`.
6. **A fixed 15-minute window.** Unlock by saving a recipe edit and note the time. Then open `/dashboard`, save a count on `/operations/counts`, switch language in the user menu and back, and return to the recipe: editing does **not** ask again. Keep saving every few minutes: the prompt still comes back 15 minutes after the **password**, not after the last save. In sim SQL, push `catalog_edit_unlocked_at` back 16 minutes and edit: "Your confirmation expired…". Tap Save again: the prompt appears and the save lands. Log out and back in: the next edit asks.
7. **The server is the authority (curl).** With the browser's cookie and a fresh window, run `curl -X POST …/api/admin/products/<id>/active -d '{"active":false}'`: **403 `step_up_grant_required`**.
8. **Deep links.** From `/admin/items`, tap one of an item's SKUs: `/admin/skus` opens with the row expanded, ringed and in view. Without reloading, open another SKU's link from the costing drawer: the new row opens, rings and scrolls, even if a vendor filter or search was set before. A vendor import's "needs a person" SKUs link opens the matched row. `/admin/skus?vendor=<id>` preselects the vendor.
9. **Avg-weight dead end.** On a raw SKU whose chain ends in `each` with no avg, tap Edit: "Avg oz per each" shows under the chain. Saving the chain empty, then with `0`, gives the two errors; with `4` it saves and the "Unverified" badge clears after refresh.
10. **Spanish.** Switch Marcus to `es` and repeat items 3 and 4 briefly. Every new string is tú Spanish. `/training` shows the new "Recetas y el catálogo" block.

- [ ] **Step 6: Push and open the PR — stop at CI green**

```bash
cd /c/Users/conta/co-ops-guides && git push -u origin feat/catalog-phase1-quick-fixes
gh pr create --title "Catalog redesign Phase 1: edit window, one-shot grants, recipe line edit, searchable picker, deep links, avg-weight fix" --body-file - <<'EOF'
Phase 1 of docs/superpowers/specs/2026-10-15-catalog-redesign-design.md (plan: docs/superpowers/plans/2026-10-15-catalog-phase1-quick-fixes.md, revised after Astra r1 and r2). Includes the spec amendments (§7 photos once after Phase 5; §1 product-line unit rule).

- Migration 0257 (authored, NOT applied — apply sim → prod BEFORE merge): sessions.catalog_edit_unlocked_at + step_up_grants.
- Tier E: one admin password unlocks every ordinary catalog/recipe edit for a FIXED 15 minutes, on its own clock (never extended, never cleared by navigation; ends at expiry or with the session), checked server-side on every write. Former Tier A catalog edits moved in.
- Retire product / delete recipe / deactivate SKU: one-shot, action-bound grants (replay, wrong target, expiry refused).
- Recipe lines editable in place — saved (compare-and-set PATCH, 409 line_changed) and draft; same validator as add, now with the item cycle guard on both; recipe_input.update destructive.
- Searchable ingredient picker (name · vendor · kind; keyboard + touch; 44px; active row scrolls into view).
- Deep links land on the exact SKU/product/prep item, on load and client navigation; ?vendor= works.
- Avg oz per each settable on chained SKUs. SkuPackChainPanel deleted. Manager guide (en + es) updated; photos in the post-Phase-5 retake pass.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

Expected: the PR opens and the `build` check goes green. **Do not merge.** Astra reviews to APPROVE, then Juan approves the prod apply of 0257. Stamp the migration header (`-- APPLIED TO PROD …`) in this PR right after the apply, and only then merge.

---

## Self-review against the spec's Phase 1 list (and Astra r1)

| Requirement | Covered by | Notes |
|---|---|---|
| 15-minute edit unlock, server-authoritative | Tasks 1–5 | Own FIXED clock (`catalog_edit_unlocked_at`), stamped only by an admin password, never extended or cleared by navigation, ended by expiry or the session; checked by `assertStepUp(…, "E")` on every catalog write. Every former Tier A catalog edit moved in. Unlock audited with `edit_window_seconds`. |
| Destructive acts ask every time | Tasks 2, 3, 5 | Retire product, delete recipe, deactivate SKU: one-shot, action-bound, session-bound, 120 s grants, consumed atomically. Tests cover a fresh window/shared unlock refused, X/T vs Y or T′ refused, replay refused, expiry refused and other session refused. |
| Recipe lines editable in place (qty, unit, swap), same validations as add, audit trail | Tasks 6–8, 12 | Saved lines use a compare-and-set PATCH whose `expected` is captured when editing begins (`409 line_changed`, also after a mid-edit refresh; audit before = matched, after = returned). Draft lines edit in place locally. One validator (product line → active measure-registry unit of any dimension, per AGENTS.md; the spec's "oz / each" is shorthand) plus the item cycle guard, through add and update, over a predicate-aware fake. |
| Searchable ingredient picker over SKUs, items and products; keyboard + touch; 44px; phone width | Tasks 9–12 | Pure search and clamp tested; combobox render tested in en/es; the active row scrolls into view. |
| Deep links land on the item | Tasks 13–15 | On load and on client navigation (prev-compare); a retained filter clears itself. Walk "check par" and catering package links are deferred, with reasons. |
| Avg-weight dead end on chained SKUs | Task 16 | Same positive-number rule as the server. |
| Delete dead `SkuPackChainPanel` | Task 17 | |
| i18n en + es; guide text | Tasks 5, 9, 11, 18, 19 | Manager guide en + es (SKU edits stated as GM+); photos in one retake pass after Phase 5, with the spec amended to match (Task 19). |
| AGENTS.md updated when behaviour changes | Task 5 | Step-up law + the overlay-route sentence. |

Type consistency is checked across tasks:
- `StepUpTier`/`StepUpPurpose`/`StepUpGate`/`GrantAction` (Task 1) feed Tasks 3–5.
- `Session.catalogEditUnlockedAt` (Task 3) feeds the layout (Task 4).
- `RecipeLineFields`/`RecipeLineDraft` and the snapshot helpers (Task 6) feed Tasks 7, 8, 11 and 12.
- `IngredientOption`/`moveActive` (Task 9) feed Task 11.
- The link helpers (Task 13) feed Tasks 14 and 15.
- `RecipeBuilderSku.vendorName` (Task 10) feeds the picker (Task 12).

## Review r1 — what changed

| Finding | Resolution |
|---|---|
| P1-1 edit unlock satisfies B | Destructive catalog acts take no tier; they need one-shot grants (0257 `step_up_grants`, `lib/admin/step-up-grants.ts`), minted by the step-up POST's `purpose` and consumed by one conditional UPDATE. Tests: fresh E/shared refused, X/T vs Y/T′, replay, expiry, other session. |
| P1-2 Tier A escapes | Every Tier A catalog edit route and its clients moved to E. SKU deactivation became a grant. Tier map re-pinned and a grant map added. |
| P2-3 lifecycle | Own clock column, set only with `catalogWindow`. (Navigation-clear design superseded in r2 — see below.) |
| P2-4 concurrent edits | Compare-and-set on full expected values (no migration for this) → `409 line_changed`; audit from the matched and returned rows. |
| P2-5 weak bind test | Predicate-aware fake; cross-recipe, product-unit and cycle refusals tested through add and update. |
| P2-6 sequential links | Pure `skuFocusPatch` + prev-compare sync; a retained filter clears; sequence tested. |
| P2-7 draft lines | Edited in place through the same line editor. |
| P3-8 picker scroll | `moveActive` clamp + `scrollIntoView({ block: "nearest" })`, tested. |
| Unit rule text | Reconciled to AGENTS.md (any active measure-registry unit). |
| Guides | Task 18; photos deferred to one retake pass after Phase 5. |

## Review r2 — what changed

| Finding | Resolution |
|---|---|
| Design decision (CC) — background requests closed the window (r2 #2); failed clears left it open (r2 #4) | The catalog window is a FIXED 15-minute clock from an admin password: never extended, never cleared by navigation, ended by expiry or by the session ending. The activity-touch clear, its retry and the outside-path logic (`keepsCatalogWindow` / `catalogWindowAfterRequest`) are removed with their tests. New tests through the real `requireSession`: language PATCH, dashboard prefetch, counts and catering requests leave it intact; it expires at 15 minutes exactly; saving does not extend it; logout/revoke and session expiry end it. Destructive acts keep the one-shot grant. Task 20 checklist and the guide text say "stays unlocked for 15 minutes". |
| r2 #1 refresh defeats compare-and-set | `beginLineEdit` captures the starting line and the `expected` snapshot when Edit is tapped; the editor and the PATCH use that capture, never the refreshed row. Tests: a pure capture test, a server regression (another manager swaps the ingredient → refresh → stale save → 409, the row keeps their change), and a source pin that the builder never re-reads the snapshot. |
| r2 #3 0257 privilege ceiling | `revoke all … from public, anon, authenticated, service_role` first (0218 pattern), then exactly SELECT/INSERT/UPDATE; the guard refuses any other service_role privilege (role_table_grants + `has_table_privilege` for DELETE/TRUNCATE/REFERENCES/TRIGGER) and a missing needed one. sessions: no grant change, and the guard requires RLS on sessions. The source test checks the revoke-then-grant order. |
| r2 #5 photos vs spec | New Task 19 amends spec §7: guide text every phase, photo retakes in one pass after Phase 5. |
| r2 #6 guide promised SKU edits to AGMs | en + es now say GMs and up change recipes and SKUs (`SKU_WRITE_MIN` = 7; AGM expansion is Phase 5). |

## Review r3 — what changed

| Finding | Resolution |
|---|---|
| #1 CatalogClient's own modal left the provider's catalog clock null | The provider exposes `noteStepUpConfirmed` (the same pure `confirmClientUnlock` its own modal uses). CatalogClient calls it on confirm and `forgetStepUp` on refusal. Tests: a pure catalog-confirm → refresh → recipe-edit regression (proceeds without a second prompt), source pins on both files, and sim checklist item 1. |
| #2 Tier E deadline | `isInsideWindow` is EXCLUSIVE and is used by the server and client Tier E checks only. Tests: 899 999 ms ok, 900 000 and 900 001 refused (unit and lifecycle). Tier B keeps `isFreshWithin` (inclusive), now pinned at 120 000 / 120 001. |
| #3 spec unit rule | Task 19 also amends spec §1: product lines take any active measure-registry unit, never a pack label. |
