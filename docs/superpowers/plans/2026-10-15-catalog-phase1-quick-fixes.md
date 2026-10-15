# Catalog Redesign — Phase 1 (Quick Fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six Phase 1 quick fixes from the catalog redesign spec: a 15-minute edit unlock, recipe lines editable in place, a searchable ingredient picker, deep links that land on the exact item, a fix for the avg-weight dead end on chained SKUs, and removal of the dead `SkuPackChainPanel`.

**Architecture:** The edit unlock is a third step-up tier, **Tier E**, built on the existing step-up columns on the session row (`sessions.step_up_unlocked` + `step_up_unlocked_at`, stamped only by `POST /api/auth/step-up`). The window is checked on the server by the same pure `assertStepUp` on every write. It needs **no migration**. Recipe lines are config edges: removing one is already a hard DELETE with the before-row in the audit, and nothing keys on a line's id. So an edit is an in-place UPDATE, audited as `recipe_input.update` with the whole before and after line. It runs through one validator shared with the add path. The picker, line parsing and diffing, deep-link builders and the avg-weight rule are pure `*-shared.ts` modules with vitest tests. The UI changes rewire existing components onto them.

**Tech Stack:** Next.js 16.2.4 (App Router; page `searchParams` is a Promise), React 19.2.4, TypeScript strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens, Supabase (service role), vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-15-catalog-redesign-design.md` §4 ("Passwords") and §7 (Phase 1).

**Working copy:** `C:\Users\conta\co-ops-guides`. Branch from `origin/main`:

```bash
cd /c/Users/conta/co-ops-guides && git fetch origin && git checkout -b feat/catalog-phase1-quick-fixes origin/main
```

**Standing rules for every task:**
- Read `AGENTS.md` first. It is the law-book: the closed audit vocabulary, the 44px + `items-center` floor, the token roles, en + es in the same PR, and tú Spanish.
- Use the sim only (`node scripts/sim/dev-sim.mjs`, http://localhost:3100). Never test against production.
- Every commit message ends with the two trailer lines shown in each commit step.
- Do not apply any migration. This plan needs none.

---

## Ground truth this plan is built on (verified 2026-10-15 against `main` @ 0ff0eb90)

| Claim | Where |
|---|---|
| Step-up lives on the session row: `step_up_unlocked` + `step_up_unlocked_at`. Only `unlockStepUp` sets it, after a password check in `POST /api/auth/step-up`, which already audits `auth_step_up_success`. | `lib/session.ts:518-526`, `app/api/auth/step-up/route.ts` |
| `requireSessionCore` copies both columns into `AuthContext.session`. It **clears** them when the actor leaves the step-up surface (`/admin*`, `/api/admin*`, two catering money routes). | `lib/session.ts:229-400` |
| `assertStepUp` is pure. Tier A = unlocked at any age. Tier B = unlocked within 120 s (`ADMIN_STEP_UP_FRESH_SECONDS`). | `lib/admin/step-up.ts` |
| The client `StepUpProvider` always prompts for Tier B. It skips the prompt for Tier A when unlocked. | `components/admin/StepUpProvider.tsx:35-38` |
| `DESTRUCTIVE_ACTIONS` does **not** drive step-up. Step-up is chosen per route (AGENTS.md "What destructive MEANS"). So "always prompt" is a list of **routes**, not registry names. | `lib/destructive-actions.ts` header |
| Recipe and catalog routes at Tier B today: recipes (create, full, PATCH, DELETE, inputs, outputs, edges, yield-nudge), skus POST, products POST, products/[id]/active, items sold-directly, menu-items POST, menu price, weights. SKU edit, price, pack chain, overlay, and product members/primary are **Tier A**. | `tests/step-up-tier-map.test.ts` (pinned map) |
| `recipe_inputs` has no active or superseded columns. `removeRecipeEdge` hard-deletes the row with `metadata.before`. No table has an FK to `recipe_inputs.id` (`production_inputs` stores SKU + oz). Seeds 22, 25 and 32 already UPDATE lines in place under `recipe_input.update`. That action is registered **non-destructive** today, beside destructive `add` and `remove`. | `0103_recipe_entities.sql:32-46`, `lib/recipes.ts:604-627`, `0102`, `lib/audit-actions.ts:242` |
| `addRecipeInput` checks: exactly one of three targets, quantity > 0, and for a product line `assertProductLineIsValid` (active product + active measure unit). It has **no** cycle guard for item lines. Only `createRecipeFull` has one. "Mass balance" is a **read-time** costing guard (`lib/menu-costing-shared.ts massBalanceIndex`), not a write guard. | `lib/recipes.ts:108-134, 357-370, 520-534` |
| The recipe builder offers three separate `<select>` pickers (SKU, item, product) with no search. The two recipe pages carry byte-identical loaders. | `RecipeBuilder.tsx:964-967`, `app/admin/recipes/[id]/page.tsx`, `app/admin/recipes/new/page.tsx` |
| Lists the deep links land on: `CatalogClient.tsx:376` (`/admin/skus`), `lib/vendor-import.ts:212` (`/admin/skus`), `VendorImportPanel.tsx:131` (`/admin/skus?vendor=`, a param the page never read), `registryLinkHref` sku (`/admin/skus#id`, no expand), and the costing drawer (names, no links at all). SKU rows carry `id={s.id}` and `scroll-mt-24`. The products page already honours `?product=`. | listed files |
| `leaf_needs_avg` is raised for a RAW chain whose leaf is a count or volume unit with no avg. The avg field renders only inside `PackChainWizard`, which never renders for a chained SKU. `SkuBuilder` already keeps an `avgOzPerEach` state and sends it on the identity Save. | `lib/admin/pack-chain.ts:216-239`, `SkuBuilder.tsx:249, 324, 584-660`, `PackChainWizard.tsx:373` |
| `SkuPackChainPanel.tsx` has no importer. Only comments and the tier-map test's client map name it. | `grep -rn SkuPackChainPanel` |

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/admin/step-up-shared.ts` | create | Pure tier logic: `StepUpTier` (A/B/E), window constants, `isFreshWithin`, the client `stepUpDecision`, `isStepUpRefusal`, `parseWindowSeconds`. |
| `lib/admin/step-up.ts` | rewrite | Server check: `assertStepUp` gains Tier E (15 min, env `ADMIN_STEP_UP_EDIT_WINDOW_SECONDS`, never shorter than B). |
| `components/admin/StepUpProvider.tsx` | rewrite | Client: Tier E proceeds inside the window; `forgetStepUp()`; refs so a forget takes effect in the same tick. |
| `components/admin/useStepUpPost.ts` | create | `postJson` that forgets a refused unlock, so the next tap prompts. |
| `app/admin/layout.tsx` | modify | Pass the server's window to the provider. |
| `app/api/auth/step-up/route.ts` | modify | `auth_step_up_success` metadata records `edit_window_seconds`. |
| 12 route files (Task 3 list) | modify | Non-destructive catalog and recipe writes move from Tier B to Tier E. |
| `components/admin/recipes/RecipeBuilder.tsx` | modify | Tier E; `send` via `useStepUpPost`; the CONSUMES section is rebuilt on the line editor. |
| `components/admin/skus/SkuCatalogClient.tsx`, `VendorSkusCard.tsx`, `components/admin/items/ItemRow.tsx`, `components/admin/weights/WeightBoardClient.tsx`, `components/admin/products/ProductsClient.tsx`, `components/admin/menu-costing/MenuPriceEditor.tsx` | modify | Request Tier E for the converted routes and forget on refusal. |
| `tests/step-up-tier-map.test.ts` | modify | Pin the new tier map (regex accepts `E`). |
| `tests/menu-prices-data.test.ts`, `tests/menu-prices-ui.test.ts` | modify | The price route asserts `E`; the mock exposes `forgetStepUp`. |
| `AGENTS.md` | modify | New law bullet: three tiers, one timestamp, fixed window. |
| `lib/recipe-line-shared.ts` | create | Pure recipe-line surface: types, `parseRecipeLinePatch`, row↔line, `diffRecipeLine`, `recipeLineKind`, `lineUnitChoices`, `lineDraftFromView`. |
| `lib/recipes.ts` | modify | `assertInputLineIsValid` (one validator for add + edit, with an item-line cycle guard); `updateRecipeInput`. |
| `lib/destructive-actions.ts`, `lib/audit-actions.ts`, `lib/dynamic-pars.ts` | modify | `recipe_input.update` becomes destructive (comment synced in dynamic-pars). |
| `app/api/admin/recipes/[id]/inputs/[inputId]/route.ts` | create | `PATCH` one line (Tier E). |
| `components/admin/recipes/shared.ts` | modify | Two product-line error codes get their own messages. |
| `lib/ingredient-picker-shared.ts` | create | Pure picker: build options (name · vendor · kind), accent-blind multi-token search with ranking, `optionForLine`, `lineTargetKey`. |
| `lib/admin/recipe-builder-data.ts` | create | One loader for both recipe pages; SKUs carry `vendorName`. |
| `app/admin/recipes/[id]/page.tsx`, `app/admin/recipes/new/page.tsx` | rewrite | Use the loader. |
| `components/admin/recipes/IngredientPicker.tsx` | create | ARIA combobox: type to filter, arrows/Enter/Escape, 44px rows, phone-width. |
| `components/admin/recipes/RecipeLineEditor.tsx` | create | One add/edit line form: picker + qty + kind-aware unit + portioned. |
| `components/admin/recipes/RecipeInputRow.tsx` | modify | **Edit** button beside Remove. |
| `lib/i18n/en.json`, `lib/i18n/es.json` | modify | New picker, editor and row keys. |
| `lib/admin/product-item-links-shared.ts` | modify | `skuCatalogHref` / `productHref` / `prepItemHref` / `readFocusParam`; `registryLinkHref` delegates. |
| `app/admin/skus/page.tsx`, `components/admin/skus/SkuCatalogClient.tsx` | modify | `?sku=` opens, rings and scrolls to the row; `?vendor=` preselects the filter. |
| `lib/admin/catalog-shared.ts`, `lib/admin/catalog.ts`, `components/admin/catalog/CatalogClient.tsx` | modify | Item → SKU edges carry ids; each SKU links to its own row. |
| `lib/vendor-import.ts`, `components/admin/vendors/VendorImportPanel.tsx` | modify | "Needs a person" links to the matched SKU. |
| `components/admin/menu-costing/MenuCostingClient.tsx` | modify | Blocking SKUs, retired products and prep items in the drawer become links. |
| `lib/admin/catalog-shared.ts` (`chainNeedsAvgOzPerEach`), `components/admin/skus/SkuBuilder.tsx` | modify | The avg oz field on the chained edit path, with the server's rule. |
| `components/admin/skus/SkuPackChainPanel.tsx` | delete | Dead code. |
| `tests/step-up-edit-window.test.ts`, `tests/step-up-edit-window-wiring.test.ts`, `tests/recipe-line-shared.test.ts`, `tests/recipe-line-edit-server.test.ts`, `tests/ingredient-picker-shared.test.ts`, `tests/ingredient-picker-ui.test.ts`, `tests/recipe-line-edit-ui.test.ts`, `tests/catalog-deep-links.test.ts`, `tests/dead-code-removed.test.ts` | create | Unit tests and source pins. |
| `tests/product-item-links.test.ts`, `tests/sku-builder-shared.test.ts` | modify | Updated and added expectations. |

---

## Task 1: Tier E — the pure decision and the server check

**Files:**
- Create: `lib/admin/step-up-shared.ts`
- Rewrite: `lib/admin/step-up.ts`
- Test: `tests/step-up-edit-window.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/step-up-edit-window.test.ts`:

```ts
/**
 * Catalog Phase 1 — Tier E, the 15-minute catalog/recipe edit window.
 *
 * ONE timestamp (sessions.step_up_unlocked_at, stamped only by a password), three
 * freshness bounds. The server check (assertStepUp) is the authority; the client
 * decision (stepUpDecision) only decides whether to SHOW the prompt.
 */
import { afterEach, describe, expect, it } from "vitest";
import { assertStepUp, stepUpEditWindowMs, stepUpFreshWindowMs } from "@/lib/admin/step-up";
import {
  CLIENT_EDIT_WINDOW_MARGIN_MS,
  DEFAULT_EDIT_WINDOW_MS,
  isFreshWithin,
  isStepUpRefusal,
  parseWindowSeconds,
  stepUpDecision,
} from "@/lib/admin/step-up-shared";
import type { AuthContext } from "@/lib/session";

