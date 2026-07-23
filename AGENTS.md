<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

## How to use this file

This is the **law-book**: every durable rule of this codebase, organized by domain, stripped of narrative. It was restructured 2026-07-23 (7-seat council finding: the 149KB chronological log had degrading retrieval — "a novella an agent must read to find the RLS naming convention").

- **The full chronicle** — every incident, smoke test, and recovery behind these rules — is archived verbatim in `docs/PHASE_HISTORY.md`. Read it when you need the *why* behind a law.
- **Current architecture truth** lives in: durable memory snapshots (`~/.claude/projects/C--Users-conta/memory/` — start at the READ-FIRST snapshot), `docs/superpowers/specs/`, `docs/SPEC_AMENDMENTS.md` (append-only corrections to the locked Foundation Spec), and `docs/security/` (the hardening register).
- **Discipline zero (confirm-before-authoring):** re-read the actual file / migration / RLS policy / live schema before authoring against it. Plans, handoffs, and THIS FILE drift from ground truth; the live system wins. After any write meant to persist, read it back from the destination.

## Current state (2026-07-23)

Live in production (co-ops-ashy.vercel.app, two locations): auth + checklists (opening/closing/AM-prep/mid-day/deep-cleaning) + dashboard + reports hub + trends + admin console (users/templates/vendors/SKUs/items/recipes/catering) + the full Item/Inventory Spine (SKU+item registries, recipes graph, receiving, cost/yield, production capture, computed readiness) + the catering stack (pipeline, quotes, packages, customer `/order` funnel, prep-demand ledger W4a, SKU-demand W4b, surplus W4c-a, LTO engine W4c-b — DORMANT until real volume) + tips + training + comms + cash reports. **A vitest unit spine exists** (`tests/`, `npm test`, CI-gated). Next phase: Toast POS integration (read-track first). 101+ migrations; the operational seed is complete and live.

## Stack facts

- **Next.js 16.2.4** + React 19.2.4, App Router, Turbopack. `middleware.ts` is now **`proxy.ts`** (same shape). No capturing groups in the proxy matcher — use `(?:...)` or the proxy silently fails to register.
- **Tailwind v4** — CSS-first config in `app/globals.css` `@theme inline`. **No `tailwind.config.ts`**; do not create one.
- **TypeScript** `strict` + `noUncheckedIndexedAccess` (array access returns `T | undefined`).
- **Node 22 LTS** (`.nvmrc`), **Postgres 17** on Supabase (project `bgcvurheqzylyfehqgzh`), custom JWT auth (NOT Supabase Auth).
- Spec deviations from Foundation Spec v1.2 are **intentional and signed off** (Next 14→16, Node 20→22, Tailwind 3→4, model ids). Do not "fix" them back.
- Domain is **`complimentsonlysubs.com`** (NOT complimentsonly.com). Juan's project identity: `juan@complimentsonlysubs.com` — never his personal Gmail.

---

## THE LAW

### Database & RLS

