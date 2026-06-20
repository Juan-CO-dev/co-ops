# Admin Foundation (C.44 Module 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the no-auth `/admin` passthrough with a real admin shell — authenticated, role-gated (≥6), step-up-capable (two-tier), i18n-wrapped — plus a working `/admin` hub and the reusable step-up primitive that later admin modules consume.

**Architecture:** `/admin` stays a top-level route group with its own layout (auth + role gate + `TranslationProvider` + chrome + `StepUpProvider`). Password verification stays solely in the existing `POST /api/auth/step-up`; the two tiers differ only by a freshness check on `sessions.step_up_unlocked_at` (Tier A = unlocked any age; Tier B = unlocked AND ≤120s old). No migration, no entity CRUD — the step-up helper + provider are built and unit-smoked here; their first live consumer is the User Management module.

**Tech Stack:** Next.js 16 App Router (Server + Client Components, route groups), React 19, Tailwind v4 (CSS tokens in `app/globals.css`), TypeScript strict + `noUncheckedIndexedAccess`. No test framework — verification is `npm run typecheck` + `npm run build` + throwaway `tsx` smokes (self-deleted, never committed).

**Branch:** `claude/admin-foundation` (already created off `origin/main` @ `233aba8`).

**Conventions:**
- Throwaway smokes live at `scripts/_smoke_*.ts`, are run with `npx tsx scripts/_smoke_*.ts`, and are **deleted before the task's commit** (CO-OPS never commits tests). The `@/` path alias resolves under `tsx` (same as the seed scripts).
- Every commit ends with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Ground-truth before authoring** (per the confirm-before-authoring discipline): each task starts by re-reading the live files it depends on. Do not author against memory of them.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/i18n/en.json` / `lib/i18n/es.json` | Modify | `admin.*` keys (hub heading/subtitle, back link, `admin.section.<id>` titles) at parity. **First** — `TranslationKey` derives from `en.json`. |
| `lib/admin/sections.ts` | Create | `AdminSection` registry + `adminSectionsFor(level)`. Single source of truth for the hub. |
| `lib/admin/step-up.ts` | Create | `StepUpTier`, freshness window, `assertStepUp(ctx, tier, now?)` — server-side tier enforcement, pure over `AuthContext`. |
| `components/admin/StepUpProvider.tsx` | Create | Client context: `requestStepUp(tier)` mounting the existing `PasswordModal`; pure `stepUpDecision(tier, unlocked)` helper. |
| `lib/roles.ts` | Modify | Correct the stale `canAdmin` JSDoc (comment only; flag has no consumers). |
| `app/admin/layout.tsx` | Modify | Rewrite passthrough → auth + role gate + `TranslationProvider` + `UserMenu` + `StepUpProvider` + chrome. |
| `app/admin/page.tsx` | Create | `/admin` hub card grid from `adminSectionsFor(auth.level)`. |
| `app/admin/{users,locations,checklist-templates,vendors,pars,audit}/page.tsx` | Unchanged | Stay `PlaceholderCard` stubs; now render inside the new chrome. No edits. |

Dependency order: **i18n keys → sections → step-up → StepUpProvider → roles comment → layout → hub page → final gate.**

---

## Task 1: Admin i18n keys (EN + ES at parity)

**Files:**
- Modify: `lib/i18n/en.json`
- Modify: `lib/i18n/es.json`
- Test: `scripts/_smoke_i18n_admin.ts` (throwaway)

- [ ] **Step 1: Ground-truth read**

Read the current `lib/i18n/en.json` and `lib/i18n/es.json` around the `nav.admin` key (line ~46) to find a clean insertion point and confirm the existing formatting (2-space indent, trailing commas between entries). Confirm there are no pre-existing `admin.*` keys (there are not, as of this plan).

- [ ] **Step 2: Write the failing parity smoke**

Create `scripts/_smoke_i18n_admin.ts`:

```ts
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const REQUIRED = [
  "admin.hub.heading",
  "admin.hub.subtitle",
  "admin.back_to_dashboard",
  "admin.section.users",
  "admin.section.checklist-templates",
  "admin.section.vendors",
  "admin.section.pars",
  "admin.section.locations",
  "admin.section.audit",
] as const;

