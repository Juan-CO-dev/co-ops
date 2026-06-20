# Admin Foundation (C.44 Module 1) — Design

**Date:** 2026-06-20
**Status:** Approved design, pre-plan
**Cycle:** C.44 capstone, Module 1 of the admin decomposition (Foundation → Users → Templates → Vendors/Pars → Locations → Audit). This is the thin prerequisite shell every later admin module mounts on.

---

## Ground-truth correction (read first)

`docs/REMAINING_SCOPE.md` and prior session memory claim "the admin API backend already exists; C.44 is just the UI." **That is false as of 2026-06-20.** Verified by reading the files:

- All 9 admin API routes (`app/api/admin/{users,locations,checklist-templates,checklist-templates/[id]/items,vendors,vendors/[id]/items,pars}/route.ts`) are **501 stubs** — e.g. `return NextResponse.json({ error: "Not implemented — … lands in Phase 5." }, { status: 501 })`.
- All 8 admin pages (`app/admin/**/page.tsx`) are **`PlaceholderCard` stubs** (~18 lines each).
- `app/admin/layout.tsx` is a **no-auth passthrough** — literally `return <>{children}</>` with a comment: *"For Phase 0, this is just a passthrough so the placeholder admin pages are reachable without auth."*

So C.44 is **build the API + the UI + the auth gate**, decomposed into modules. This spec covers only **Module 1: the foundation shell**. No entity CRUD ships here.

What *does* already exist and is reused (not rebuilt): the entire step-up apparatus — `unlockStepUp`/`clearStepUp` (`lib/session.ts`), the `/admin/*`-exit auto-clear in `requireSessionCore` (`lib/session.ts:306`), `POST /api/auth/step-up`, the fully-built `components/auth/PasswordModal.tsx`; the schema (every entity has `active` + `created_by`/`updated_by`); `lib/roles.ts` `canActOn`; `lib/permissions.ts` permission keys.

---

## Goal

Replace the no-auth passthrough with a real admin shell: authenticated, role-gated, step-up-capable, i18n-wrapped, with a working `/admin` hub landing page and the reusable two-tier step-up primitive that every later admin module will consume. Read/compose + new shell only — **no migration, no entity write paths.**

## Decisions (locked with Juan)

1. **Route-group placement:** `/admin` stays a **top-level route group** (`app/admin/`), NOT moved under `(authed)`. Rationale: the `(authed)` layout calls `requireSessionFromHeaders("/dashboard")` with a *hardcoded* path; the step-up auto-clear in `requireSessionCore` wipes `step_up_unlocked` whenever the served path doesn't start with `/admin/`. Under `(authed)`, that parent call would clear step-up on every admin page load. Keeping `/admin` as its own group with its own layout means the single `requireSessionFromHeaders("/admin")` call stays on an `/admin` path and auto-clear stays coherent. (URL is `/admin/*` either way — route groups don't affect the URL.)
2. **Access model:** outer `/admin` gate at **level ≥ 6**, then each hub card / page / action gated by its own permission key. The fine-grained `lib/permissions.ts` keys are canonical (AGM at 6 legitimately can do vendor trivial-edits + vendor items); the coarse `canAdmin ≥ 8` flag comment in `roles.ts` is stale (pre-C.41-renumber) and will be corrected.
3. **Step-up: two-tier model.**
   - **Tier A** — step-up once per admin session; stays unlocked until the actor leaves `/admin` (existing auto-clear). Used for routine writes.
   - **Tier B** — re-prompt for password *every time*, even if already stepped-up. Used for irreversible identity/access actions: **reset PIN, deactivate user, change role, location create/deactivate.**
   - Reads are always free (role gate only).
4. **Hub scope:** a card grid of admin sections, each card shown only if the viewer's level can reach it. Section pages stay stubs until their module ships. No at-a-glance counts in this cycle.

---

## Architecture

### Step-up mechanism — the load-bearing primitive

The keystone decision: **password verification stays in exactly one place** (`POST /api/auth/step-up`), and the tier is expressed as a **freshness check** on the existing `sessions.step_up_unlocked_at` column. Tier B is not a second auth path — it is the same unlock with a tighter staleness bound. No raw-password handling is spread across destructive action routes.