- **Never `FOR ALL` for write policies.** Permissive policies OR-stack per operation; `FOR ALL` silently permits DELETE. Always split `FOR INSERT` + `FOR UPDATE`, paired with explicit `FOR DELETE USING (false)`.
- **RLS helper functions are `SECURITY DEFINER` with `SET search_path = pg_catalog, public`** — else self-referencing policies recurse to stack-death. `REVOKE FROM PUBLIC` is NOT enough on Supabase: default ACLs grant EXECUTE to `anon` explicitly — revoke from `anon` too and verify via `information_schema.routine_privileges`.
- **UPDATE denials are silent** (`UPDATE 0`, no error; INSERT denials raise 42501). Every UPDATE route must check rowcount and return an explicit 403/404.
- **Append-only is law, enforced at RLS** (`_no_user_delete USING (false)` everywhere). Config rows deactivate via `active = false`; history is sacred. If you want to DELETE, you're in the wrong code path — flip active, append a correction, or supersede.
- **Policy naming:** `<table>_<action>` for allows, `<table>_no_user_<operation>` for explicit denies.
- **Column-level enforcement is app-layer** (Postgres can't do per-column RLS): documented sites include `shift_overlays.forecast_notes` (CGS-only), vendors trivial-vs-full edit split, notification-recipient fields, users self-update fields. `canActOn` (admin acts only on strictly-lower level) is app-layer too — `lib/roles.ts`.
- **Pre-flight every SQL emission against the live schema:** `information_schema.columns` before any INSERT into a shared table (never infer columns from JS helpers — they pack richer args than tables store); `pg_enum` before any INSERT into an enum column (design-doc shorthand ≠ production labels).
- **Every migration applied via MCP also lands as `supabase/migrations/NNNN_<name>.sql` in the same PR** (provenance header + original comment block; see PHASE_HISTORY for the two header formats). Migration-driven audit rows use `metadata.actor_context = "migration_apply"` and set `destructive` explicitly.
- **Template evolution:** in-place additive ONLY when all changes are additive inserts or label-only updates preserving `template_item.id`; anything structural (removals, role-level changes, semantic renames) = Path A versioning (ship vN+1 active, validate, flip vN inactive in a follow-up, document stranded instances in the audit metadata).
- Supabase JS `.update()` **swallows constraint violations** — always check `error`, never infer success from `data`.
- Postgres temp tables aren't shared across `SET ROLE` switches — grant or create after switching.
- PostgREST v12+ reads claims from `request.jwt.claims` (plural JSONB) only; embedded-select `.eq()` filters on relations are fragile under RLS — prefer two-step queries.

### Auth & sessions

- **JWT claim shape (locked):** `{ user_id, app_role, role_level, locations, session_id, role: 'authenticated' }`. `role` is PostgREST's database role — the app role lives in `app_role`, always.
- **`AUTH_JWT_SECRET` is hex-interpreted** (`Buffer.from(secret, "hex")`) — Supabase hex-decodes HS256 secrets on key creation. Rotating the app secret without the Supabase standby key (or vice versa) 500s every request — see `docs/runbooks/jwt-rotation.md`.
- **Dual verification:** JWT signature AND `sessions.token_hash` (SHA-256 of the raw JWT). Mismatch = audited `session_token_mismatch` + 401 + cleared cookie.
- **JWT-embedded authz claims have refresh latency** → any admin mutation affecting authorization (deactivate, role change, location change, credential change) MUST revoke the target's active sessions in the same transaction (`revokeAllUserSessions`, shipped PR #79). `revokeSession` is idempotent; callers interpret `rowsAffected: 0` per context.
- **PINs are 4 digits for ALL roles** (Toast/7shifts parity — locked). Lockout: 5 failures / 15-min. **Defensive `missing_*_hash` branches are countable failures** (else no-hash accounts are un-lockable), and the lockout check runs on the threshold-crossing attempt (no off-by-one 401).
- **Lowercase every email at insert time** — lookups lowercase, the column is case-sensitive, and `email_not_found` is (deliberately) not countable, so a mixed-case insert = permanently unloginable with no user-visible diagnostic.
- Constant-shape responses on enumeration surfaces (`verify`, `password-reset-request`); internal disposition goes in audit metadata only. `/api/users/login-options` is a documented, accepted enumeration tradeoff (tile login UX).
- Proxy 307s preserve method — UI treats 307 from API routes as auth failure; test fetches use `redirect: "manual"`.
- `requireSessionFromHeaders` = Server Component variant (redirects); `requireSession` = route variant (returns 401). `lib/session.ts` is Node-runtime only; `proxy.ts` (edge) imports from `lib/auth.ts` only.

### Audit & append-only conventions

- One `audit()` helper (`lib/audit.ts`), service-role-only, **fail-open** (logging failure never breaks the flow). `destructive` auto-derives from the `DESTRUCTIVE_ACTIONS` registry.
- **Vocabulary:** lifecycle = dot-namespaced (`user.create`, `checklist_template.delete_or_deactivate`); auth events = flat `auth_*` namespace (locked list in PHASE_HISTORY). Never invent parallel action names.
- **`audit.gap_recovery`** = new row covering changes that landed without their audit row (op-by-op `orphaned_changes` + `resolving_audit_row_id`). **`audit.metadata_correction`** = corrects a prior row's metadata. Never UPDATE audit rows — corrective rows are the only path. Orphaned `resource_id`s in audit_log are valid forensic evidence, not bugs.
- Seed scripts: hardcoded `phase`/`reason` metadata MUST be updated before any re-run in a new context; data-exporting seeds gate `main()` behind a `pathToFileURL(process.argv[1])` direct-invocation check (import side-effect re-runs are a real incident class).
- Self-updates that are routine preferences (language, phone) skip audit; anything security-relevant gets one.

### i18n

- **Translate-from-day-one:** every new UI surface ships en + es keys in the same PR. "Translation pass deferred" is scope-incomplete. One key per visible string AND every ARIA label. Spanish is operational tú-form, not formal.
- **System-key vs display-string (architectural rule):** any field that is both a match key and user-visible renders translated but MATCHES on the English original (canonical: the Walk-Out Verification gate). Never compare translated strings.
- **Language is NOT in the JWT** — read fresh from `users` per render (post-toggle staleness). Keep JWTs to authorization claims; user preferences read per-request.
- **All date/time formatting is language-aware via `lib/i18n/format.ts` helpers** (`formatTime`, `formatDateLabel`, `formatChainAttribution`) — never `toLocale*(undefined, …)`, never hardcoded locale, never new inline copies.
- Template-item content translates via `lib/i18n/content.ts` resolver (JSONB `translations`); admin editors for template content MUST expose Spanish fields alongside English (C.44) or they recreate the partial-translation gap.

### Tenant vocabulary (T0 — council-decided 2026-07-23, unanimous)

CO-OPS is the template for a template-and-deploy product (one Vercel + one Supabase per customer). The tenant-config boundary is LOCKED (full decision: `~/.claude/council/2026-07-23-tenant-config/proposal-r3.md`): **code owns BEHAVIOR · the tenant DB owns VOCABULARY and CONTENT · env owns IDENTITY and SECRETS.**

- **New code NEVER hardcodes tenant vocabulary.** No brand-name literals ("Compliments Only"), no location literals ("Cap Hill"/"P St" — read the `locations` table), no prep-section display literals (render via `resolveSectionLabel` / the `prep_sections` table from 0082; slugs as system keys are fine per the i18n system-key rule), no location UUIDs in code. If a value would differ for a second restaurant, it is config — not a literal.
- **The role SET is a product invariant.** Role codes, numeric levels, the CHECK constraint, `current_user_role_level()`, and the ~122 level-based RLS policies are identical in every tenant DB, forever. Per-tenant role customization = display labels only (future `tenant_role_labels` overlay on `lib/roles.ts` defaults). Never add tenant-conditional role logic.
- **One migrations lineage, no tenant-specific migrations, ever.** Tenant difference lives exclusively in data. (The existing migration discipline above already enforces this for one DB; it holds for N.)
- **Known pre-existing debt (fix opportunistically when touching these files; T1 sweeps them wholesale later):** `app/order/page.tsx` (`deriveGroups()` regex on CO section vocabulary — the ONE vocabulary-in-logic site; CO photos/copy/reviews arrays), CO section-name i18n fallback keys (`en.json` ~716–720), remaining brand-name literals repo-wide (storefront header/footer copy and marketing pages). FIXED 2026-07-23: storefront location UUID → `NEXT_PUBLIC_STOREFRONT_LOCATION_ID`; brand name in email layout/magic-link/app metadata → `TENANT_NAME` (`lib/tenant.ts`, env-backed `NEXT_PUBLIC_TENANT_NAME`). New brand-name reads go through `lib/tenant.ts`.
- **Gate discipline:** the T1 extraction wave (env brand vars, `tenant_role_labels`, storefront content tables) does NOT start until 30 consecutive days of genuine daily CO use OR a named warm prospect — do not build it speculatively.

### Module boundaries & testing (2026-07-23)

- **`lib/supabase-server.ts` carries `import "server-only"`** — client-component import paths fail the build instead of leaking the service-role module. This guard found 5 real leak chains on day one; keep it.
- **The `*-shared.ts` pattern:** when a client component needs a constant/pure-fn/type from a server-touching lib module, split the client-safe surface into `<module>-shared.ts` (zero I/O, no server imports) and re-export from the server module so server consumers keep their paths. Existing: `catering/fulfillment-shared`, `recipes-shared`, `catering/pipeline-shared`, `admin/vendors-shared`, `cash-shared`, `catering/quotes-shared`, `prep-consumption-graph`. Type-only imports are safe anywhere (they erase).
- **The vitest spine** (`tests/`, `npm test`, runs in the CI build job): PURE modules only — pricing, charge stack, geo, auth primitives, roles, the recipe-graph resolver. DB-coupled integration stays on the script harnesses (`scripts/phase-2-audit-harness.ts` et al., manual, live Supabase). New pure domain logic gets tests in the same PR; new mixed modules should separate pure math so it CAN be tested.
- **Recipe flatten is batch-loaded:** `loadRecipeGraph()` (6 fixed queries, whole universe) + pure resolution in `lib/prep-consumption-graph.ts`. Loops (W4b, surplus, derived-items) load ONE graph per pass. Never reintroduce per-node queries.

### Build, CI & git discipline

- **CI gate:** the required `build` check runs discipline check + `npm test` + `next build` on every PR. `next build` is a SEPARATE gate from dev/typecheck (e.g. `useSearchParams()` needs `<Suspense>` only at build). Never merge red.
- **Any commit containing a code file goes through a PR + CI. Direct-push is for pure-docs commits only.** (A `.ts` smuggled into a docs push broke main once — the rule is blood-bought.)
- **Smoke against the PR's preview URL** (Vercel comment on the PR), never production — prod serves main, not your branch.
- Long sessions: **commit per step** (`wip(...)`) — a worktree wipe erased 5 hours once. Worktrees are filesystem-isolated: copy `.env.local` + untracked assets in.
- Squash-merge + same-branch series = `git fetch && git reset --hard origin/main` between PRs. Remote branch deletion: `gh api -X DELETE .../git/refs/heads/<branch>` (never `gh pr merge --delete-branch` from a worktree repo).
- If pushes stop triggering `pull_request` runs on a branch: close/reopen the PR (`reopened` is a default trigger). Verify env vars by pulling and checking value LENGTH (`vercel env ls` shows records, not whether they're empty); `NEXT_PUBLIC_*` inline at build — repopulate then rebuild without cache.

### Engineering doctrine

- **Verify against operational artifacts, not generic priors.** CO has zero walk-ins and zero freezers; it has eight under-station fridges. The existing templates, paper checklists, schema, and Juan's floor knowledge are ground truth; training-data "what a restaurant has" is not. Multi-source verification (Juan's knowledge / DB queries / paper artifacts / code pre-read / rendered smoke) before locking operational structure — each source class catches gaps the others miss.
- **"Preserved from prior" must be re-verified against any amendment that changed its operational assumptions** (the C.54 §9 production wedge). When an amendment lands, audit every carried-forward branch for invalidated assumptions.
- **Before building a reader, confirm the writer runs in prod** — a correct-shaped consumer of a contract nobody produces is dead code that looks finished.
- **The codebase has usually already built the thing** — read for existing scaffolding/patterns before scoping anything as greenfield (three-plus confirmed repetitions).
- **Read surfaces over new workflows:** new capability defaults to a computed read over existing capture artifacts; new workflows only when the data genuinely doesn't exist — and then extend an existing artifact first.
- **Wire-shape coupling sets commit boundaries:** form/route/RPC/migration/type changes that are type-coupled ship together; splitting at conversational boundaries produces broken intermediate states.
- **Validation iterates the source of truth** (templateItems, schema, config), never operator-state-only structures (rawValues, dirty sets) — the latter are a subset.
- **Shared-type changes get a consumer grep before commit** (`grep -rE "<TypeName>\b"`); role-gate changes get the 3-layer sweep (lib + RLS + UI, both directions of the comparison).
- **Ship-complete:** partial scope must clear the architectural-deferral bar (different module/data model/tempo, deserving its own design). "Translate it later" and its cousins never clear the bar.
- **Smoke tests are architectural finders:** when a first-shift report feels off, surface the architectural read BEFORE bug-fixing. `router.refresh()` does NOT reset client `useState`; prop-driven client-state resets use the during-render prev-compare pattern, not effects; irreversible affordances gate on server-authoritative status, never spinner state. Map observed→expected before calling a smoke red — refusal-to-resubmit is the fix working.
- **Operational voice varies by audience:** capture surfaces use the actor's technical wording; notification/consume surfaces use operational shorthand; both registers survive translation.

### Juan's working pattern

- **Discuss before building.** Surface ambiguity in batches of 3–5 related questions; architectural ambiguity surfaces immediately.
- **Push back on flawed assumptions in real time** — honest collaboration over agreement; if an instruction conflicts with reality, flag it before acting.
- **Quality over speed.** This runs in front of Pete (Owner) and Cristian (MoO) and real staff at 6 AM.
- **Foreground commands for anything that prompts.** Never paste secrets into chat — write to `.env.local` / Vercel dashboard directly.

---

*Full chronicle with every incident and rationale: `docs/PHASE_HISTORY.md`. Spec corrections: `docs/SPEC_AMENDMENTS.md`. Security law: `docs/security/`. When this file and the live system disagree, the live system wins — and fix this file in the same PR.*