const enKeys = new Set(Object.keys(en));
const esKeys = new Set(Object.keys(es));

let failed = false;
for (const k of REQUIRED) {
  if (!enKeys.has(k)) { console.error(`MISSING en: ${k}`); failed = true; }
  if (!esKeys.has(k)) { console.error(`MISSING es: ${k}`); failed = true; }
}
// Full-dictionary parity (admin keys must not break overall parity).
for (const k of enKeys) if (!esKeys.has(k)) { console.error(`en-only key: ${k}`); failed = true; }
for (const k of esKeys) if (!enKeys.has(k)) { console.error(`es-only key: ${k}`); failed = true; }

if (failed) { console.error("PARITY SMOKE FAILED"); process.exit(1); }
console.log("PARITY SMOKE PASSED");
```

- [ ] **Step 3: Run the smoke to verify it fails**

Run: `npx tsx scripts/_smoke_i18n_admin.ts`
Expected: FAIL — `MISSING en: admin.hub.heading` (and the rest), exit 1.

- [ ] **Step 4: Add the keys to `en.json`**

Insert after the `"nav.admin": "Admin",` line in `lib/i18n/en.json`:

```json
  "admin.hub.heading": "Admin",
  "admin.hub.subtitle": "Manage your business configuration.",
  "admin.back_to_dashboard": "Dashboard",
  "admin.section.users": "User Management",
  "admin.section.checklist-templates": "Checklist Templates",
  "admin.section.vendors": "Vendors",
  "admin.section.pars": "Par Levels",
  "admin.section.locations": "Locations",
  "admin.section.audit": "Audit Log",
```

- [ ] **Step 5: Add the matching keys to `es.json`**

Insert after the `"nav.admin": "Admin",` line in `lib/i18n/es.json` (operational tú-form Spanish):

```json
  "admin.hub.heading": "Administración",
  "admin.hub.subtitle": "Administra la configuración de tu negocio.",
  "admin.back_to_dashboard": "Panel",
  "admin.section.users": "Gestión de Usuarios",
  "admin.section.checklist-templates": "Plantillas de Listas",
  "admin.section.vendors": "Proveedores",
  "admin.section.pars": "Niveles Par",
  "admin.section.locations": "Ubicaciones",
  "admin.section.audit": "Registro de Auditoría",
```

- [ ] **Step 6: Run the smoke to verify it passes**

Run: `npx tsx scripts/_smoke_i18n_admin.ts`
Expected: PASS — `PARITY SMOKE PASSED`, exit 0.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean (no errors). Confirms the JSON is valid and `TranslationKey` expanded.

- [ ] **Step 8: Delete the throwaway smoke and commit**

```bash
rm scripts/_smoke_i18n_admin.ts
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "i18n(admin): add admin.* keys (hub + section titles) EN+ES

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `lib/admin/sections.ts` — admin section registry

**Files:**
- Create: `lib/admin/sections.ts`
- Test: `scripts/_smoke_admin_sections.ts` (throwaway)

- [ ] **Step 1: Ground-truth read**