- **Tier A enforcement (server):** the action route asserts `ctx.session.stepUpUnlocked === true` (any age; the `/admin`-exit auto-clear bounds its lifetime to the admin session).
- **Tier B enforcement (server):** the action route asserts `ctx.session.stepUpUnlocked === true` **AND** `Date.now() − Date.parse(ctx.session.stepUpUnlockedAt) ≤ FRESH_WINDOW_MS` (default 120 000 ms, override via `ADMIN_STEP_UP_FRESH_SECONDS`).
- **Client flow:** Tier A → if `unlocked`, proceed directly; else mount `PasswordModal` (which `POST`s `/api/auth/step-up`), on success proceed. Tier B → *always* mount `PasswordModal` (refreshing `step_up_unlocked_at`), then fire the destructive request immediately — well inside the freshness window. A stale unlock fails the Tier B check server-side → client re-prompts.

`PasswordModal` is unchanged — it always posts to `/api/auth/step-up`. The only per-tier difference lives in (a) the client decision to show-or-skip the modal and (b) the server freshness assertion.

**Foundation builds the primitive; it has no live consumer until User Management.** This is honest "foundation" code — a complete, unit-smoked mechanism awaiting its first caller — and will be commented as such so it isn't mistaken for dead code.

### File structure

**New files:**