const NOW = Date.parse("2026-10-15T15:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
function ctx(unlockedAt: string | null, unlocked = true): AuthContext {
  return { session: { stepUpUnlocked: unlocked, stepUpUnlockedAt: unlockedAt } } as unknown as AuthContext;
}

afterEach(() => {
  delete process.env.ADMIN_STEP_UP_EDIT_WINDOW_SECONDS;
  delete process.env.ADMIN_STEP_UP_FRESH_SECONDS;
});

describe("Tier E on the server — the window is checked on every write", () => {
  it("defaults to 15 minutes", () => {
    expect(stepUpEditWindowMs()).toBe(900_000);
    expect(DEFAULT_EDIT_WINDOW_MS).toBe(900_000);
  });

  it("passes up to and including 15 minutes, and is stale one millisecond later", () => {
    expect(assertStepUp(ctx(ago(14 * 60_000)), "E", NOW)).toEqual({ ok: true });
    expect(assertStepUp(ctx(ago(900_000)), "E", NOW)).toEqual({ ok: true });
    expect(assertStepUp(ctx(ago(900_001)), "E", NOW)).toEqual({ ok: false, code: "step_up_stale" });
  });

  it("a locked session is step_up_required, never stale", () => {
    expect(assertStepUp(ctx(ago(1_000), false), "E", NOW)).toEqual({ ok: false, code: "step_up_required" });
  });

  it("a missing, garbled or future timestamp is stale", () => {
    expect(assertStepUp(ctx(null), "E", NOW)).toEqual({ ok: false, code: "step_up_stale" });
    expect(assertStepUp(ctx("not a date"), "E", NOW)).toEqual({ ok: false, code: "step_up_stale" });
    expect(assertStepUp(ctx(new Date(NOW + 60_000).toISOString()), "E", NOW)).toEqual({ ok: false, code: "step_up_stale" });
  });

  it("the window is FIXED from the password: a 10-minute-old unlock passes E and fails B", () => {
    expect(assertStepUp(ctx(ago(10 * 60_000)), "E", NOW)).toEqual({ ok: true });
    expect(assertStepUp(ctx(ago(10 * 60_000)), "B", NOW)).toEqual({ ok: false, code: "step_up_stale" });
  });

  it("Tier A and Tier B are unchanged", () => {
    expect(assertStepUp(ctx(ago(60 * 60_000)), "A", NOW)).toEqual({ ok: true });
    expect(assertStepUp(ctx(ago(30_000)), "B", NOW)).toEqual({ ok: true });
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

describe("the client decision — when to SHOW the password prompt", () => {
  it("Tier A proceeds whenever unlocked", () => {
    expect(stepUpDecision("A", true, null, NOW)).toBe("proceed");
    expect(stepUpDecision("A", false, null, NOW)).toBe("prompt");
  });

  it("Tier B always prompts, even for a one-second-old unlock", () => {
    expect(stepUpDecision("B", true, ago(1_000), NOW)).toBe("prompt");
  });

  it("Tier E proceeds inside the window minus the client margin, and prompts after it", () => {
    const edge = DEFAULT_EDIT_WINDOW_MS - CLIENT_EDIT_WINDOW_MARGIN_MS;
    expect(stepUpDecision("E", true, ago(edge), NOW)).toBe("proceed");
    expect(stepUpDecision("E", true, ago(edge + 1), NOW)).toBe("prompt");
  });

  it("Tier E prompts when locked or when there is no timestamp", () => {
    expect(stepUpDecision("E", false, ago(1_000), NOW)).toBe("prompt");
    expect(stepUpDecision("E", true, null, NOW)).toBe("prompt");
  });

  it("Tier E honours the window the server passed down", () => {
    expect(stepUpDecision("E", true, ago(20 * 60_000), NOW, 30 * 60_000)).toBe("proceed");
  });
});

describe("helpers", () => {
  it("isFreshWithin is inclusive at the edge and refuses negative ages", () => {
    expect(isFreshWithin(ago(500), NOW, 500)).toBe(true);
    expect(isFreshWithin(ago(501), NOW, 500)).toBe(false);
    expect(isFreshWithin(new Date(NOW + 1).toISOString(), NOW, 500)).toBe(false);
  });

  it("isStepUpRefusal knows exactly the two codes assertStepUp returns", () => {
    expect(isStepUpRefusal("step_up_required")).toBe(true);
    expect(isStepUpRefusal("step_up_stale")).toBe(true);
    expect(isStepUpRefusal("forbidden")).toBe(false);
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
Expected: FAIL. The output reads `Failed to resolve import "@/lib/admin/step-up-shared"` (or `Cannot find module`).

- [ ] **Step 3: Create `lib/admin/step-up-shared.ts`**

```ts
/**
 * Step-up tiers — CLIENT-SAFE pure surface (no I/O, no env, no server imports). Split out
 * 2026-10-15 (catalog redesign Phase 1) so StepUpProvider and lib/admin/step-up.ts decide
 * freshness with ONE function.
 *
 *   A — unlocked at all (any age).
 *   B — unlocked within the 120 s freshness window; the client ALWAYS prompts.
 *   E — the catalog/recipe EDIT WINDOW: unlocked within 15 minutes of the password entry.
 *       The client skips the prompt while its copy of the unlock is inside the window minus
 *       a 30 s margin; the server re-checks the same `step_up_unlocked_at` on every write,
 *       so the server stays the authority.
 *
 * The window is FIXED from the password entry and never slides. Nothing but a password may
 * move `sessions.step_up_unlocked_at`: sliding it on each edit would ALSO satisfy Tier B,
 * which would let a destructive action through without a password.
 */
export type StepUpTier = "A" | "B" | "E";

export const DEFAULT_FRESH_SECONDS = 120;
export const DEFAULT_EDIT_WINDOW_SECONDS = 15 * 60;
export const DEFAULT_EDIT_WINDOW_MS = DEFAULT_EDIT_WINDOW_SECONDS * 1000;
/** The client gives up this much of the window so it never proceeds into a server-side stale. */
export const CLIENT_EDIT_WINDOW_MARGIN_MS = 30_000;

/** A positive whole-second env value, else the fallback. */
export function parseWindowSeconds(raw: string | undefined, fallback: number): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** True when `unlockedAt` is a real instant, not after `now`, and at most `windowMs` old. */
export function isFreshWithin(unlockedAt: string | null, now: number, windowMs: number): boolean {
  if (!unlockedAt) return false;
  const age = now - Date.parse(unlockedAt);
  return !Number.isNaN(age) && age >= 0 && age <= windowMs;
}

/** Client decision: may this request skip the password prompt? The server re-checks either way. */
export function stepUpDecision(
  tier: StepUpTier,
  unlocked: boolean,
  unlockedAt: string | null = null,
  now: number = Date.now(),
  editWindowMs: number = DEFAULT_EDIT_WINDOW_MS,
): "proceed" | "prompt" {
  if (!unlocked) return "prompt";
  if (tier === "A") return "proceed";
  if (tier === "E") {
    return isFreshWithin(unlockedAt, now, editWindowMs - CLIENT_EDIT_WINDOW_MARGIN_MS) ? "proceed" : "prompt";
  }
  return "prompt";
}

/** The two codes assertStepUp answers with. On either, the client must forget its unlock. */
export function isStepUpRefusal(code: string | null | undefined): boolean {
  return code === "step_up_required" || code === "step_up_stale";
}
```

- [ ] **Step 4: Rewrite `lib/admin/step-up.ts`** (replace the whole file)

```ts
import type { AuthContext } from "@/lib/session";
import {
  DEFAULT_EDIT_WINDOW_SECONDS,
  DEFAULT_FRESH_SECONDS,
  isFreshWithin,
  parseWindowSeconds,
  type StepUpTier,
} from "@/lib/admin/step-up-shared";

/**
 * Admin step-up enforcement (C.44 Module 1; Tier E added 2026-10-15, catalog Phase 1).
 *
 * Password verification lives solely in POST /api/auth/step-up, which stamps
 * sessions.step_up_unlocked + step_up_unlocked_at (lib/session.ts unlockStepUp). The tiers
 * differ only by a freshness bound on that ONE timestamp:
 *   Tier A — unlocked at all (any age).
 *   Tier B — unlocked within ADMIN_STEP_UP_FRESH_SECONDS (default 120 s). Destructive acts.
 *   Tier E — unlocked within ADMIN_STEP_UP_EDIT_WINDOW_SECONDS (default 900 s, never shorter
 *            than Tier B): the catalog/recipe edit window. Fixed from the password entry.
 * Every tier clears when the actor leaves the step-up surface (lib/session.ts
 * requireSessionCore). Pure over AuthContext; `now` is injectable.
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
  if (!ctx.session.stepUpUnlocked) return { ok: false, code: "step_up_required" };
  if (tier === "A") return { ok: true };
  const windowMs = tier === "E" ? stepUpEditWindowMs() : stepUpFreshWindowMs();
  if (!isFreshWithin(ctx.session.stepUpUnlockedAt, now, windowMs)) {
    return { ok: false, code: "step_up_stale" };
  }
  return { ok: true };
}
```

- [ ] **Step 5: Run the new test and the existing step-up test**

Run: `npx vitest run tests/step-up-edit-window.test.ts tests/auth-step-up-hardening.test.ts`
Expected: PASS for both files, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add lib/admin/step-up-shared.ts lib/admin/step-up.ts tests/step-up-edit-window.test.ts
git commit -F - <<'EOF'
feat(step-up): Tier E — the 15-minute catalog edit window, checked on the server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 2: Client wiring — provider, forget-on-refusal, layout window, unlock audit

**Files:**
- Rewrite: `components/admin/StepUpProvider.tsx`
- Create: `components/admin/useStepUpPost.ts`
- Modify: `app/admin/layout.tsx`
- Modify: `app/api/auth/step-up/route.ts`
- Test: `tests/step-up-edit-window-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/step-up-edit-window-wiring.test.ts`:

```ts
/**
 * Catalog Phase 1 — how the edit window is wired. Source-level pins (the house fallback for
 * client wiring the unit spine cannot render: tests/dynamic-pars-write.test.ts).
 */
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
  it("StepUpProvider decides with the shared stepUpDecision over refs, and exposes forgetStepUp", () => {
    const src = read("components/admin/StepUpProvider.tsx");
    expect(src).toContain('from "@/lib/admin/step-up-shared"');
    expect(src).toContain("stepUpDecision(tier, unlockedRef.current, unlockedAtRef.current, Date.now(), editWindowMs)");
    expect(src).toContain("forgetStepUp");
  });

  it("the admin layout hands the server's window to the client", () => {
    expect(read("app/admin/layout.tsx")).toContain("editWindowMs={stepUpEditWindowMs()}");
  });

  it("a successful unlock is audited with the window it opened", () => {
    expect(read("app/api/auth/step-up/route.ts")).toMatch(
      /action: "auth_step_up_success",[\s\S]{0,200}edit_window_seconds: stepUpEditWindowMs\(\) \/ 1000/,
    );
  });

  it("useStepUpPost forgets an unlock the server refused", () => {
    expect(read("components/admin/useStepUpPost.ts")).toContain(
      "if (!result.ok && isStepUpRefusal(result.code)) forgetStepUp();",
    );
  });

  it("only unlockStepUp stamps step_up_unlocked_at, so the window cannot slide", () => {
    const writers = filesUnder("app", "lib", "components")
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /step_up_unlocked_at:\s*now/.test(read(f)));
    expect(writers).toEqual(["lib/session.ts"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/step-up-edit-window-wiring.test.ts`
Expected: FAIL. 4 failed (provider, layout, audit, useStepUpPost `ENOENT`) and 1 passed (the "cannot slide" pin).

- [ ] **Step 3: Rewrite `components/admin/StepUpProvider.tsx`** (replace the whole file)

Keep the docstring phrase `requestStepUp(tier)`. The tier-map test reads it as this file's `VAR:tier` entry.

```tsx
"use client";

/**
 * StepUpProvider — client orchestration for admin step-up (C.44 Module 1; Tier E added
 * 2026-10-15, catalog Phase 1). Hosts a single PasswordModal for the admin subtree and
 * exposes requestStepUp(tier) to descendants.
 *
 *   Tier A — if already unlocked, resolve "ok" without a prompt; else prompt.
 *   Tier B — always prompt (the prompt refreshes step_up_unlocked_at; the server-side
 *            freshness check in lib/admin/step-up.ts is the real gate).
 *   Tier E — the catalog/recipe edit window: no prompt while this device's unlock is inside
 *            the window (minus a 30 s margin), else prompt. The server re-checks every write.
 *
 * The client's unlock is ADVISORY. When a route answers step_up_required / step_up_stale
 * (the server cleared or aged the unlock underneath us), the caller runs forgetStepUp() —
 * useStepUpPost does it for every write that goes through it — so the next request prompts
 * instead of proceeding on a stale memory until the client's own clock runs out.
 *
 * Refs mirror the unlock state so forgetStepUp() and a confirm take effect for a request
 * made in the same tick (a retry right after a refusal must prompt, not reuse a closure).
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
import { DEFAULT_EDIT_WINDOW_MS, stepUpDecision, type StepUpTier } from "@/lib/admin/step-up-shared";

export { stepUpDecision };

interface StepUpContextValue {
  /** Ensure step-up for the tier; resolves "ok" once satisfied (possibly after a prompt) or "cancelled". */
  requestStepUp: (tier: StepUpTier) => Promise<"ok" | "cancelled">;
  /** Drop this device's memory of an unlock the server refused, so the next request prompts. */
  forgetStepUp: () => void;
  unlocked: boolean;
  unlockedAt: string | null;
}

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function StepUpProvider({
  unlocked: initialUnlocked,
  unlockedAt: initialUnlockedAt,
  editWindowMs = DEFAULT_EDIT_WINDOW_MS,
  children,
}: {
  unlocked: boolean;
  unlockedAt: string | null;
  /** The server's Tier E window (lib/admin/step-up.ts stepUpEditWindowMs) — how the env override reaches the client. */
  editWindowMs?: number;
  children: ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(initialUnlocked);
  const [unlockedAt, setUnlockedAt] = useState<string | null>(initialUnlockedAt);
  const unlockedRef = useRef(initialUnlocked);
  const unlockedAtRef = useRef<string | null>(initialUnlockedAt);
  const [modalOpen, setModalOpen] = useState(false);
  const resolverRef = useRef<((r: "ok" | "cancelled") => void) | null>(null);

  const remember = useCallback((on: boolean, at: string | null) => {
    unlockedRef.current = on;
    unlockedAtRef.current = at;
    setUnlocked(on);
    setUnlockedAt(at);
  }, []);

  const requestStepUp = useCallback(
    (tier: StepUpTier): Promise<"ok" | "cancelled"> => {
      if (stepUpDecision(tier, unlockedRef.current, unlockedAtRef.current, Date.now(), editWindowMs) === "proceed") {
        return Promise.resolve("ok");
      }
      return new Promise<"ok" | "cancelled">((resolve) => {
        resolverRef.current = resolve;
        setModalOpen(true);
      });
    },
    [editWindowMs],
  );

  const forgetStepUp = useCallback(() => remember(false, null), [remember]);

  const handleConfirm = useCallback(() => {
    // PasswordModal posts /api/auth/step-up and calls onConfirm only on 200.
    remember(true, new Date().toISOString());
    setModalOpen(false);
    resolverRef.current?.("ok");
    resolverRef.current = null;
  }, [remember]);

  const handleCancel = useCallback(() => {
    setModalOpen(false);
    resolverRef.current?.("cancelled");
    resolverRef.current = null;
  }, []);

  return (
    <StepUpContext.Provider value={{ requestStepUp, forgetStepUp, unlocked, unlockedAt }}>
      {children}
      <PasswordModal open={modalOpen} onConfirm={handleConfirm} onCancel={handleCancel} />
    </StepUpContext.Provider>
  );
}

export function useStepUp(): StepUpContextValue {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error("useStepUp must be used within <StepUpProvider>.");
  return ctx;
}
```

- [ ] **Step 4: Create `components/admin/useStepUpPost.ts`**

```ts
"use client";

/**
 * useStepUpPost — postJson for a step-up-gated write, with the one extra duty the Tier E
 * window needs: when the server refuses with step_up_required / step_up_stale, tell
 * StepUpProvider to forget its unlock so the NEXT tap prompts. Without it a client that
 * believes it is inside the window would keep proceeding into the same refusal until its
 * own clock ran the window out (catalog Phase 1, 2026-10-15).
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

- [ ] **Step 5: Pass the window from `app/admin/layout.tsx`**

Add the import after `import { StepUpProvider } from "@/components/admin/StepUpProvider";`:

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
        editWindowMs={stepUpEditWindowMs()}
      >
```

(`app/(authed)/catering/pipeline/page.tsx` and `app/(authed)/stations/page.tsx` also mount the provider. They use Tiers A and B only and keep the default, so leave them unchanged.)

- [ ] **Step 6: Audit the window on unlock in `app/api/auth/step-up/route.ts`**

Add the import after `import { ROLES, type RoleCode } from "@/lib/roles";`:

```ts
import { stepUpEditWindowMs } from "@/lib/admin/step-up";
```

In the success block (step 5, the only `metadata: {},` in the file), replace:

```ts
    action: "auth_step_up_success",
    resourceTable: "sessions",
    resourceId: session.id,
    metadata: {},
```

with:

```ts
    action: "auth_step_up_success",
    resourceTable: "sessions",
    resourceId: session.id,
    // Catalog Phase 1: one unlock opens the Tier E edit window — record how long it opened.
    metadata: { edit_window_seconds: stepUpEditWindowMs() / 1000 },
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/step-up-edit-window-wiring.test.ts tests/step-up-edit-window.test.ts tests/step-up-tier-map.test.ts`
Expected: PASS, 0 failed. The tier map is unchanged so far because the provider still reads as `VAR:tier`.

- [ ] **Step 8: Commit**

```bash
git add components/admin/StepUpProvider.tsx components/admin/useStepUpPost.ts app/admin/layout.tsx app/api/auth/step-up/route.ts tests/step-up-edit-window-wiring.test.ts
git commit -F - <<'EOF'
feat(step-up): client edit window, forget-on-refusal, and the window in the unlock audit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 3: Move catalog and recipe edits to Tier E; destructive acts stay Tier B

**Routes that become Tier E** (non-destructive catalog and recipe writes; one literal each):
`app/api/admin/recipes/route.ts`, `app/api/admin/recipes/full/route.ts`, `app/api/admin/recipes/[id]/route.ts` (**PATCH only**), `app/api/admin/recipes/[id]/inputs/route.ts`, `app/api/admin/recipes/[id]/outputs/route.ts`, `app/api/admin/recipes/edges/route.ts`, `app/api/admin/skus/route.ts` (POST create), `app/api/admin/products/route.ts` (POST create), `app/api/admin/items/[itemId]/sold-directly/route.ts`, `app/api/admin/menu-items/route.ts`, `app/api/admin/menu-items/[id]/price/route.ts`, `app/api/admin/weights/route.ts`.

**These stay Tier B and prompt every time:** `products/[id]/active` (retire), `recipes/[id]` **DELETE** (delete recipe), and every non-catalog route. `recipes/yield-nudge` also stays B: it is driven from `/production` outside `/admin`, where the unlock is cleared anyway. So are `skus/measure-units`, `skus/pack-formats` and `skus/pending`, which are registry and receiving writes. Tier A routes are not touched; they are already looser than E.

**Files:**
- Modify: the 12 routes above
- Modify: `components/admin/recipes/RecipeBuilder.tsx`, `components/admin/skus/SkuCatalogClient.tsx`, `components/admin/skus/VendorSkusCard.tsx`, `components/admin/items/ItemRow.tsx`, `components/admin/weights/WeightBoardClient.tsx`, `components/admin/products/ProductsClient.tsx`, `components/admin/menu-costing/MenuPriceEditor.tsx`
- Modify: `tests/step-up-tier-map.test.ts`, `tests/menu-prices-data.test.ts`, `tests/menu-prices-ui.test.ts`, `tests/step-up-edit-window-wiring.test.ts`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update the pinned tier map (the failing test)**

In `tests/step-up-tier-map.test.ts`:

1. In `tiersIn`, replace `"([AB])"` with `"([ABE])"`:

```ts
  const literals = [...src.matchAll(new RegExp(`${fn}\\(${args}"([ABE])"`, "g"))].map((m) => m[1] as string);
```

2. In `SERVER_TIER_MAP`, replace these entries:

```ts
  "app/api/admin/items/[itemId]/sold-directly/route.ts": ["E"],
  "app/api/admin/menu-items/route.ts": ["E"],
  "app/api/admin/menu-items/[id]/price/route.ts": ["E"],
  "app/api/admin/products/route.ts": ["E"],
  "app/api/admin/recipes/[id]/inputs/route.ts": ["E"],
  "app/api/admin/recipes/[id]/outputs/route.ts": ["E"],
  // Catalog Phase 1: PATCH is the edit window (E); DELETE (delete a recipe) still prompts (B).
  "app/api/admin/recipes/[id]/route.ts": ["B", "E"],
  "app/api/admin/recipes/edges/route.ts": ["E"],
  "app/api/admin/recipes/full/route.ts": ["E"],
  "app/api/admin/recipes/route.ts": ["E"],
  "app/api/admin/skus/route.ts": ["E"],
  "app/api/admin/weights/route.ts": ["E"],
```

3. In `CLIENT_TIER_MAP`, replace these entries:

```ts
  "components/admin/menu-costing/MenuPriceEditor.tsx": ["E"],
  "components/admin/items/ItemRow.tsx": ["B", "E"],
  "components/admin/recipes/RecipeBuilder.tsx": ["B", "E"],
  "components/admin/skus/SkuCatalogClient.tsx": ["A", "E"],
  "components/admin/skus/VendorSkusCard.tsx": ["A", "E"],
  "components/admin/weights/WeightBoardClient.tsx": ["E"],
```

4. Replace the whole `describe("RecipeBuilder — the two lanes that asked for nothing (fixed here)", …)` block with:

```ts
describe("RecipeBuilder — the two lanes that asked for nothing (fixed here)", () => {
  const src = () => read("components/admin/recipes/RecipeBuilder.tsx");

  it("patchField requests the edit window before PATCHing the recipe header", () => {
    // /api/admin/recipes/[id] PATCH asserts Tier E (catalog Phase 1; was B).
    const lane = src().slice(src().indexOf("const patchField"));
    const body = lane.slice(0, lane.indexOf("};"));
    expect(body).toContain('requestStepUp("E")');
    expect(body.indexOf('requestStepUp("E")')).toBeLessThan(body.indexOf("send("));
  });

  it("removeEdge requests the edit window and surfaces its refusal", () => {
    // /api/admin/recipes/edges asserts Tier E; a removal that does not happen must say so.
    const lane = src().slice(src().indexOf("const removeEdge"));
    const body = lane.slice(0, lane.indexOf("\n  };"));
    expect(body).toContain('requestStepUp("E")');
    expect(body).toContain("setPatchError");
    expect(body.indexOf('requestStepUp("E")')).toBeLessThan(body.indexOf("send("));
  });
});
```

5. Append this block to `tests/step-up-edit-window-wiring.test.ts`:

```ts
describe("destructive acts keep prompting every time (spec §4)", () => {
  it("retiring a product and deleting a recipe stay Tier B on the server", () => {
    expect(read("app/api/admin/products/[id]/active/route.ts")).toContain('assertStepUp(ctx, "B")');
    const recipeRoute = read("app/api/admin/recipes/[id]/route.ts");
    const del = recipeRoute.slice(recipeRoute.indexOf("export async function DELETE"));
    expect(del).toContain('assertStepUp(ctx, "B")');
    expect(del).not.toContain('assertStepUp(ctx, "E")');
  });

  it("…and the clients ask for Tier B for exactly those two acts", () => {
    const builder = read("components/admin/recipes/RecipeBuilder.tsx");
    const lane = builder.slice(builder.indexOf("const deleteRecipe"), builder.indexOf("// ── Header local state"));
    expect(lane).toContain('requestStepUp("B")');
    expect(read("components/admin/products/ProductsClient.tsx")).toMatch(
      /onMutate\("B", `\/api\/admin\/products\/\$\{product\.id\}\/active`/,
    );
  });
});
```

6. In `tests/menu-prices-data.test.ts`, replace:

```ts
  it("requires session, level 8, and Tier B", async () => {
```

with:

```ts
  it("requires session, level 8, and the Tier E edit window", async () => {
```

and replace `expect(mocks.step).toHaveBeenCalledWith(actor, "B");` with `expect(mocks.step).toHaveBeenCalledWith(actor, "E");`.

7. In `tests/menu-prices-ui.test.ts`, replace the StepUpProvider mock line with:

```ts
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn(), forgetStepUp: vi.fn() }) }));
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/step-up-tier-map.test.ts tests/menu-prices-data.test.ts tests/step-up-edit-window-wiring.test.ts`
Expected: FAIL. The server-half and client-half map assertions fail (the received map still shows `B`). Both RecipeBuilder lane tests fail, and `menu-prices-data` "Tier E edit window" fails. The two new destructive tests PASS, because they pin today's B.

- [ ] **Step 3: Flip the 11 single-occurrence routes**

```bash
cd /c/Users/conta/co-ops-guides
for f in \
  app/api/admin/recipes/route.ts \
  app/api/admin/recipes/full/route.ts \
  "app/api/admin/recipes/[id]/inputs/route.ts" \
  "app/api/admin/recipes/[id]/outputs/route.ts" \
  app/api/admin/recipes/edges/route.ts \
  app/api/admin/skus/route.ts \
  app/api/admin/products/route.ts \
  "app/api/admin/items/[itemId]/sold-directly/route.ts" \
  app/api/admin/menu-items/route.ts \
  "app/api/admin/menu-items/[id]/price/route.ts" \
  app/api/admin/weights/route.ts; do
  sed -i 's/assertStepUp(ctx, "B")/assertStepUp(ctx, "E")/' "$f"
done
grep -c 'assertStepUp(ctx, "E")' app/api/admin/recipes/route.ts app/api/admin/weights/route.ts
```

Expected: each grep count is `1`.

- [ ] **Step 4: Flip only the PATCH in `app/api/admin/recipes/[id]/route.ts`**

Replace (in `PATCH`, the only lane gated on `RECIPE_WRITE_MIN`):

```ts
  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
```

with:

```ts
  if (ROLES[ctx.user.role].level < RECIPE_WRITE_MIN) return jsonError(403, "forbidden");
  // Catalog Phase 1: a header edit rides the 15-minute edit window. DELETE below stays Tier B.
  const su = assertStepUp(ctx, "E");
```

- [ ] **Step 5: RecipeBuilder — Tier E everywhere except Delete, and every write through `send`**

```bash
cd /c/Users/conta/co-ops-guides
f=components/admin/recipes/RecipeBuilder.tsx
sed -i 's/requestStepUp("B")/requestStepUp("E")/g' "$f"
sed -i 's/await postJson(/await send(/g' "$f"
sed -i 's/  const { requestStepUp } = useStepUp();/&\n  const send = useStepUpPost();/' "$f"
sed -i 's#^import { postJson, resolveErrorKey } from "./shared";#import { resolveErrorKey } from "./shared";\nimport { useStepUpPost } from "@/components/admin/useStepUpPost";#' "$f"
grep -c 'const send = useStepUpPost();' "$f"; grep -c 'postJson' "$f"
```

Expected: `3` then `0`.

Then put Delete back on Tier B. Replace:

```tsx
    if ((await requestStepUp("E")) !== "ok") return;
    setDeleteBusy(true);
```

with:

```tsx
    // Deleting a recipe is destructive: it prompts every time (Tier B), never the edit window.
    if ((await requestStepUp("B")) !== "ok") return;
    setDeleteBusy(true);
```

- [ ] **Step 6: SKU create (catalog and vendor card)**

In `components/admin/skus/SkuCatalogClient.tsx`, add after `import { useStepUp } from "@/components/admin/StepUpProvider";`:

```tsx
import { useStepUpPost } from "@/components/admin/useStepUpPost";
```

Replace `  const { requestStepUp } = useStepUp();` with:

```tsx
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
```

In `create`, replace:

```tsx
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    // Atomic add: identity + optional starter/edited chain in ONE request.
    const result = await postJson("/api/admin/skus", { ...values, chain });
```

with:

```tsx
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    // Atomic add: identity + optional starter/edited chain in ONE request.
    const result = await send("/api/admin/skus", { ...values, chain });
```

In `components/admin/skus/VendorSkusCard.tsx`, add the same `useStepUpPost` import after its `useStepUp` import. Replace `  const { requestStepUp } = useStepUp();` with the same two lines. Then replace:

```tsx
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    // Atomic add: identity + optional starter chain in ONE request (matches catalog).
    const result = await postJson("/api/admin/skus", { ...values, vendorId, chain });
```

with:

```tsx
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    // Atomic add: identity + optional starter chain in ONE request (matches catalog).
    const result = await send("/api/admin/skus", { ...values, vendorId, chain });
```

- [ ] **Step 7: Sold-directly, weights, product create**

`components/admin/items/ItemRow.tsx`: add `import { useStepUpPost } from "@/components/admin/useStepUpPost";` after its `useStepUp` import. Replace `  const { requestStepUp } = useStepUp();` with the same two lines as Step 6. Then replace:

```tsx
    if ((await requestStepUp("B")) !== "ok") return;
    setSavingSoldDirect(true);
    const result = await postJson(
      `/api/admin/items/${item.itemId}/sold-directly`,
```

with:

```tsx
    if ((await requestStepUp("E")) !== "ok") return;
    setSavingSoldDirect(true);
    const result = await send(
      `/api/admin/items/${item.itemId}/sold-directly`,
```

`components/admin/weights/WeightBoardClient.tsx`: add the same import and the same two-line replacement of `  const { requestStepUp } = useStepUp();`. Then replace:

```tsx
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson("/api/admin/weights", {
```

with:

```tsx
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const result = await send("/api/admin/weights", {
```

and change the comment `/** Commit the session: step-up B → POST → refresh. */` to `/** Commit the session: the edit window (Tier E) → POST → refresh. */`.

`components/admin/products/ProductsClient.tsx`:

```bash
cd /c/Users/conta/co-ops-guides
f=components/admin/products/ProductsClient.tsx
sed -i 's/tier: "A" | "B"/tier: StepUpTier/g' "$f"
grep -c 'tier: StepUpTier' "$f"
```

Expected: `8`. Then add after `import { postJson, resolveErrorKey } from "./shared";`:

```tsx
import type { StepUpTier } from "@/lib/admin/step-up-shared";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
```

Replace `  const { requestStepUp } = useStepUp();` with:

```tsx
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();
```

In `mutate`, replace `    const result = await postJson(url, body, method);` with `    const result = await send(url, body, method);`. In the create-product submit, replace `    const ok = await onMutate("B", "/api/admin/products", {` with `    const ok = await onMutate("E", "/api/admin/products", {`. Leave `onMutate("B", \`/api/admin/products/${product.id}/active\``, the retire action, unchanged.

- [ ] **Step 8: Menu price editor**

In `components/admin/menu-costing/MenuPriceEditor.tsx`, replace `  const { requestStepUp } = useStepUp();` with:

```tsx
  const { requestStepUp, forgetStepUp } = useStepUp();
```

Replace:

```tsx
      if (await requestStepUp("B") !== "ok") return;
```

with:

```tsx
      if (await requestStepUp("E") !== "ok") return;
```

Replace:

```tsx
      if ((body.code === "step_up_required" || body.code === "step_up_stale") && await requestStepUp("B") === "ok") {
```

with:

```tsx
      if (body.code === "step_up_required" || body.code === "step_up_stale") forgetStepUp();
      if ((body.code === "step_up_required" || body.code === "step_up_stale") && await requestStepUp("E") === "ok") {
```

- [ ] **Step 9: Write the law into `AGENTS.md`**

Insert this bullet as the last bullet of `### Auth & sessions`, right before the line `### Audit & append-only conventions`:

```markdown
- **Step-up has THREE tiers on ONE timestamp** (catalog Phase 1, 2026-10-15). `sessions.step_up_unlocked` + `step_up_unlocked_at` are stamped ONLY by `POST /api/auth/step-up` (`unlockStepUp`) and read ONLY by the pure `assertStepUp` (`lib/admin/step-up.ts`, logic in `lib/admin/step-up-shared.ts`): **A** = unlocked at any age · **B** = unlocked within 120 s (`ADMIN_STEP_UP_FRESH_SECONDS`), and the client ALWAYS prompts · **E** = the 15-minute catalog/recipe **edit window** (`ADMIN_STEP_UP_EDIT_WINDOW_SECONDS`, never shorter than B): the client skips the prompt while its copy of the unlock is inside the window minus 30 s, and the server re-checks the same timestamp on every write. **The window is FIXED from the password entry and never slides**: no write may touch `step_up_unlocked_at`, because sliding it would also satisfy Tier B without a password (`tests/step-up-edit-window-wiring.test.ts` pins the single writer). Every tier still clears when the actor leaves the step-up surface. **Retire a product and delete a recipe stay Tier B**; step-up is chosen per ROUTE, never by `DESTRUCTIVE_ACTIONS` membership. A client that gets `step_up_required`/`step_up_stale` back must `forgetStepUp()` (`useStepUpPost` does it), or it would keep proceeding on a stale memory. The tier map is pinned in `tests/step-up-tier-map.test.ts`.
```

- [ ] **Step 10: Run the tests**

Run: `npx vitest run tests/step-up-tier-map.test.ts tests/menu-prices-data.test.ts tests/menu-prices-ui.test.ts tests/step-up-edit-window-wiring.test.ts tests/yield-stats-server.test.ts tests/product-item-links-ui.test.ts`
Expected: PASS, 0 failed.

Run: `npx tsc --noEmit 2>&1 | grep -v "TS2307" | grep "error TS" | head`
Expected: no output (only the 6 known Leaflet TS2307 lines exist, and they are filtered).

- [ ] **Step 11: Commit**

```bash
git add -A app/api/admin components/admin tests AGENTS.md
git commit -F - <<'EOF'
feat(step-up): catalog and recipe edits ride the 15-minute window; retire and delete still prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 4: The pure recipe-line surface

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
  lineToRow,
  lineUnitChoices,
  parseRecipeLinePatch,
  recipeLineKind,
  type RecipeLineFields,
} from "@/lib/recipe-line-shared";
import type { RecipeInputView } from "@/lib/recipes-shared";

const sku = (over: Partial<RecipeLineFields> = {}): RecipeLineFields => ({
  componentSkuId: "sku-ham", componentItemId: null, componentProductId: null,
  quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false, ...over,
});

describe("parseRecipeLinePatch — the wire shape of one whole line", () => {
  it("accepts a SKU line and normalises its text", () => {
    expect(parseRecipeLinePatch({ componentSkuId: " sku-1 ", quantity: 4, unit: " oz ", eachContainerLabel: "", portioned: true }))
      .toEqual({ ok: true, line: { componentSkuId: "sku-1", componentItemId: null, componentProductId: null, quantity: 4, unit: "oz", eachContainerLabel: null, portioned: true } });
  });

  it("an item line never carries a container label or portioned", () => {
    expect(parseRecipeLinePatch({ componentItemId: "item-1", quantity: 2, unit: "qt", eachContainerLabel: "bag", portioned: true }))
      .toEqual({ ok: true, line: { componentSkuId: null, componentItemId: "item-1", componentProductId: null, quantity: 2, unit: "qt", eachContainerLabel: null, portioned: false } });
  });

  it("a product line needs a unit (the measure-registry check itself is the server's)", () => {
    expect(parseRecipeLinePatch({ componentProductId: "p-1", quantity: 3 })).toEqual({ ok: false, code: "product_line_needs_measure_unit" });
    expect(parseRecipeLinePatch({ componentProductId: "p-1", quantity: 3, unit: "oz", portioned: true }))
      .toEqual({ ok: true, line: { componentSkuId: null, componentItemId: null, componentProductId: "p-1", quantity: 3, unit: "oz", eachContainerLabel: null, portioned: true } });
  });

  it("exactly one target", () => {
    expect(parseRecipeLinePatch({ quantity: 1 })).toEqual({ ok: false, code: "invalid_component" });
    expect(parseRecipeLinePatch({ componentSkuId: "a", componentItemId: "b", quantity: 1 })).toEqual({ ok: false, code: "invalid_component" });
  });

  it("quantity is a positive finite NUMBER", () => {
    for (const quantity of ["4", 0, -1, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(parseRecipeLinePatch({ componentSkuId: "a", quantity })).toEqual({ ok: false, code: "invalid_quantity" });
    }
  });

  it("refuses non-objects and wrongly-typed fields", () => {
    for (const raw of [null, [], "x", 3]) expect(parseRecipeLinePatch(raw)).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeLinePatch({ componentSkuId: 5, quantity: 1 })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeLinePatch({ componentSkuId: "  ", quantity: 1 })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeLinePatch({ componentSkuId: "a", quantity: 1, unit: 3 })).toEqual({ ok: false, code: "invalid_payload" });
    expect(parseRecipeLinePatch({ componentSkuId: "a", quantity: 1, portioned: "yes" })).toEqual({ ok: false, code: "invalid_payload" });
  });
});

describe("row ↔ line and the diff", () => {
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
  const measures = ["each", "lb", "oz"];

  it("a PRODUCT line offers measure units only, never a vendor's pack label (D3)", () => {
    expect(lineUnitChoices("product", pack, measures, "case")).toEqual(["each", "lb", "oz"]);
  });

  it("a SKU line keeps its own unit first, then its pack labels, then the measures, without duplicates", () => {
    expect(lineUnitChoices("sku", pack, measures, "log")).toEqual(["log", "case", "bag", "lb", "each", "oz"]);
    expect(lineUnitChoices("sku", { packFormat: " ", eachContainerLabel: null, eachMeasure: null }, measures, null)).toEqual(["each", "lb", "oz"]);
  });

  it("a prep-item line keeps its free-text unit (null = no list)", () => {
    expect(lineUnitChoices("item", null, measures, "qt")).toBeNull();
  });
});

describe("lineDraftFromView", () => {
  it("carries the line and its name from the builder's view", () => {
    const view = {
      id: "line-1", componentSkuId: "sku-ham", componentItemId: null, componentProductId: null,
      componentName: "Ham", kind: "sku", componentRetired: false, quantity: 4, unit: "oz",
      eachContainerLabel: null, portioned: false, displayOrder: 1,
    } satisfies RecipeInputView;
    expect(lineDraftFromView(view)).toEqual({ ...sku(), componentName: "Ham" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/recipe-line-shared.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/recipe-line-shared"`.

- [ ] **Step 3: Create `lib/recipe-line-shared.ts`**

```ts
/**
 * Recipe LINE (one recipe_inputs row) — CLIENT-SAFE pure surface (catalog redesign
 * Phase 1, 2026-10-15). Used by the edit route (parse), the lib (row ↔ line, diff, audit
 * shape) and the builder (unit choices, the "nothing changed" check), so all three agree
 * on what a line IS and when it changed.
 *
 * A PATCH carries the WHOLE new line, not a partial: a swap of the ingredient changes
 * which of the three target columns is set, and a partial patch cannot say "clear the
 * other two" without inventing a second spelling for null.
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

/** Trimmed text, or null for absent/blank — the same rule lib/recipes.ts normStr applies at insert. */
export function normLineText(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

const isAbsent = (v: unknown) => v === undefined || v === null;

export function parseRecipeLinePatch(raw: unknown): RecipeLineParse {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, code: "invalid_payload" };
  const b = raw as Record<string, unknown>;
  for (const id of [b.componentSkuId, b.componentItemId, b.componentProductId]) {
    if (!isAbsent(id) && (typeof id !== "string" || id.trim() === "")) return { ok: false, code: "invalid_payload" };
  }
  for (const text of [b.unit, b.eachContainerLabel]) {
    if (!isAbsent(text) && typeof text !== "string") return { ok: false, code: "invalid_payload" };
  }
  if (!isAbsent(b.portioned) && typeof b.portioned !== "boolean") return { ok: false, code: "invalid_payload" };

  const skuId = typeof b.componentSkuId === "string" ? b.componentSkuId.trim() : null;
  const itemId = typeof b.componentItemId === "string" ? b.componentItemId.trim() : null;
  const productId = typeof b.componentProductId === "string" ? b.componentProductId.trim() : null;
  const count = [skuId, itemId, productId].filter((v) => v !== null).length;
  if (count !== 1) return { ok: false, code: "invalid_component" };

  const q = b.quantity;
  if (typeof q !== "number" || !Number.isFinite(q) || q <= 0) return { ok: false, code: "invalid_quantity" };

  const unit = normLineText(b.unit as string | null | undefined);
  if (productId !== null && unit === null) return { ok: false, code: "product_line_needs_measure_unit" };

  return {
    ok: true,
    line: {
      componentSkuId: skuId,
      componentItemId: itemId,
      componentProductId: productId,
      quantity: q,
      unit,
      // A container label is a SKU's own word; an item or product line never carries one.
      eachContainerLabel: skuId !== null ? normLineText(b.eachContainerLabel as string | null | undefined) : null,
      // Portioning is a bought-ingredient idea; a prep-item line is never portioned (the add form never offered it).
      portioned: itemId !== null ? false : b.portioned === true,
    },
  };
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
 * PRODUCT: measure-registry labels only (deviation D3 — a pack label means a different
 * thing per vendor). SKU: the line's current unit first (an edit never silently changes
 * it), then the SKU's own pack labels, then the measure registry (ozForRecipeInput step 3
 * resolves "oz"/"each"/… for any SKU).
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
```

- [ ] **Step 4: Run it**

Run: `npx vitest run tests/recipe-line-shared.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add lib/recipe-line-shared.ts tests/recipe-line-shared.test.ts
git commit -F - <<'EOF'
feat(recipes): pure recipe-line surface — parse, diff, row mapping, unit choices

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 5: `updateRecipeInput` — one validator for add and edit, an in-place UPDATE, a full audit row

**Files:**
- Modify: `lib/recipes.ts`
- Modify: `lib/destructive-actions.ts`, `lib/audit-actions.ts`, `lib/dynamic-pars.ts`
- Test: `tests/recipe-line-edit-server.test.ts` (lib half; Task 6 adds the route half)

- [ ] **Step 1: Write the failing test**

Create `tests/recipe-line-edit-server.test.ts`:

```ts
/**
 * Catalog Phase 1 — editing a recipe line in place (lib/recipes.ts updateRecipeInput).
 * The database is a hand-rolled fake that knows only recipe_inputs: every case is a SKU
 * line, so the product/item validators (which read other tables) are never reached.
 * Those rules belong to the add path too, shared through assertInputLineIsValid.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

const mocks = vi.hoisted(() => ({ audit: vi.fn(), session: vi.fn(), step: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: mocks.step }));

import { updateRecipeInput } from "@/lib/recipes";
import { isDestructive } from "@/lib/destructive-actions";
import { NON_DESTRUCTIVE_ACTIONS } from "@/lib/audit-actions";
import type { RecipeLineFields } from "@/lib/recipe-line-shared";

const RECIPE = "recipe-1";
const LINE = "line-1";
const gm = { user: { id: "u-gm", role: "gm" }, session: { stepUpUnlocked: true, stepUpUnlockedAt: new Date().toISOString() } } as unknown as AuthContext;
const agm = { user: { id: "u-agm", role: "agm" } } as unknown as AuthContext;

let row: Record<string, unknown> | null;
let updatedRows: Array<{ id: string }>;
let patches: unknown[];

beforeEach(() => {
  vi.clearAllMocks();
  row = {
    id: LINE, recipe_id: RECIPE, component_sku_id: "sku-ham", component_item_id: null, component_product_id: null,
    quantity: "4", unit: "oz", each_container_label: null, portioned: false,
  };
  updatedRows = [{ id: LINE }];
  patches = [];
  mocks.from.mockImplementation((table: string) => {
    if (table !== "recipe_inputs") throw new Error(`unexpected table ${table}`);
    const read = { select: () => read, eq: () => read, maybeSingle: async () => ({ data: row, error: null }) };
    return {
      select: () => read,
      update: (patch: unknown) => {
        patches.push(patch);
        const write = { eq: () => write, select: async () => ({ data: updatedRows, error: null }) };
        return write;
      },
    };
  });
  mocks.step.mockReturnValue({ ok: true });
});

const line = (over: Partial<RecipeLineFields> = {}): RecipeLineFields => ({
  componentSkuId: "sku-ham", componentItemId: null, componentProductId: null,
  quantity: 4, unit: "oz", eachContainerLabel: null, portioned: false, ...over,
});
const edit = (actor: AuthContext, l: RecipeLineFields) => updateRecipeInput(actor, { recipeId: RECIPE, inputId: LINE, line: l });

describe("updateRecipeInput — the lib is the authority", () => {
  it("refuses below GM before any database work", async () => {
    await expect(edit(agm, line({ quantity: 5 }))).rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("refuses two targets or a zero quantity before any database work", async () => {
    await expect(edit(gm, line({ componentItemId: "item-1" }))).rejects.toMatchObject({ status: 400, code: "invalid_component" });
    await expect(edit(gm, line({ quantity: 0 }))).rejects.toMatchObject({ status: 400, code: "invalid_quantity" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("a line that is not on this recipe is 404 edge_not_found and writes nothing", async () => {
    row = null;
    await expect(edit(gm, line({ quantity: 5 }))).rejects.toMatchObject({ status: 404, code: "edge_not_found" });
    expect(patches).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("an edit that changes nothing writes nothing and audits nothing", async () => {
    await expect(edit(gm, line())).resolves.toEqual({ changed: false });
    expect(patches).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("updates IN PLACE and audits recipe_input.update with the whole before and after line", async () => {
    await expect(edit(gm, line({ quantity: 5 }))).resolves.toEqual({ changed: true });
    expect(patches).toEqual([{
      component_sku_id: "sku-ham", component_item_id: null, component_product_id: null,
      quantity: 5, unit: "oz", each_container_label: null, portioned: false,
    }]);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit.mock.calls[0]![0]).toMatchObject({
      actorId: "u-gm", action: "recipe_input.update", resourceTable: "recipe_inputs", resourceId: LINE,
      metadata: {
        recipe_id: RECIPE, changed_fields: ["quantity"],
        before: { component_sku_id: "sku-ham", quantity: 4, unit: "oz" },
        after: { component_sku_id: "sku-ham", quantity: 5, unit: "oz" },
      },
    });
  });

  it("swapping the ingredient is ONE update that sets the new target and clears nothing else wrongly", async () => {
    await expect(edit(gm, line({ componentSkuId: "sku-turkey", unit: "lb" }))).resolves.toEqual({ changed: true });
    expect(patches).toEqual([expect.objectContaining({ component_sku_id: "sku-turkey", component_item_id: null, component_product_id: null, unit: "lb" })]);
    expect(mocks.audit.mock.calls[0]![0].metadata.changed_fields).toEqual(["componentSkuId", "unit"]);
  });

  it("an UPDATE that matched no row (raced away) is 404, never a silent success", async () => {
    updatedRows = [];
    await expect(edit(gm, line({ quantity: 5 }))).rejects.toMatchObject({ status: 404, code: "edge_not_found" });
    expect(mocks.audit).not.toHaveBeenCalled();
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
Expected: FAIL. TypeScript/vitest reports `updateRecipeInput` is not exported (`is not a function`), and the registry test fails at `isDestructive("recipe_input.update")` → `false`.

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

In `lib/audit-actions.ts`, delete the line `  "recipe_input.update",` from `NON_DESTRUCTIVE_ACTIONS`, the one directly after `  "recipe.input_unit_normalize",`.

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

- [ ] **Step 4: Add the shared validator and `updateRecipeInput` to `lib/recipes.ts`**

Add after the `@/lib/recipes-shared` import block (before `// Client-safe surface lives in…`):

```ts
import {
  diffRecipeLine,
  lineFromRow,
  lineToRow,
  type RecipeLineFields,
  type RecipeLineRow,
} from "@/lib/recipe-line-shared";
```

Add this function directly after `componentTargets` (before `/** List recipes (>=6)…`). The cycle guard calls `itemConsumesTransitively`, a hoisted `async function` declaration defined further down the file:

```ts
/**
 * ONE validator for a line about to be written — shared by addRecipeInput and
 * updateRecipeInput (catalog Phase 1), so an edit can never author what an add would refuse.
 *  · a PRODUCT line: an active product measured in an active registry unit (D3, above);
 *  · an ITEM line: must not make this recipe consume its own output, directly or through a
 *    chain of prep recipes. createRecipeFull always had this guard; addRecipeInput did not,
 *    so a single added line could close a loop the flatten then had to survive. It reads
 *    the recipe's item outputs and walks the item graph once per output (normally one).
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
 * Edit ONE recipe line in place (catalog redesign Phase 1, 2026-10-15): quantity, unit, and
 * the ingredient itself (any of the three targets).
 *
 * THE STORAGE RULE. recipe_inputs rows are CONFIG EDGES, not history: the table has no
 * active/superseded columns, a removal is a hard DELETE whose before-row rides the audit
 * (removeRecipeEdge), and nothing keys on a line's id — production_inputs snapshot the SKU
 * and the ounces of each batch (0102), so editing a line can never rewrite a past batch,
 * count or sale. The history of a line therefore lives in audit_log, exactly as it already
 * does for add and remove: an in-place UPDATE whose audit row carries the WHOLE before and
 * after line. Seeds 22/25/32 already edit lines this way under the same action name.
 * Supersede-and-insert would need a migration and a filter in every graph reader for no
 * history the audit row does not already hold.
 *
 * SAME RULES AS addRecipeInput through the same validator (assertInputLineIsValid). An edit
 * that changes nothing writes nothing and audits nothing. The UPDATE is rowcount-checked
 * (AGENTS.md: UPDATE denials are silent), scoped to (id, recipe_id) so a line id from
 * another recipe is a 404, never a cross-recipe write.
 */
export async function updateRecipeInput(
  actor: AuthContext,
  input: { recipeId: string; inputId: string; line: RecipeLineFields },
): Promise<{ changed: boolean }> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  const { line } = input;
  if (componentTargets(line).count !== 1) throw new RecipeError(400, "invalid_component");
  if (!(Number.isFinite(line.quantity) && line.quantity > 0)) throw new RecipeError(400, "invalid_quantity");
  const sb = getServiceRoleClient();

  const { data: beforeRow, error: readErr } = await sb
    .from("recipe_inputs")
    .select("id, recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned")
    .eq("id", input.inputId)
    .eq("recipe_id", input.recipeId)
    .maybeSingle<RecipeLineRow & { id: string; recipe_id: string }>();
  if (readErr) throw new Error(`updateRecipeInput read: ${readErr.message}`);
  if (!beforeRow) throw new RecipeError(404, "edge_not_found");

  const before = lineFromRow(beforeRow);
  const changed = diffRecipeLine(before, line);
  if (changed.length === 0) return { changed: false };

  await assertInputLineIsValid(sb, input.recipeId, line);

  const { data: updated, error } = await sb
    .from("recipe_inputs")
    .update(lineToRow(line))
    .eq("id", input.inputId)
    .eq("recipe_id", input.recipeId)
    .select("id");
  if (error) throw new Error(`updateRecipeInput: ${error.message}`);
  if (!updated || updated.length === 0) throw new RecipeError(404, "edge_not_found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "recipe_input.update",
    resourceTable: "recipe_inputs",
    resourceId: input.inputId,
    metadata: { recipe_id: input.recipeId, changed_fields: changed, before: lineToRow(before), after: lineToRow(line) },
    ipAddress: null,
    userAgent: null,
  });
  return { changed: true };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/recipe-line-edit-server.test.ts tests/audit-actions.test.ts tests/recipe-line-shared.test.ts`
Expected: PASS, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add lib/recipes.ts lib/destructive-actions.ts lib/audit-actions.ts lib/dynamic-pars.ts tests/recipe-line-edit-server.test.ts
git commit -F - <<'EOF'
feat(recipes): edit a recipe line in place — one validator with add, full before/after audit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 6: `PATCH /api/admin/recipes/[id]/inputs/[inputId]`

**Files:**
- Create: `app/api/admin/recipes/[id]/inputs/[inputId]/route.ts`
- Modify: `components/admin/recipes/shared.ts`
- Modify: `tests/recipe-line-edit-server.test.ts`, `tests/step-up-tier-map.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/recipe-line-edit-server.test.ts`, add these two imports at the top, directly after `import { updateRecipeInput } from "@/lib/recipes";`. The `vi.mock` calls above them are hoisted, so the route sees the mocks.

```ts
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/admin/recipes/[id]/inputs/[inputId]/route";
```

Then append this block at the end of the file:

```ts
describe("PATCH /api/admin/recipes/[id]/inputs/[inputId]", () => {
  const call = (body: unknown) =>
    PATCH(
      new NextRequest(`http://localhost/api/admin/recipes/${RECIPE}/inputs/${LINE}`, { method: "PATCH", body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: RECIPE, inputId: LINE }) },
    );
  const body = { componentSkuId: "sku-ham", quantity: 5, unit: "oz" };

  it("401 without a session", async () => {
    mocks.session.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await call(body)).status).toBe(401);
  });

  it("403 below GM, before the step-up check", async () => {
    mocks.session.mockResolvedValue(agm);
    expect((await call(body)).status).toBe(403);
    expect(mocks.step).not.toHaveBeenCalled();
  });

  it("asks for the Tier E edit window and stops on a stale unlock", async () => {
    mocks.session.mockResolvedValue(gm);
    mocks.step.mockReturnValue({ ok: false, code: "step_up_stale" });
    const res = await call(body);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("step_up_stale");
    expect(mocks.step).toHaveBeenCalledWith(gm, "E");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("400 on a malformed line, before any database work", async () => {
    mocks.session.mockResolvedValue(gm);
    const res = await call({ componentSkuId: "sku-ham", quantity: 0 });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_quantity");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("200 { changed: true } on a real edit", async () => {
    mocks.session.mockResolvedValue(gm);
    const res = await call(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: true });
  });
});
```

In `tests/step-up-tier-map.test.ts` `SERVER_TIER_MAP`, add after the `"app/api/admin/recipes/[id]/inputs/route.ts": ["E"],` entry:

```ts
  // Catalog Phase 1: edit one recipe line in place.
  "app/api/admin/recipes/[id]/inputs/[inputId]/route.ts": ["E"],
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/recipe-line-edit-server.test.ts tests/step-up-tier-map.test.ts`
Expected: FAIL. `Failed to resolve import "@/app/api/admin/recipes/[id]/inputs/[inputId]/route"`, and the server-half map is missing the new route.

- [ ] **Step 3: Create `app/api/admin/recipes/[id]/inputs/[inputId]/route.ts`**

```ts
/**
 * PATCH /api/admin/recipes/[id]/inputs/[inputId] — edit ONE recipe line in place
 * (catalog redesign Phase 1, 2026-10-15). Body: the WHOLE new line
 * { componentSkuId | componentItemId | componentProductId, quantity, unit?, eachContainerLabel?, portioned? }.
 * GM+ (RECIPE_WRITE_MIN) and the Tier E edit window; the lib re-checks the level and every
 * line rule (lib/recipes.ts updateRecipeInput). 200 { ok, changed } — changed:false means the
 * line already said exactly that and nothing was written.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { updateRecipeInput, RecipeError, RECIPE_WRITE_MIN } from "@/lib/recipes";
import { parseRecipeLinePatch } from "@/lib/recipe-line-shared";

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

  const line = parseRecipeLinePatch(parsed);
  if (!line.ok) return jsonError(400, line.code);

  try {
    const result = await updateRecipeInput(ctx, { recipeId: id, inputId, line: line.line });
    return jsonOk({ ok: true, changed: result.changed });
  } catch (e) {
    if (e instanceof RecipeError) return jsonError(e.status, e.code);
    throw e;
  }
}
```

- [ ] **Step 4: Give the two product-line codes their own messages**

In `components/admin/recipes/shared.ts`, add to `KNOWN_ERROR_CODES`, after `"invalid_shelf_life_days",`:

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
feat(recipes): PATCH one recipe line behind the edit window

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 7: The pure ingredient picker

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
 * Searchable ingredient picker — CLIENT-SAFE pure half (catalog redesign Phase 1,
 * 2026-10-15). Replaces three unsearchable <select>s (every SKU, every item, every product)
 * with ONE list a manager can type into on a phone: name · vendor · kind.
 *
 * Search is accent-blind and case-blind, and every typed word must appear in the name or the
 * vendor name ("ham baldor"). Ranking: the name STARTS with the whole query, then any word of
 * the name starts with the first word, then anywhere; ties sort by name, kind (product, SKU,
 * item — the product is the vendor-proof pin), vendor, id.
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
feat(recipes): pure searchable ingredient picker (name · vendor · kind, accent-blind, ranked)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 8: One loader for both recipe pages; SKUs carry their vendor's name

**Files:**
- Create: `lib/admin/recipe-builder-data.ts`
- Rewrite: `app/admin/recipes/[id]/page.tsx`, `app/admin/recipes/new/page.tsx`
- Modify: `components/admin/recipes/RecipeBuilder.tsx` (the `RecipeBuilderSku` type)

This task is DB-coupled loader code. It is verified by `tsc` here and on the sim in Task 16. There is no unit test, per the spine's pure-only rule.

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
 * are not inventory-only (packaging/cleaning never belong in a recipe), active items, ACTIVE
 * products (load-bearing — a retired product refuses at the resolution ladder, Juan's ruling
 * A+, and lib/recipes.ts assertProductLineIsValid refuses the write anyway), the units
 * registry and the measure registry. New: each SKU carries its vendor's NAME so the
 * searchable ingredient picker can say "Ham · Baldor · SKU".
 *
 * Errors keep the pages' old posture — a failed read yields an empty list and the matching
 * affordance has nothing to offer — and a failed vendors read only drops the names.
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

## Task 9: `IngredientPicker` + `RecipeLineEditor` components and their strings

**Files:**
- Create: `components/admin/recipes/IngredientPicker.tsx`
- Create: `components/admin/recipes/RecipeLineEditor.tsx`
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`
- Test: `tests/ingredient-picker-ui.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ingredient-picker-ui.test.ts`:

```ts
/** Catalog Phase 1 — the picker renders as an accessible combobox with 44px rows, in en and es. */
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
});

describe("every new string exists in en AND es", () => {
  const keys = [
    "recipes.builder.add_ingredient", "recipes.builder.add_ingredient_title",
    "recipes.picker.label", "recipes.picker.placeholder", "recipes.picker.results", "recipes.picker.no_matches",
    "recipes.picker.more", "recipes.picker.no_vendor", "recipes.picker.change", "recipes.picker.change_aria",
    "recipes.picker.kind.sku", "recipes.picker.kind.item", "recipes.picker.kind.product",
    "recipes.input.sku_unit_unresolved",
    "recipes.row.edit", "recipes.row.edit_aria", "recipes.row.edit_title", "recipes.row.save_changes",
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

In `lib/i18n/en.json`, insert right after the line `  "recipes.row.cancel": "Cancel",`:

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

In `lib/i18n/es.json`, insert right after the line `  "recipes.row.cancel": "Cancelar",`:

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
 * An ARIA 1.2 combobox: type to filter (lib/ingredient-picker-shared.ts), ↑/↓ to move,
 * Enter to choose, Escape to close back to the current choice. Options are 44px rows that
 * work by tap (mousedown keeps focus in the input so a tap never blurs the list away).
 * The list flows in the page (no absolute overlay), so it never clips at phone width; rows
 * truncate long names instead of widening the page.
 */
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import {
  filterIngredientOptions,
  INGREDIENT_RESULT_LIMIT,
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
      setActive((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
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
 * RecipeLineEditor — ONE form for adding a recipe line AND editing one in place (catalog
 * redesign Phase 1, 2026-10-15). Replaces the three per-kind add forms and their
 * unsearchable selects: the ingredient comes from the searchable IngredientPicker (SKUs,
 * prep items and products together), then qty + unit.
 *
 * The unit rules are the server's, offered up front so an author cannot author a refusal
 * (lib/recipe-line-shared.ts lineUnitChoices): a PRODUCT line offers measure-registry units
 * only (D3); a SKU line offers its own pack labels plus the measure registry and keeps the
 * line's current unit first; a prep-item line keeps its free-text unit. The server re-checks
 * every rule (lib/recipes.ts assertInputLineIsValid).
 *
 * Edit mode disables Save until something changed (diffRecipeLine — the same pure function
 * the server uses to decide whether to write).
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

## Task 10: Wire the builder — edit a line in place, add with the picker

**Files:**
- Modify: `components/admin/recipes/RecipeBuilder.tsx` (replace the CONSUMES section)
- Modify: `components/admin/recipes/RecipeInputRow.tsx`
- Test: `tests/recipe-line-edit-ui.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/recipe-line-edit-ui.test.ts`:

```ts
/** Catalog Phase 1 — the builder edits a line in place and picks ingredients by search. Source pins. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");
const builder = read("components/admin/recipes/RecipeBuilder.tsx");
const consumes = builder.slice(builder.indexOf("function ConsumesSection"), builder.indexOf("function DraftInputRow"));

describe("CONSUMES — one searchable picker, one line form", () => {
  it("the three unsearchable selects (every SKU / item / product) are gone from the line form", () => {
    expect(consumes).not.toContain("skus.map((s) => (<option");
    expect(consumes).not.toContain("items.map((i) => (<option");
    expect(consumes).not.toContain("products.map((p) => (<option");
    expect(consumes).toContain("buildIngredientOptions(");
    expect(consumes.match(/<RecipeLineEditor/g)).toHaveLength(2); // add + edit
  });

  it("a live line is edited IN PLACE through PATCH …/inputs/[inputId], behind the edit window", () => {
    const lane = consumes.slice(consumes.indexOf("const submitEdit"));
    expect(lane).toContain("/inputs/${inputId}`");
    expect(lane).toContain('"PATCH"');
    expect(lane.indexOf('requestStepUp("E")')).toBeGreaterThan(-1);
    expect(lane.indexOf('requestStepUp("E")')).toBeLessThan(lane.indexOf("send("));
  });

  it("a live add also asks for the edit window; a draft add writes nothing and asks for nothing", () => {
    const lane = consumes.slice(consumes.indexOf("const submitAdd"), consumes.indexOf("const submitEdit"));
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
Expected: FAIL. The selects are still present, `<RecipeLineEditor` is matched 0 times, and there is no `submitEdit` or `onEdit`.

- [ ] **Step 3: Add the Edit button to `RecipeInputRow.tsx`**

In the docstring, replace ` * RecipeInputRow — one existing recipe_input edge with a remove (✕) button.` with:

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

- [ ] **Step 4: Add the imports to `RecipeBuilder.tsx`**

Replace `import { useState } from "react";` with `import { useMemo, useState } from "react";`.

Add after `import { useStepUpPost } from "@/components/admin/useStepUpPost";` (added in Task 3):

```tsx
import { buildIngredientOptions } from "@/lib/ingredient-picker-shared";
import { lineDraftFromView, recipeLineKind, type RecipeLineDraft } from "@/lib/recipe-line-shared";
import { RecipeLineEditor } from "./RecipeLineEditor";
```

- [ ] **Step 5: Replace the CONSUMES section**

Save the block below to a temporary file outside the repo (for example `$TEMP/consumes-section.txt`). Then splice it in. The splice replaces everything from the line starting `// ── CONSUMES section` up to, not including, the line starting `// ── DraftInputRow`:

```bash
cd /c/Users/conta/co-ops-guides
node -e '
const fs = require("fs");
const p = "components/admin/recipes/RecipeBuilder.tsx";
const s = fs.readFileSync(p, "utf8");
const a = s.indexOf("// ── CONSUMES section");
const b = s.indexOf("// ── DraftInputRow");
if (a < 0 || b < 0 || b < a) throw new Error("anchors not found");
fs.writeFileSync(p, s.slice(0, a) + fs.readFileSync(process.argv[1], "utf8") + s.slice(b));
' "$TEMP/consumes-section.txt"
```

The block (it ends with a blank line):

```tsx
// ── CONSUMES section ─────────────────────────────────────────────────────────
// ONE add/edit form for all three kinds (catalog redesign Phase 1, 2026-10-15): the
// searchable IngredientPicker replaced the three per-kind forms and their unsearchable
// selects, and a live line is edited IN PLACE (PATCH …/inputs/[inputId]) instead of
// delete + re-add. Draft rows stay remove-only: they are local until the recipe saves.
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
  onRemoveLive: (id: string) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const send = useStepUpPost();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Disclosure (D3: PRIMARY work section → default-open; D10: locked open while a form is
  // in progress so the dirty line stays mounted).
  const [sectionOpen, setSectionOpen] = useState(true);
  const formInProgress = adding || editingId !== null;
  const isOpen = sectionOpen || formInProgress;

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

  const closeForms = () => {
    setAdding(false);
    setEditingId(null);
    setErrorMsg(null);
  };

  const submitAdd = async (line: RecipeLineDraft) => {
    if (busy) return;
    setErrorMsg(null);
    if (isDraft) {
      // A draft line is local until the whole recipe saves — that save asks for the window.
      onAddDraftInput({ kind: recipeLineKind(line), ...lineBody(line), componentName: line.componentName });
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

  const submitEdit = async (inputId: string, line: RecipeLineDraft) => {
    if (busy || !recipeId) return;
    setErrorMsg(null);
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const result = await send(`/api/admin/recipes/${recipeId}/inputs/${inputId}`, lineBody(line), "PATCH");
    setBusy(false);
    if (result.ok) { closeForms(); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
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

      {/* Live rows — each one edits in place */}
      {liveInputs.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {liveInputs.map((inp) =>
            editingId === inp.id ? (
              <RecipeLineEditor
                key={inp.id}
                title={t(rk("recipes.row.edit_title"))}
                submitLabel={t(rk("recipes.row.save_changes"))}
                options={options}
                skus={skus}
                products={products}
                measures={measures}
                initial={lineDraftFromView(inp)}
                busy={busy}
                errorMsg={errorMsg}
                onSubmit={(line) => void submitEdit(inp.id, line)}
                onCancel={closeForms}
              />
            ) : (
              <RecipeInputRow
                key={inp.id}
                input={inp}
                canEdit={canEdit && !formInProgress}
                onEdit={() => { setAdding(false); setErrorMsg(null); setEditingId(inp.id); }}
                onRemove={onRemoveLive}
              />
            ),
          )}
        </div>
      ) : null}

      {/* Draft rows */}
      {draftInputs.length > 0 ? (
        <div className={`${liveInputs.length > 0 ? "mt-2" : "mt-3"} flex flex-col gap-2`}>
          {draftInputs.map((di) => (
            <DraftInputRow
              key={di._key}
              di={di}
              skus={skus}
              products={products}
              measures={measures}
              onRemove={() => onRemoveDraftInput(di._key)}
            />
          ))}
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
          ) : editingId === null ? (
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

```

- [ ] **Step 6: Run the tests and tsc**

Run: `npx vitest run tests/recipe-line-edit-ui.test.ts tests/step-up-tier-map.test.ts tests/ingredient-picker-ui.test.ts`
Expected: PASS, 0 failed. RecipeBuilder still maps to `["B","E"]`.

Run: `npx tsc --noEmit 2>&1 | grep -v TS2307 | grep "error TS"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add components/admin/recipes/RecipeBuilder.tsx components/admin/recipes/RecipeInputRow.tsx tests/recipe-line-edit-ui.test.ts
git commit -F - <<'EOF'
feat(recipes): edit recipe lines in place; add ingredients with the searchable picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 11: Deep-link builders that land on the item

**Files:**
- Modify: `lib/admin/product-item-links-shared.ts`
- Modify: `tests/product-item-links.test.ts`
- Test: `tests/catalog-deep-links.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/catalog-deep-links.test.ts`:

```ts
/** Catalog Phase 1 — deep links land on the exact item, never a whole list. */
import { describe, expect, it } from "vitest";
import { prepItemHref, productHref, readFocusParam, skuCatalogHref } from "@/lib/admin/product-item-links-shared";

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
Expected: FAIL. `skuCatalogHref is not a function` (the imports are undefined), and `/admin/skus#bacon` does not equal `/admin/skus?sku=bacon#bacon`.

- [ ] **Step 3: Add the builders to `lib/admin/product-item-links-shared.ts`**

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
 * 2026-10-15). The query param is read server-side to open/expand the row; the hash scrolls
 * to its anchor (every row carries id={its id} + scroll-mt-24). One builder per destination,
 * so every link to a SKU row is spelled once.
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

## Task 12: `/admin/skus?sku=` opens, rings and scrolls to the row; `?vendor=` preselects

**Files:**
- Modify: `app/admin/skus/page.tsx`
- Modify: `components/admin/skus/SkuCatalogClient.tsx`
- Modify: `tests/catalog-deep-links.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/catalog-deep-links.test.ts`, add these imports at the top, after the existing imports, and add the two helper constants right below them:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");
```

Then append this block at the end of the file:

```ts
describe("the SKU catalog honours the deep link", () => {
  it("the page reads ?sku= and ?vendor= and only focuses a SKU it actually loaded", () => {
    const page = read("app/admin/skus/page.tsx");
    expect(page).toContain("readFocusParam(sp.sku)");
    expect(page).toContain("readFocusParam(sp.vendor)");
    expect(page).toContain("skus.some((s) => s.id === focusParam)");
    expect(page).toContain("focusSkuId={focusSkuId}");
    expect(page).toContain("initialVendorFilter={vendorParam}");
  });

  it("the client expands, rings and scrolls to the focused row", () => {
    const client = read("components/admin/skus/SkuCatalogClient.tsx");
    expect(client).toContain("new Set(focusSkuId ? [focusSkuId] : [])");
    expect(client).toContain("scrollIntoView");
    expect(client).toContain('s.id === focusSkuId ? " rounded-lg ring-4 ring-co-gold/60" : ""');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/catalog-deep-links.test.ts`
Expected: FAIL. The 2 new tests fail on the missing strings.

- [ ] **Step 3: Read the params in `app/admin/skus/page.tsx`**

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

- [ ] **Step 4: Focus the row in `components/admin/skus/SkuCatalogClient.tsx`**

Replace `import { useMemo, useState } from "react";` with `import { useEffect, useMemo, useState } from "react";`.

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
  /** ?vendor=<id> deep link: preselect the vendor filter (ignored when a SKU is focused). */
  initialVendorFilter?: string | null;
}) {
```

Replace:

```tsx
  const [vendorFilter, setVendorFilter] = useState<string>(FILTER_ALL);
```

with:

```tsx
  const [vendorFilter, setVendorFilter] = useState<string>(() =>
    !focusSkuId && initialVendorFilter && vendors.some((v) => v.id === initialVendorFilter)
      ? initialVendorFilter
      : FILTER_ALL,
  );
```

Replace:

```tsx
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
```

with:

```tsx
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(focusSkuId ? [focusSkuId] : []));
  // The hash already scrolls on a full load; this covers a client-side Link navigation too.
  useEffect(() => {
    if (!focusSkuId) return;
    document.getElementById(focusSkuId)?.scrollIntoView({ block: "start" });
  }, [focusSkuId]);
```

In `renderRow`, replace:

```tsx
        "scroll-mt-24 " + (s.active ? "" : "opacity-60")
```

with:

```tsx
        "scroll-mt-24 " + (s.active ? "" : "opacity-60") + (s.id === focusSkuId ? " rounded-lg ring-4 ring-co-gold/60" : "")
```

- [ ] **Step 5: Run the test and tsc**

Run: `npx vitest run tests/catalog-deep-links.test.ts`
Expected: PASS, 0 failed.

Run: `npx tsc --noEmit 2>&1 | grep -v TS2307 | grep "error TS"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add app/admin/skus/page.tsx components/admin/skus/SkuCatalogClient.tsx tests/catalog-deep-links.test.ts
git commit -F - <<'EOF'
feat(skus): ?sku= opens, rings and scrolls to the row; ?vendor= preselects the filter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

---

## Task 13: Rewire the links that landed on lists

Inventory (verified on `main`), and what this task does with each:

| Link | Today | After |
|---|---|---|
| Items catalog → the item's SKUs (`CatalogClient.tsx:376`) | `/admin/skus` with the names joined | One link per SKU → `skuCatalogHref(id)` |
| Vendor import "needs a person" (`lib/vendor-import.ts:212`) | `/admin/skus` | `skuCatalogHref(match.sku_id)`. The no-match fallback stays the vendor's order guide. |
| Vendor import table, needs-person row (`VendorImportPanel.tsx:131`) | `/admin/skus?vendor=…` (the param was never read) | The matched SKU's row; with no match, `?vendor=`, which Task 12 now honours |
| Registry relationships (items/products pages) | `/admin/skus#id` | `?sku=` + `#id` (Task 11, through `registryLinkHref`) |
| Costing board drawer: blocking SKUs, retired products, inconsistent/unweighed prep items | plain names | links to the SKU row / product / prep item |
| **Not done here:** the ordering walk's "check par" advisory | — | Deferred to Phase 2. The walk is a level-4+ 6 AM surface with no actor level in props. The par lives inside the SKU editor (Tier A, level 6+), and the spec's real destination is Phase 2's item page "Ordering" section. |
| **Not done here:** Items catalog → catering packages | `/admin/catering/packages` | Package rows have no anchors (catering, out of scope). |
| Readiness errands (SKU data lane, recipe readiness banner) | text only, already on the item's own row/page | No link needed. |

**Files:**
- Modify: `lib/admin/catalog-shared.ts`, `lib/admin/catalog.ts`, `components/admin/catalog/CatalogClient.tsx`
- Modify: `lib/vendor-import.ts`, `components/admin/vendors/VendorImportPanel.tsx`
- Modify: `components/admin/menu-costing/MenuCostingClient.tsx`
- Modify: `tests/catalog-deep-links.test.ts`

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

In `lib/admin/catalog-shared.ts`, replace:

```ts
  /** items: leaf SKU names (display-capped). */
  skuNames: string[];
```

with:

```ts
  /** items: leaf SKUs (display-capped) — each links to its own row in /admin/skus (catalog Phase 1). */
  skus: CatalogEdgeRef[];
```

In `lib/admin/catalog.ts`, replace:

```ts
    const skuNames = skuKeys.slice(0, SKU_NAME_CAP).map((k) => skuNameById.get(k) ?? "—");
```

with:

```ts
    const skus: CatalogEdgeRef[] = skuKeys.slice(0, SKU_NAME_CAP).map((k) => ({ id: k, name: skuNameById.get(k) ?? "—" }));
```

Then make three replacements in the same file:
- `        producedBy, build: null, skuNames, componentItems: [],` → `        producedBy, build: null, skus, componentItems: [],`
- `        producedBy: [], build: buildRef, skuNames: [], componentItems,` → `        producedBy: [], build: buildRef, skus: [], componentItems,`
- `        producedBy: [], build: null, skuNames: [], componentItems: [],` → `        producedBy: [], build: null, skus: [], componentItems: [],`

(`CatalogEdgeRef` is already imported in `lib/admin/catalog.ts`; the `packageRefs` and `edgeRefs` helpers return it.)

In `components/admin/catalog/CatalogClient.tsx`, add after `import { ITEM_TYPES, deriveRoleBadges } from "@/lib/admin/catalog-shared";`:

```tsx
import { skuCatalogHref } from "@/lib/admin/product-item-links-shared";
```

Replace:

```tsx
          {e.kind === "item" && (
            <EdgeList label={t("admin.catalog.edge.skus")}>
              {e.edges.skuNames.length > 0
                ? <Link href="/admin/skus" className={linkCls}>{e.edges.skuNames.join(", ")}</Link>
                : none}
            </EdgeList>
          )}
```

with:

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

In `lib/vendor-import.ts`, add after `import { buildPackChain, chainRootLabel, type PackChainLevel } from "@/lib/pack-chain-shared";`:

```ts
import { skuCatalogHref } from "@/lib/admin/product-item-links-shared";
```

Replace:

```ts
      href: o.match.sku_id ? "/admin/skus" : `/admin/vendors/${vendorId}#order-guide-${vendorId}` });
```

with:

```ts
      href: o.match.sku_id ? skuCatalogHref(o.match.sku_id) : `/admin/vendors/${vendorId}#order-guide-${vendorId}` });
```

In `components/admin/vendors/VendorImportPanel.tsx`, add after `import { resolveErrorKey } from "./shared";`:

```tsx
import { skuCatalogHref } from "@/lib/admin/product-item-links-shared";
```

Replace:

```tsx
href={`/admin/skus?vendor=${encodeURIComponent(vendorId)}`}
```

with:

```tsx
href={o.match.sku_id ? skuCatalogHref(o.match.sku_id) : `/admin/skus?vendor=${encodeURIComponent(vendorId)}`}
```

- [ ] **Step 5: Costing drawer**

In `components/admin/menu-costing/MenuCostingClient.tsx`, add after `import { SummaryRow } from "@/components/ui/SummaryRow";`:

```tsx
import { prepItemHref, productHref, skuCatalogHref } from "@/lib/admin/product-item-links-shared";
```

Add directly above `/** Group render order — mirrors the sort ranking in menu-costing-shared. */`:

```tsx
/** A name the drawer blames is a link to the place that fixes it (catalog Phase 1). 44px tap floor. */
const drawerLinkCls = "inline-flex min-h-[44px] items-center underline decoration-2 underline-offset-2 hover:text-co-gold-text";
```

Replace the `nameList` helper:

```tsx
  const nameList = (
    ids: string[],
    labelKey: TranslationKey,
    names: Record<string, { en: string; es: string | null }>,
    unknownKey: TranslationKey,
  ) => (
```

with:

```tsx
  const nameList = (
    ids: string[],
    labelKey: TranslationKey,
    names: Record<string, { en: string; es: string | null }>,
    unknownKey: TranslationKey,
    hrefFor: (id: string) => string,
  ) => (
```

and inside it replace:

```tsx
            <li key={id} className="text-xs font-medium text-co-text">
              {(language === "es" ? name?.es ?? name?.en : name?.en) ?? t(unknownKey)}
            </li>
```

with:

```tsx
            <li key={id} className="text-xs font-medium text-co-text">
              <a href={hrefFor(id)} className={drawerLinkCls}>
                {(language === "es" ? name?.es ?? name?.en : name?.en) ?? t(unknownKey)}
              </a>
            </li>
```

Replace:

```tsx
    nameList(ids, labelKey, itemNames, "admin.menu_costing.drawer.unknown_item");
```

with:

```tsx
    nameList(ids, labelKey, itemNames, "admin.menu_costing.drawer.unknown_item", prepItemHref);
```

Replace:

```tsx
            "admin.menu_costing.drawer.unknown_product",
          )}
```

with:

```tsx
            "admin.menu_costing.drawer.unknown_product",
            productHref,
          )}
```

Replace:

```tsx
              <li key={id} className="text-xs font-medium text-co-text">
                {skuNames[id] ?? t("admin.menu_costing.drawer.unknown_sku")}
              </li>
```

with:

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

## Task 14: The avg-weight dead end on chained SKUs

**Files:**
- Modify: `lib/admin/catalog-shared.ts` (add `chainNeedsAvgOzPerEach`)
- Modify: `components/admin/skus/SkuBuilder.tsx`
- Modify: `tests/sku-builder-shared.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/sku-builder-shared.test.ts`, add `chainNeedsAvgOzPerEach,` to the `@/lib/admin/catalog-shared` import list, after `defaultWizardLevelLabel,`. Append at the end of the file:

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

- [ ] **Step 3: Add `chainNeedsAvgOzPerEach` to `lib/admin/catalog-shared.ts`**

Add directly after the `StarterChainLevel` interface:

```ts
/**
 * Does this chain need the SKU's avg oz per each? (catalog Phase 1 — the avg-weight dead
 * end.) True exactly when the server's class-aware leaf law (lib/admin/pack-chain.ts) would
 * throw `leaf_needs_avg` for a missing avg: a RAW SKU whose chain ends in a REGISTERED
 * measure that is not a weight (count or volume). Non-raw classes are checked for structure
 * only, and an unregistered unit is the server's `unknown_measure` — a different errand.
 * Takes any level shape with `containsMeasureUnit` (editor payload rows or saved levels).
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

Replace the whole `saveChain`:

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

(The rest of `saveChain`, from `setChainBusy(false);` onward, is unchanged.)

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

## Task 15: Delete the dead `SkuPackChainPanel`

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
Expected: FAIL. The assertion expected `true` to be `false`.

- [ ] **Step 4: Delete the file and its tier-map entry**

```bash
cd /c/Users/conta/co-ops-guides && git rm components/admin/skus/SkuPackChainPanel.tsx
```

In `tests/step-up-tier-map.test.ts` `CLIENT_TIER_MAP`, delete the line:

```ts
  "components/admin/skus/SkuPackChainPanel.tsx": ["A"],
```

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

## Task 16: Full verification and the sim walk

- [ ] **Step 1: Run the whole unit spine**

Run: `npx vitest run`
Expected: every file passes, 0 failed. The count is the previous total plus the 9 new files.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exactly the 6 known pre-existing `TS2307` errors (Leaflet module typings) and nothing else.

- [ ] **Step 3: Production build** (CI runs it; `useSearchParams`/Suspense-class errors only show here)

Run: `npx next build`
Expected: `✓ Compiled successfully` and the route table lists `/api/admin/recipes/[id]/inputs/[inputId]`.

- [ ] **Step 4: Manual sim checklist** (http://localhost:3100, started with `node scripts/sim/dev-sim.mjs`; never prod)

Sign in as **Marcus Webb (GM)**, PIN and password from `scripts/sim/personas.md`. Use a phone-width window (390 px) for at least items 3, 5 and 7, then repeat 3 at desktop width.

1. **One unlock, 15 minutes.** Open `/admin/recipes`, then a recipe. Change the batch yield and tab out: the password prompt appears **once**. Change the name, add a line, remove a line, and edit a line: **no further prompts**. In Supabase (sim), `select action, metadata from audit_log where action = 'auth_step_up_success' order by occurred_at desc limit 1` shows `{"edit_window_seconds": 900}`.
2. **The server is the authority.** Still on the recipe, run in the sim SQL editor: `update sessions set step_up_unlocked_at = now() - interval '16 minutes' where user_id = '<Marcus id>' and revoked_at is null`. Edit a line: the save fails with "Your confirmation expired — confirm your password again." Tap Save again: the password prompt appears (the client forgot its unlock), and after the password the save lands.
3. **Searchable picker.** Tap "+ Add ingredient" and type `ham`. Rows read `name · vendor · kind`, each at least 44 px tall, and the page does not scroll sideways at 390 px. Arrow keys + Enter choose at desktop width; a tap chooses on the phone. Type a vendor name: only that vendor's SKUs remain. Type an accent-free spelling of an accented name: it still matches.
4. **Edit a line in place.** On a live line tap **Edit**. The picker shows the current ingredient and Save is disabled until something changes. Change qty → Save: the row updates in place, its position unchanged. Swap the ingredient to a product: the unit list shows registry units only. Swap to a prep item: the unit becomes free text and Portioned disappears. Check `audit_log` for `recipe_input.update` with `before`, `after`, `changed_fields` and `destructive = true`.
5. **Destructive acts still prompt.** Inside the 15 minutes, as a level-8+ sim account (MoO/owner; never a prod login): **Delete recipe** prompts for the password every time. On `/admin/products`, **Retire** prompts every time. As Marcus, creating a SKU (`/admin/skus` → Add SKU) and recording weights (`/admin/weights`) do **not** prompt again inside the window.
6. **Leave admin, window closes.** Go to `/dashboard`, then back to a recipe. Editing prompts again (the unlock is cleared on leaving the step-up surface, by design).
7. **Deep links land on the item.**
   - `/admin/items` (catalog view): expand an item and tap one of its SKUs. `/admin/skus` opens with that row expanded, ringed in gold and scrolled into view.
   - On a vendor's import panel with a "needs a person" row, the SKUs link opens the matched SKU row.
   - On `/admin/menu-costing`, expand a row with blocking SKUs: each name is a link to its SKU row, and a retired-product name opens that product.
   - `/admin/skus?vendor=<a vendor id>` opens with that vendor preselected.
8. **Avg-weight dead end.** Pick a raw SKU whose chain ends in `each` with no avg (or make one on the sim). Tap Edit. Under the chain, "Avg oz per each" is shown. Open the chain editor and Save with the field empty: "This chain ends in a count/volume unit…". Enter `0`: "Average oz per each must be a positive number." Enter `4`: the chain saves, and the SKU's "Unverified" badge clears after refresh.
9. **Spanish.** Switch Marcus to `es` and repeat items 3 and 4 briefly. Every new string reads in tú Spanish ("Escribe para buscar…", "Editar", "Guardar cambios").

- [ ] **Step 5: Push and open the PR — stop at CI green**

```bash
cd /c/Users/conta/co-ops-guides && git push -u origin feat/catalog-phase1-quick-fixes
gh pr create --title "Catalog redesign Phase 1: edit window, recipe line edit, searchable picker, deep links, avg-weight fix" --body-file - <<'EOF'
Phase 1 of docs/superpowers/specs/2026-10-15-catalog-redesign-design.md (plan: docs/superpowers/plans/2026-10-15-catalog-phase1-quick-fixes.md).

- Step-up Tier E: one password unlocks catalog/recipe editing for 15 minutes (fixed window, server-checked on the existing session columns, no migration). Retire product + delete recipe still prompt every time (Tier B).
- Recipe lines editable in place (PATCH /api/admin/recipes/[id]/inputs/[inputId]); same validator as add (plus an item-line cycle guard on both); audited recipe_input.update (now destructive) with the full before/after line.
- Searchable ingredient picker (SKUs, prep items, products; name · vendor · kind; keyboard + touch; 44px rows).
- Deep links land on the exact SKU/product/prep item (?sku= opens + scrolls); ?vendor= now works.
- Avg oz per each settable on chained SKUs (leaf_needs_avg dead end).
- SkuPackChainPanel deleted.

Follow-ups (not in this PR): guide text + photos for the changed screens (spec §7); the ordering walk's "check par" link (Phase 2 item page).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31
EOF
```

Expected: the PR opens and the `build` check (discipline + `npm test` + `next build`) goes green. **Do not merge.** Hand it to review (Astra to APPROVE, per spec §7), then to Juan.

---

## Self-review against the spec's Phase 1 list

| Spec Phase 1 item | Covered by | Notes |
|---|---|---|
| 15-minute edit unlock; destructive actions still ask every time | Tasks 1–3 | Server-authoritative (`assertStepUp` "E" on every converted route). No migration. Fixed window, so Tier B can never be satisfied without a password. Unlock audited with `edit_window_seconds`. Retire product + delete recipe pinned at Tier B. |
| Recipe lines editable in place (qty, unit, swap the ingredient), same validations as add, audit trail | Tasks 4–6, 10 | One validator shared with add (`assertInputLineIsValid`). Product lines measured only in registry units (`assertProductLineIsValid` + `lineUnitChoices`). Full before/after audit. In-place UPDATE per the storage rule. |
| Searchable ingredient picker over SKUs, items and products; name · vendor · kind; keyboard + touch; 44px; phone width | Tasks 7–10 | Pure search tested. Combobox rendered and tested in en/es. Sim item 3 checks phone width. |
| Deep links land on the item | Tasks 11–13 | Two named sites plus the registry links, the vendor-import panel and the costing drawer. Walk "check par" and the catering package links are deferred, with reasons in Task 13. |
| Avg-weight dead end on chained SKUs | Task 14 | Field shown exactly where `leaf_needs_avg` can occur. Same positive-number rule as the server. |
| Delete dead `SkuPackChainPanel` | Task 15 | No importer (Step 1 grep). The tier-map entry is removed. |
| i18n en + es for every new string | Task 9 (+ existing keys reused elsewhere) | Pinned by `tests/ingredient-picker-ui.test.ts`. |
| AGENTS.md updated when behaviour changes | Task 3 Step 9 | New law bullet on the three tiers. |

Type consistency checked across tasks: `RecipeLineFields`/`RecipeLineDraft` (Task 4) are used unchanged in Tasks 5, 6, 9 and 10. `IngredientOption`/`optionForLine`/`lineTargetKey` (Task 7) are used in Task 9. `skuCatalogHref`/`productHref`/`prepItemHref`/`readFocusParam` (Task 11) are used in Tasks 12 and 13. `StepUpTier` now includes `"E"` (Task 1) and is used by `ProductsClient` (Task 3). `RecipeBuilderSku.vendorName` (Task 8) feeds `buildIngredientOptions` (Task 10).