Read `lib/permissions.ts` (`PERMISSION_MIN_LEVEL`) to confirm the canonical gates the minLevels derive from: `admin.users` 8, `checklist.template.write` 7, `vendor.items.write` 6, `par_levels.write` 7, `admin.locations` 9. Read `lib/i18n/types.ts` to confirm `TranslationKey = keyof typeof en` (the `admin.section.*` keys from Task 1 must exist, or the `i18nKey` literals won't typecheck).

- [ ] **Step 2: Write the failing smoke**

Create `scripts/_smoke_admin_sections.ts`:

```ts
import { adminSectionsFor, ADMIN_SECTIONS } from "@/lib/admin/sections";

function ids(level: number): string[] {
  return adminSectionsFor(level).map((s) => s.id);
}

const cases: Array<[number, string[]]> = [
  [5, []],
  [6, ["vendors"]],
  [7, ["checklist-templates", "vendors", "pars"]],
  [8, ["users", "checklist-templates", "vendors", "pars"]],
  [9, ["users", "checklist-templates", "vendors", "pars", "locations", "audit"]],
  [10, ["users", "checklist-templates", "vendors", "pars", "locations", "audit"]],
];

let failed = false;
for (const [level, expected] of cases) {
  const got = ids(level);
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    console.error(`L${level}: expected ${JSON.stringify(expected)} got ${JSON.stringify(got)}`);
    failed = true;
  }
}
// Never returns a section below the viewer's level.
for (const s of ADMIN_SECTIONS) {
  if (adminSectionsFor(s.minLevel - 1).some((x) => x.id === s.id)) {
    console.error(`leak: ${s.id} visible below minLevel ${s.minLevel}`);
    failed = true;
  }
}

if (failed) { console.error("SECTIONS SMOKE FAILED"); process.exit(1); }
console.log("SECTIONS SMOKE PASSED");
```

- [ ] **Step 3: Run the smoke to verify it fails**

Run: `npx tsx scripts/_smoke_admin_sections.ts`
Expected: FAIL — module `@/lib/admin/sections` not found.

- [ ] **Step 4: Implement `lib/admin/sections.ts`**

```ts
import type { TranslationKey } from "@/lib/i18n/types";

/**
 * Admin section registry — single source of truth for the /admin hub.
 *
 * minLevel derives from the canonical permission key in lib/permissions.ts
 * where one models the section (admin.users 8, checklist.template.write 7,
 * vendor.items.write 6, par_levels.write 7, admin.locations 9). `audit` has
 * no permission key — it is read-only forensic, Owner+ (explicit 9).
 *
 * The outer /admin reachability gate (level >= 6, enforced in
 * app/admin/layout.tsx) is separate; this registry decides which cards a
 * reachable viewer sees. Order here is display order.
 */
export interface AdminSection {
  id: string;
  i18nKey: TranslationKey;
  href: string;
  minLevel: number;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { id: "users",               i18nKey: "admin.section.users",               href: "/admin/users",               minLevel: 8 },
  { id: "checklist-templates", i18nKey: "admin.section.checklist-templates", href: "/admin/checklist-templates", minLevel: 7 },
  { id: "vendors",             i18nKey: "admin.section.vendors",             href: "/admin/vendors",             minLevel: 6 },
  { id: "pars",                i18nKey: "admin.section.pars",                href: "/admin/pars",                minLevel: 7 },
  { id: "locations",           i18nKey: "admin.section.locations",           href: "/admin/locations",           minLevel: 9 },
  { id: "audit",               i18nKey: "admin.section.audit",               href: "/admin/audit",               minLevel: 9 },
];

/** Sections the given role level may reach, in display order. */
export function adminSectionsFor(level: number): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => level >= s.minLevel);
}
```

- [ ] **Step 5: Run the smoke to verify it passes**

Run: `npx tsx scripts/_smoke_admin_sections.ts`
Expected: PASS — `SECTIONS SMOKE PASSED`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean — confirms each `i18nKey` literal is a valid `TranslationKey`.

- [ ] **Step 7: Delete the smoke and commit**

```bash
rm scripts/_smoke_admin_sections.ts
git add lib/admin/sections.ts
git commit -m "feat(admin): section registry + adminSectionsFor(level)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `lib/admin/step-up.ts` — server-side tier enforcement

**Files:**
- Create: `lib/admin/step-up.ts`
- Test: `scripts/_smoke_admin_stepup.ts` (throwaway)

- [ ] **Step 1: Ground-truth read**

Read `lib/session.ts` and confirm: `AuthContext` is exported and has `session: Session`; `mapSession` populates `stepUpUnlocked: boolean` and `stepUpUnlockedAt: string | null`. Read `lib/types.ts` `Session` interface to confirm both fields exist with those names/types. (If either field name differs, stop and surface it — the whole tier mechanism keys on them.)

- [ ] **Step 2: Write the failing smoke**

Create `scripts/_smoke_admin_stepup.ts`:

```ts
import { assertStepUp } from "@/lib/admin/step-up";
import type { AuthContext } from "@/lib/session";

function ctx(unlocked: boolean, unlockedAt: string | null): AuthContext {
  return { session: { stepUpUnlocked: unlocked, stepUpUnlockedAt: unlockedAt } } as unknown as AuthContext;
}

const NOW = Date.parse("2026-06-20T12:00:00.000Z");
const fresh = new Date(NOW - 30_000).toISOString();   // 30s ago
const stale = new Date(NOW - 600_000).toISOString();  // 10m ago
const old = new Date(NOW - 3_600_000).toISOString();  // 1h ago

let failed = false;
function check(label: string, got: unknown, expected: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    console.error(`${label}: expected ${JSON.stringify(expected)} got ${JSON.stringify(got)}`);
    failed = true;
  }
}