- `lib/admin/sections.ts` — single source of truth for admin sections. `AdminSection = { id: string; i18nKey: TranslationKey; href: string; minLevel: number }`. Entries (id → minLevel): `users` 8, `checklist-templates` 7, `vendors` 6, `pars` 7, `locations` 9, `audit` 9. `adminSectionsFor(level): AdminSection[]` returns the reachable subset in display order. (Minimum level values derive from the canonical `lib/permissions.ts` keys where one exists — `admin.users` 8, `checklist.template.write` 7, `vendor.items.write` 6, `par_levels.write` 7, `admin.locations` 9 — and `audit` is explicit at 9, read-only forensic / Owner+, since no permission key models it. The file documents each mapping inline.)
- `lib/admin/step-up.ts` — server-side step-up enforcement. `type StepUpTier = "A" | "B"`; `ADMIN_STEP_UP_FRESH_WINDOW_MS` (reads `ADMIN_STEP_UP_FRESH_SECONDS`, default 120); `assertStepUp(ctx: AuthContext, tier: StepUpTier): { ok: true } | { ok: false; code: "step_up_required" | "step_up_stale" }`. Pure over the `AuthContext` (no I/O) so action routes call it after `requireSession` and map a non-ok result to `jsonError(403, …)`.
- `components/admin/StepUpProvider.tsx` — `"use client"` context provider. Seeded by the layout with `{ unlocked: boolean; unlockedAt: string | null }`. Exposes `requestStepUp(tier): Promise<"ok" | "cancelled">` which, per tier, either resolves immediately (Tier A already-unlocked) or mounts `PasswordModal` and resolves on confirm/cancel. On a successful step-up it updates local `unlocked`/`unlockedAt` optimistically (authoritative server-side on the next request). Hosts a single `PasswordModal` instance for the whole admin subtree.
- `app/admin/page.tsx` — the `/admin` hub. Server Component: `requireSessionFromHeaders("/admin")`, renders a heading + a responsive card grid from `adminSectionsFor(auth.level)`. Each card: localized title (`serverT`), link to `section.href`. Empty-state copy if no sections (won't happen at ≥6, but handled).

**Modified files:**

- `app/admin/layout.tsx` — rewrite the passthrough into a real Server Component layout (see Data flow below).
- `lib/roles.ts` — correct the stale `canAdmin` JSDoc comment (the "`admin.users` is 6.5+, `admin.locations` is 7+" line) to reflect the C.41 integer reality and point at `permissions.ts` as canonical. Flag *values* untouched unless a grep of `canAdmin` consumers shows a behavioral dependency that conflicts with the ≥6 model (if so, surfaced before changing).
- `lib/i18n/en.json` + `lib/i18n/es.json` — add `admin.*` keys (hub heading, section titles, back-to-dashboard, any chrome strings) at exact parity. Section titles reuse a stable `admin.section.<id>` namespace.
- Admin section stub pages (`app/admin/{users,locations,checklist-templates,vendors,pars,audit}/page.tsx`) — left functionally as-is (they keep rendering `PlaceholderCard`); they now render *inside* the new chrome + `TranslationProvider`. Their self-contained back-link is mildly redundant with the chrome's, but harmless for stubs; each is reconciled when its module ships. No behavioral change in this cycle.

### Data flow — `app/admin/layout.tsx`

```
1. const auth = await requireSessionFromHeaders("/admin")
     → unauthenticated: redirects to /?next=/admin (built-in)
2. if (auth.level < 6) redirect("/dashboard")   // role gate; authenticated-but-too-low
3. render:
     <TranslationProvider initialLanguage={auth.user.language}>
       <div className="fixed top-4 right-4 z-30">
         <UserMenu userName=… userEmail=… actorLevel={auth.level} initialBlurb={auth.user.profileBlurb} />
       </div>
       <StepUpProvider unlocked={auth.session.stepUpUnlocked} unlockedAt={auth.session.stepUpUnlockedAt}>
         <AdminChrome>            // heading + back-to-dashboard affordance
           {children}
         </AdminChrome>
       </StepUpProvider>
     </TranslationProvider>
```

`AdminChrome` may be inlined in the layout rather than a separate component if it stays trivial (a header bar + back link) — decided at plan time; the layout is the owner of admin chrome either way.

## Authorization / privacy

- **Two enforcement layers preserved:** the layout role gate (≥6) is UI/route reachability; every future destructive action additionally enforces its permission key + step-up tier server-side. RLS remains the database boundary.
- **No new data exposure:** the hub shows only section titles + links the viewer's level already authorizes. `StepUpProvider`/`assertStepUp` add an *additional* gate; they never widen access.
- **Step-up freshness is server-authoritative.** The client optimistic `unlocked` state is convenience only; `assertStepUp` reads the session row's real `step_up_unlocked` + `step_up_unlocked_at` (via `AuthContext`, which `requireSessionCore` populates from the live row) on every protected request.
- No migration, no RLS change, no audit rows (no mutations in this cycle). The step-up route's existing `auth_step_up_*` audit is unchanged.

## Verification (no test framework)

`tsc --noEmit` (strict + `noUncheckedIndexedAccess`) + `next build` (separate gates) + throwaway `tsx`/pure smokes (self-deleted, never committed):

1. **Layout gate (live smoke):** no cookie / bad JWT → `/admin` redirects to `/?next=/admin`; a level-5 (shift_lead) session → redirects to `/dashboard`; a level-6 (AGM) session → renders the hub.
2. **`adminSectionsFor` (pure smoke):** L6 → `[vendors]`; L7 → `[checklist-templates, vendors, pars]` (display order); L8 → `+users`; L9 → `+locations, audit`; L5 → `[]`. Never returns a section below the viewer's level.
3. **`assertStepUp` (pure smoke):** Tier A → ok when `stepUpUnlocked` true (any `unlockedAt`, including a 1-hour-old timestamp); `step_up_required` when false. Tier B → ok when unlocked AND `unlockedAt` within the window; `step_up_stale` when unlocked but `unlockedAt` older than the window; `step_up_required` when not unlocked. Honors `ADMIN_STEP_UP_FRESH_SECONDS` override.
4. **`StepUpProvider` decision logic (pure smoke of the extracted decision fn):** Tier A + unlocked → resolves "ok" without mounting the modal; Tier A + locked → mounts modal; Tier B → always mounts modal regardless of unlocked state.
5. **i18n parity:** `lib/i18n/en.json` and `es.json` have identical key sets after the `admin.*` additions (existing parity smoke / key-count check).
6. **No regression:** `next build` clean (Suspense boundaries etc.); `DashboardNav` + `nav.admin` link unchanged; existing admin stub pages still render (now inside chrome).

## Deferred (tracked, not in this cycle)

- All entity CRUD (Users, Templates, Vendors, Pars, Locations) — subsequent modules.
- The Audit Log viewer page body — its own later module (the hub card + ≥9 gate ship here; the page stays a stub).
- A single-use step-up token model (vs the freshness-window approach) — only if the freshness window proves insufficient under real use; the window is simpler and adequate for a small team.
- Reconciling each stub page's chrome (dropping its redundant self-back-link) — done per-module as each ships.
- Lifting/repurposing the `canAdmin` flag values (vs just the comment) — only if a consumer grep shows it's load-bearing in a way that conflicts with the ≥6 model.
- Session-revoke-on-authorization-change discipline (Phase 5 acceptance criterion) — lands with the User Management module where role/deactivate/location mutations live.