// Locked → both tiers rejected with step_up_required
check("A locked", assertStepUp(ctx(false, null), "A", NOW), { ok: false, code: "step_up_required" });
check("B locked", assertStepUp(ctx(false, null), "B", NOW), { ok: false, code: "step_up_required" });
// Tier A → ok at any age
check("A fresh", assertStepUp(ctx(true, fresh), "A", NOW), { ok: true });
check("A old",   assertStepUp(ctx(true, old), "A", NOW), { ok: true });
// Tier B → ok only when fresh
check("B fresh", assertStepUp(ctx(true, fresh), "B", NOW), { ok: true });
check("B stale", assertStepUp(ctx(true, stale), "B", NOW), { ok: false, code: "step_up_stale" });
check("B null ts", assertStepUp(ctx(true, null), "B", NOW), { ok: false, code: "step_up_stale" });

// Env override widens the window so 10m-old counts as fresh.
process.env.ADMIN_STEP_UP_FRESH_SECONDS = "1200"; // 20m
check("B override", assertStepUp(ctx(true, stale), "B", NOW), { ok: true });
delete process.env.ADMIN_STEP_UP_FRESH_SECONDS;

if (failed) { console.error("STEP-UP SMOKE FAILED"); process.exit(1); }
console.log("STEP-UP SMOKE PASSED");
```

- [ ] **Step 3: Run the smoke to verify it fails**

Run: `npx tsx scripts/_smoke_admin_stepup.ts`
Expected: FAIL — module `@/lib/admin/step-up` not found.

- [ ] **Step 4: Implement `lib/admin/step-up.ts`**

```ts
import type { AuthContext } from "@/lib/session";

/**
 * Two-tier admin step-up enforcement (C.44 Module 1).
 *
 * Password verification lives solely in POST /api/auth/step-up; the tiers
 * differ only by a freshness bound on the session's step_up_unlocked_at:
 *   Tier A — unlocked at all (any age). Auto-clears on /admin exit
 *            (lib/session.ts requireSessionCore).
 *   Tier B — unlocked AND step_up_unlocked_at within the freshness window.
 *
 * Pure over AuthContext (requireSessionCore populates the session row's
 * flag + timestamp from the live row, so this needs no I/O). `now` is
 * injectable for deterministic smokes.
 *
 * FOUNDATION PRIMITIVE: built + unit-smoked here; first live consumer is the
 * User Management module. Not called anywhere in this cycle — not dead code.
 */
export type StepUpTier = "A" | "B";

export type StepUpResult =
  | { ok: true }
  | { ok: false; code: "step_up_required" | "step_up_stale" };

const DEFAULT_FRESH_SECONDS = 120;

/** Tier B freshness window in ms. Override via ADMIN_STEP_UP_FRESH_SECONDS. */
export function stepUpFreshWindowMs(): number {
  const raw = process.env.ADMIN_STEP_UP_FRESH_SECONDS;
  const n = raw ? parseInt(raw, 10) : NaN;
  const seconds = Number.isFinite(n) && n > 0 ? n : DEFAULT_FRESH_SECONDS;
  return seconds * 1000;
}

export function assertStepUp(
  ctx: AuthContext,
  tier: StepUpTier,
  now: number = Date.now(),
): StepUpResult {
  if (!ctx.session.stepUpUnlocked) return { ok: false, code: "step_up_required" };
  if (tier === "A") return { ok: true };

  // Tier B — must also be fresh.
  const unlockedAt = ctx.session.stepUpUnlockedAt;
  if (!unlockedAt) return { ok: false, code: "step_up_stale" };
  const age = now - Date.parse(unlockedAt);
  if (Number.isNaN(age) || age > stepUpFreshWindowMs()) {
    return { ok: false, code: "step_up_stale" };
  }
  return { ok: true };
}
```

- [ ] **Step 5: Run the smoke to verify it passes**

Run: `npx tsx scripts/_smoke_admin_stepup.ts`
Expected: PASS — `STEP-UP SMOKE PASSED`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`import type` means no runtime dependency on `lib/session.ts`.)

- [ ] **Step 7: Delete the smoke and commit**

```bash
rm scripts/_smoke_admin_stepup.ts
git add lib/admin/step-up.ts
git commit -m "feat(admin): two-tier step-up enforcement (assertStepUp)

Tier A = unlocked any age; Tier B = unlocked AND within freshness window
(default 120s, env ADMIN_STEP_UP_FRESH_SECONDS). Foundation primitive;
first consumer is User Management.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `components/admin/StepUpProvider.tsx` — client step-up orchestration

**Files:**
- Create: `components/admin/StepUpProvider.tsx`
- Test: `scripts/_smoke_stepup_decision.ts` (throwaway)

- [ ] **Step 1: Ground-truth read**

Read `components/auth/PasswordModal.tsx` and confirm the prop contract: `{ open: boolean; onConfirm: () => Promise<void> | void; onCancel: () => void }`, that it returns `null` when `!open`, and that it posts to `/api/auth/step-up` internally and calls `onConfirm` only on a 200. Read `lib/i18n/provider.tsx` to confirm `useTranslation` requires a `TranslationProvider` ancestor (the admin layout provides it — Task 6).

- [ ] **Step 2: Write the failing decision smoke**

Create `scripts/_smoke_stepup_decision.ts`:

```ts
import { stepUpDecision } from "@/components/admin/StepUpProvider";

let failed = false;
function check(label: string, got: string, expected: string) {
  if (got !== expected) { console.error(`${label}: expected ${expected} got ${got}`); failed = true; }
}

check("A unlocked", stepUpDecision("A", true), "proceed");
check("A locked",   stepUpDecision("A", false), "prompt");
check("B unlocked", stepUpDecision("B", true), "prompt");  // Tier B always prompts
check("B locked",   stepUpDecision("B", false), "prompt");

if (failed) { console.error("DECISION SMOKE FAILED"); process.exit(1); }
console.log("DECISION SMOKE PASSED");
```

- [ ] **Step 3: Run the smoke to verify it fails**

Run: `npx tsx scripts/_smoke_stepup_decision.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `components/admin/StepUpProvider.tsx`**

```tsx
"use client";

/**
 * StepUpProvider — client orchestration for two-tier admin step-up
 * (C.44 Module 1). Hosts a single PasswordModal for the admin subtree and
 * exposes requestStepUp(tier) to descendants.
 *
 *   Tier A — if already unlocked, resolve "ok" without a prompt; else prompt.
 *   Tier B — always prompt (the prompt refreshes step_up_unlocked_at; the
 *            server-side freshness check in lib/admin/step-up.ts is the real
 *            gate). Reads never call this.
 *
 * FOUNDATION PRIMITIVE: first live consumer is the User Management module.
 * The provider mounts in app/admin/layout.tsx so the whole admin surface can
 * call useStepUp(); it has no caller in this cycle (not dead code).
 *
 * Freshness is enforced server-side; the client `unlocked`/`unlockedAt` state
 * is convenience for the Tier A skip-the-prompt decision and is exposed on the
 * context for any future client-side pre-check.
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
import type { StepUpTier } from "@/lib/admin/step-up";

/** Pure decision: does this tier need a password prompt given current unlock state? */
export function stepUpDecision(tier: StepUpTier, unlocked: boolean): "proceed" | "prompt" {
  if (tier === "A" && unlocked) return "proceed";
  return "prompt";
}

interface StepUpContextValue {
  /** Ensure step-up for the tier; resolves "ok" once satisfied (possibly after a prompt) or "cancelled". */
  requestStepUp: (tier: StepUpTier) => Promise<"ok" | "cancelled">;
  unlocked: boolean;
  unlockedAt: string | null;
}

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function StepUpProvider({
  unlocked: initialUnlocked,
  unlockedAt: initialUnlockedAt,
  children,
}: {
  unlocked: boolean;
  unlockedAt: string | null;
  children: ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(initialUnlocked);
  const [unlockedAt, setUnlockedAt] = useState<string | null>(initialUnlockedAt);
  const [modalOpen, setModalOpen] = useState(false);
  const resolverRef = useRef<((r: "ok" | "cancelled") => void) | null>(null);

  const requestStepUp = useCallback(
    (tier: StepUpTier): Promise<"ok" | "cancelled"> => {
      if (stepUpDecision(tier, unlocked) === "proceed") return Promise.resolve("ok");
      return new Promise<"ok" | "cancelled">((resolve) => {
        resolverRef.current = resolve;
        setModalOpen(true);
      });
    },
    [unlocked],
  );

  const handleConfirm = useCallback(() => {
    // PasswordModal posts /api/auth/step-up and calls onConfirm only on 200.
    setUnlocked(true);
    setUnlockedAt(new Date().toISOString());
    setModalOpen(false);
    resolverRef.current?.("ok");
    resolverRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setModalOpen(false);
    resolverRef.current?.("cancelled");
    resolverRef.current = null;
  }, []);

  return (
    <StepUpContext.Provider value={{ requestStepUp, unlocked, unlockedAt }}>
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

- [ ] **Step 5: Run the smoke to verify it passes**

Run: `npx tsx scripts/_smoke_stepup_decision.ts`
Expected: PASS — `DECISION SMOKE PASSED`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean — `PasswordModal` props match; `StepUpTier` imported as a type.

- [ ] **Step 7: Delete the smoke and commit**

```bash
rm scripts/_smoke_stepup_decision.ts
git add components/admin/StepUpProvider.tsx
git commit -m "feat(admin): StepUpProvider client orchestration + stepUpDecision

Hosts one PasswordModal for the admin subtree; requestStepUp(tier) resolves
ok/cancelled (Tier A skips prompt when already unlocked, Tier B always
prompts). Foundation primitive; first consumer is User Management.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Fix the stale `canAdmin` comment in `lib/roles.ts`

**Files:**
- Modify: `lib/roles.ts:36`

- [ ] **Step 1: Ground-truth read**

Confirm `canAdmin` has no consumers outside its own definition: run `grep -rn "canAdmin" lib/ app/ components/` and verify every hit is in `lib/roles.ts` (the interface field + the 15 role rows). It does — so this is a comment-only change with zero behavioral risk. Do **not** change any `canAdmin: true/false` values.

- [ ] **Step 2: Replace the stale JSDoc comment**

In `lib/roles.ts`, replace the `canAdmin` field's JSDoc (currently `/** Whether this role can land in \`/admin/*\`. Note: \`admin.users\` is 6.5+, \`admin.locations\` is 7+ — see permissions.ts for fine-grained gates. */`) with:

```ts
  /**
   * Legacy coarse flag. NOT read anywhere as of C.44 Module 1 (the admin
   * gates are the per-permission-key levels in lib/permissions.ts). Post-C.41
   * integer scale: admin.users 8, admin.locations 9, checklist.template.write
   * 7, par_levels.write 7, vendor.* 6–7. Outer /admin reachability gate is
   * level >= 6 (app/admin/layout.tsx). Values left as-is for documentation.
   */
  canAdmin: boolean;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean (comment-only edit).

- [ ] **Step 4: Commit**

```bash
git add lib/roles.ts
git commit -m "docs(roles): correct stale canAdmin comment for post-C.41 admin gates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Rewrite `app/admin/layout.tsx` — real admin shell

**Files:**
- Modify: `app/admin/layout.tsx` (full rewrite)

- [ ] **Step 1: Ground-truth read**

Re-read the current `app/admin/layout.tsx` (passthrough), `app/(authed)/layout.tsx` (the `TranslationProvider` + floating `UserMenu` pattern to mirror, incl. exact `UserMenu` props: `userName`, `userEmail`, `actorLevel`, `initialBlurb`), and `lib/session.ts` (`requireSessionFromHeaders` returns `AuthContext` with `.level`, `.user.language`, `.user.name`, `.user.email`, `.user.role`, `.user.profileBlurb`, `.session.stepUpUnlocked`, `.session.stepUpUnlockedAt`; redirects to `/?next=<path>` on denial). Confirm `co-text`, `co-text-muted`, `co-gold` tokens exist (PasswordModal uses them).

- [ ] **Step 2: Replace the passthrough**

Replace the entire contents of `app/admin/layout.tsx` with:

```tsx
/**
 * Admin layout (C.44 Module 1) — the admin shell.
 *
 * /admin is its own top-level route group (NOT under (authed)) so the single
 * requireSessionFromHeaders("/admin") call keeps the step-up auto-clear in
 * lib/session.ts coherent: that logic clears step_up_unlocked whenever the
 * served path doesn't start with "/admin/". Under (authed), the parent
 * layout's hardcoded requireSessionFromHeaders("/dashboard") would clear
 * step-up on every admin page load.
 *
 * Owns: auth boundary, role gate (level >= 6), TranslationProvider, floating
 * UserMenu (parity with (authed)), StepUpProvider (seeds the two-tier step-up
 * client state), and admin chrome (back-to-dashboard + container).
 */

import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { StepUpProvider } from "@/components/admin/StepUpProvider";
import { UserMenu } from "@/components/UserMenu";
import { serverT } from "@/lib/i18n/server";
import { TranslationProvider } from "@/lib/i18n/provider";
import { ROLES } from "@/lib/roles";
import { requireSessionFromHeaders } from "@/lib/session";

const ADMIN_MIN_LEVEL = 6;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Auth boundary — redirects to /?next=/admin on denial.
  const auth = await requireSessionFromHeaders("/admin");
  // Role gate — authenticated but below the admin floor.
  if (auth.level < ADMIN_MIN_LEVEL) redirect("/dashboard");

  const lang = auth.user.language;

  return (
    <TranslationProvider initialLanguage={lang}>
      <div className="fixed top-4 right-4 z-30">
        <UserMenu
          userName={auth.user.name}
          userEmail={auth.user.email}
          actorLevel={ROLES[auth.user.role].level}
          initialBlurb={auth.user.profileBlurb}
        />
      </div>
      <StepUpProvider
        unlocked={auth.session.stepUpUnlocked}
        unlockedAt={auth.session.stepUpUnlockedAt}
      >
        <div className="mx-auto w-full max-w-[640px] px-4 py-6">
          <a
            href="/dashboard"
            className="-ml-2 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 py-2 text-xs font-bold uppercase tracking-[0.14em] text-co-text-muted transition hover:text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          >
            <span aria-hidden>‹</span>
            <span>{serverT(lang, "admin.back_to_dashboard")}</span>
          </a>
          {children}
        </div>
      </StepUpProvider>
    </TranslationProvider>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean — all `auth.*` accesses and `UserMenu`/`StepUpProvider` props match the verified shapes.

- [ ] **Step 4: Commit**

```bash
git add app/admin/layout.tsx
git commit -m "feat(admin): real admin shell layout (auth + role gate + step-up + i18n)

Replaces the no-auth passthrough: requireSessionFromHeaders gate, level>=6
role gate (redirect to /dashboard), TranslationProvider, floating UserMenu,
StepUpProvider seeded from session, back-to-dashboard chrome.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Create `app/admin/page.tsx` — the `/admin` hub

**Files:**
- Create: `app/admin/page.tsx`

- [ ] **Step 1: Ground-truth read**

Confirm `app/admin/page.tsx` does **not** already exist (the hub route is missing today). Re-confirm `adminSectionsFor` signature (Task 2) and `serverT(language, key)` (sync, from `lib/i18n/server.ts`). Confirm the layout (Task 6) provides the container + back link, so the page renders only the heading + card grid.

- [ ] **Step 2: Implement `app/admin/page.tsx`**

```tsx
/**
 * /admin hub (C.44 Module 1) — card grid of admin sections the viewer can
 * reach. Renders inside app/admin/layout.tsx (auth + role gate + chrome).
 * Re-calls requireSessionFromHeaders for typed auth access (the C.39 pattern;
 * ~5ms duplicate cost is accepted vs prop-drilling from the layout).
 */

import { adminSectionsFor } from "@/lib/admin/sections";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function AdminHubPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const lang = auth.user.language;
  const sections = adminSectionsFor(auth.level);

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.hub.heading")}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">
        {serverT(lang, "admin.hub.subtitle")}
      </p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sections.map((s) => (
          <a
            key={s.id}
            href={s.href}
            className="rounded-xl border-2 border-co-border bg-co-surface p-4 text-base font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          >
            {serverT(lang, s.i18nKey)}
          </a>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Build (catches the Next 16 prerender class)**

Run: `npm run build`
Expected: success — no `useSearchParams`/Suspense prerender errors, `/admin` and `/admin/*` compile. (These pages are dynamic Server Components reading session via `next/headers`, so no static-prerender Suspense trap, but build is the canonical gate per AGENTS.md.)

- [ ] **Step 5: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat(admin): /admin hub card grid (role-gated sections)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Final gate + push

**Files:** none (verification + push only)

- [ ] **Step 1: Confirm no throwaway smokes were committed**

Run: `git status --porcelain && git ls-files scripts/_smoke_*.ts`
Expected: working tree clean; the second command prints nothing (no `_smoke_*` tracked).

- [ ] **Step 2: Full typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both clean. This is the hard pre-PR gate (mirrors the CI `build` check on PRs to `main`).

- [ ] **Step 3: Push the branch**

```bash
git push -u origin claude/admin-foundation
```

- [ ] **Step 4: Hand off for PR**

Report completion to the controller. PR creation + Juan's preview smoke (the runtime redirect behaviors — unauth→login, L5→dashboard, L6 hub renders role-appropriate cards) happen after subagent execution, in the controller's wrap-up. The runtime redirects are **not** subagent-verifiable here (they need a deployed env + real session cookies); the typecheck/build gates + the pure smokes are the subagent-side proof.

---

## Self-Review

**Spec coverage:**
- Route-group placement (top-level, rationale) → Task 6 layout doc + structure. ✓
- Access model (≥6 outer + per-card minLevels) → Task 6 (`ADMIN_MIN_LEVEL`) + Task 2 (registry). ✓
- Two-tier step-up (freshness window) → Task 3 (`assertStepUp`) + Task 4 (`StepUpProvider`). ✓
- Hub card grid (role-gated, no counts) → Task 7. ✓
- `lib/admin/sections.ts` registry → Task 2. ✓
- `canAdmin` comment fix → Task 5. ✓
- `admin.*` i18n EN+ES parity → Task 1. ✓
- Stub pages unchanged → noted (no task touches them). ✓
- Verification set (layout gate, `adminSectionsFor` cascade, `assertStepUp` tiers, decision fn, i18n parity, build) → Tasks 1–4 smokes + Tasks 7–8 build; runtime redirects → Juan preview (Task 8 §4). ✓
- "Foundation primitive, no consumer yet" framing → comments in Tasks 3 & 4. ✓
- No migration / no entity CRUD / no audit → honored throughout. ✓

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to". Every code step shows complete code. ✓

**Type consistency:** `AdminSection`/`adminSectionsFor` (Task 2) used identically in Task 7. `StepUpTier`/`StepUpResult`/`assertStepUp` (Task 3) consistent. `stepUpDecision`/`StepUpProvider`/`useStepUp` (Task 4) consistent. `UserMenu` props (`userName`/`userEmail`/`actorLevel`/`initialBlurb`) match `app/(authed)/layout.tsx`. `requireSessionFromHeaders`/`AuthContext` field names (`level`, `session.stepUpUnlocked`, `session.stepUpUnlockedAt`, `user.language`/`name`/`email`/`role`/`profileBlurb`) match `lib/session.ts` as read. `serverT(language, key)` sync signature matches `lib/i18n/server.ts`. `admin.*` key strings identical between Task 1 (definition), Task 2 (`i18nKey` literals), and Tasks 6–7 (`serverT` calls). ✓

**Open risk flagged for the implementer:** Task 3 Step 1 must confirm `Session.stepUpUnlocked`/`stepUpUnlockedAt` field names in `lib/types.ts` — the entire tier mechanism keys on them. If they differ, stop and surface before authoring.
