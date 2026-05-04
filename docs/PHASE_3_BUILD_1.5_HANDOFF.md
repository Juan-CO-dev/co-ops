# Phase 3 — Module #1 Build #1.5 — Handoff

**For:** Claude Code, fresh session picking up PR 6.
**Read first:** `docs/PHASE_3_BUILD_1_HANDOFF.md`, `docs/SPEC_AMENDMENTS.md`, `AGENTS.md`. Then this doc.

---

## Where we are

Build #1.5 is **9 of 10 PRs shipped** (8 code PRs + 1 amendments PR + 1 production wet seed run); PR 6 remaining. The build started as a polish pass on Build #1's first-shift production feedback (Cristian's closing) and grew into substantive architectural work covering revoke/tag accountability, full Spanish i18n infrastructure, and authenticated route group consolidation.

**Shipped:**
- **PR 7** ([#21](https://github.com/Juan-CO-dev/co-ops/pull/21)) — Spec amendments C.28–C.36 captured
- **PR 1** ([#22](https://github.com/Juan-CO-dev/co-ops/pull/22)) — Revoke/tag schema migration (`0032_checklist_completions_revocation_and_accountability`) + lib + 3 API routes
- **PR 2** ([#23](https://github.com/Juan-CO-dev/co-ops/pull/23)) — Revoke/tag UI in ChecklistItem (Undo affordance with silent-window + post-60s structured action; KH+ tag affordance; picker UI)
- **PR 3** ([#24](https://github.com/Juan-CO-dev/co-ops/pull/24)) — Notes inline display
- **PR 4** ([#25](https://github.com/Juan-CO-dev/co-ops/pull/25)) — Station header prominence
- **PR 5a** ([#26](https://github.com/Juan-CO-dev/co-ops/pull/26)) — i18n infrastructure + closing flow translated end-to-end (provider, hook, serverT, schema migration `0033`, ChecklistItem + closing-client + PinConfirmModal translated, C.37 + AGENTS.md durable lesson captured)
- **PR 5b** ([#27](https://github.com/Juan-CO-dev/co-ops/pull/27)) — Authenticated route group `app/(authed)/*` with shared layout owning auth boundary + TranslationProvider + UserMenu floating mount; C.39 captured
- **PR 5c** ([#28](https://github.com/Juan-CO-dev/co-ops/pull/28)) — Multilingual template-item content (schema migration `0034`, `lib/i18n/content.ts` resolver, system-key vs display-string discipline, seed script translation pass executed against production); C.38 captured
  - **Wet seed run against production** — 100 template item rows updated with Spanish translations; audit rows `d374358f-70cb-4852-91ca-06abd8a2b889` (MEP) and `945b8dfa-42d4-41af-86fb-aa9d8be0ccca` (EM); Spanish translations LIVE in production data.
- **PR 5d** ([#29](https://github.com/Juan-CO-dev/co-ops/pull/29), merge commit `ec6eda7`) — Dashboard translation (header, role badge tactical lookup, all status copy + CTAs, yesterday-unconfirmed alert, today's operations card, location chrome, logout button, idle timeout modal, date format follows language)

**Remaining:**
- **PR 6** — Login tile employee + trainee surfaces

---

## The architectural model worth understanding

### Spanish toggle is operationally complete for the closing flow + dashboard

A user toggles to Spanish via UserMenu → all closing UI scaffolding renders Spanish → checklist item content (labels, descriptions, station headers) renders Spanish via `resolveTemplateItemContent` → dashboard renders Spanish (greeting, role badge, status copy, CTAs, dates, logout, idle modal). Walk-Out Verification gate continues to function because business keys stay English source-of-truth (translation only at render time per C.38).

**What's NOT translated** (deferred legitimately):
- Login screen (pre-auth surface — separate scoped session)
- PasswordModal (auth-edge surface — separate scoped session)
- Verify / reset-password pages (auth-edge surfaces)

**Architectural deferral** (tactical fix in place, system-wide pattern deferred):
- Role labels currently use a tactical inline `t(\`role.${roleCode}\`)` lookup with 9 keys in en.json + es.json. Proper system-wide role-registry translation pattern (C.38-style resolver) is deferred to a future architectural conversation.

### Revoke/tag accountability architecture (C.28)

Two separate truths captured on `checklist_completions`:
- **Operational truth** (`completed_by`) — append-only record of who tapped the row
- **Accountability truth** (`actual_completer_id`) — annotated retrospectively when wrong person was credited

Two-window revocation:
- **Within 60s of completed_at**: silent self-untick via `revokeCompletion`. Pure error correction.
- **After 60s**: structured action via three chips (`wrong_user_credited`, `not_actually_done`, `other`) via `revokeWithReason` or `tagActualCompleter`.

Tag replacement rules: lateral-and-upward only (`replacement_actor.level >= current_tagger.level`); original tagger can self-correct any time.

### Authenticated route group (C.39)

`app/(authed)/*` is the canonical authenticated route group. Layout owns:
- `requireSessionFromHeaders` auth boundary
- `TranslationProvider` mount with `user.language` read at layout level
- `UserMenu` floating top-right (fixed top-4 right-4 z-30)

Pages keep typed auth access via their own `requireSessionFromHeaders` call. New authenticated pages live inside `(authed)/` and inherit everything.

### i18n architecture (C.31, C.37, C.38)

- Native React Context Provider in `lib/i18n/provider.tsx`; `useTranslation()` for client; `serverT()` in `lib/i18n/server.ts` for Server Components
- TypeScript-derived `TranslationKey` from `keyof typeof en` gives compile-time safety
- Translation files: `lib/i18n/en.json` and `lib/i18n/es.json`, flat dot-namespaced keys
- Schema: `users.language ENUM('en', 'es')` (technically TEXT + CHECK)
- **C.37 convention:** every new UI surface in Build #2+ ships with translation keys + Spanish translations in the same PR. English-only literals are scope-incomplete.
- **C.38 system-key vs display-string discipline:** business keys stay English source-of-truth. Translation happens at render time only. Critical for Walk-Out Verification gate (`it.station === "Walk-Out Verification"`) and any future grouping/matching logic.

---

## PR 6 pickup — login tile employee + trainee surfaces

### Spec (per `docs/PHASE_3_BUILD_1.5_SPEC.md`)

Verify `employee` (level 3) and `trainee` (level 2) role codes exist in `RoleCode` enum + `lib/roles.ts` registry.

- If they exist → just login screen UI updates (tile rendering for those roles)
- If they don't exist → small enum migration to add them, then UI updates

No permission scope changes for trainee in this PR (Module #2 territory per C.34).

### Working notes for PR 6

**1. From PR 2 recon, employee + trainee role codes were missing.** Re-confirm during PR 6 recon — they may still be missing or may have been added since. If still missing, small migration adds them to the enum.

**2. C.37 dependency: translation keys for new role codes.**

If PR 6 adds `employee` or `trainee` to RoleCode, the corresponding `role.employee` and `role.trainee` keys MUST be added to `lib/i18n/en.json` + `lib/i18n/es.json` in the same PR. Adding role codes without translation keys would surface raw key strings ("role.employee") on the dashboard for those users — exact same partial-translation gap C.37 was created to prevent.

Proposed Spanish translations (Juan reviews per smoke-test pattern):
- `role.employee` → "Empleado"
- `role.trainee` → "Aprendiz" (alternative: "Practicante" if "Aprendiz" reads too informal)

**3. Login screen translation status.**

The login screen is a pre-auth surface and its translation was deferred from PR 5a/5d. PR 6 touches login screen UI for tile rendering — **decide explicitly whether to translate the login screen's existing strings during PR 6 or keep that deferral.**

Two paths:
- **(a) Keep login screen English in PR 6.** New tile UI added in English. Login screen translation lands in a future scoped session (alongside PasswordModal, verify, reset-password).
- **(b) Translate login screen end-to-end during PR 6.** Closes another partial-translation gap. Adds scope to PR 6 (~10-15 keys for login screen chrome).

Per Build #1.5's ship-complete principle: if PR 6 touches login screen UI, the whole login screen probably should ship translated. But login screen is structurally pre-auth (no `users.language` available). Login screen sits outside `app/(authed)/` so no TranslationProvider is mounted there. A `useTranslation()` call from a login screen component would throw. PR 6's login screen translation path needs to either: (a) mount its own TranslationProvider at the login screen scope with hardcoded `initialLanguage='en'` (since pre-auth users haven't expressed a preference yet), OR (b) use `serverT(language='en', ...)` directly without a Provider. Both paths are defensible — surface to Juan during PR 6 design.

Surface this decision to Juan before code. Either path is defensible.

**4. Production user accounts.**

Test accounts shipped in Build #1: Juan (cgs/8), Pete (owner/7), Cristian (moo/6.5). Temp PIN `1234`. No employee/trainee accounts yet.

If PR 6 adds the role codes, no accounts need to be provisioned for testing — login screen just needs to render tiles for any active accounts at the location. Verify the seed has any existing accounts that would render at level 2/3, or test by manually setting a test account's role to employee/trainee in DB.

### Files to open early

- `lib/roles.ts` — confirm enum state
- `lib/i18n/en.json` + `lib/i18n/es.json` — confirm 9 role keys, add 2 more if needed
- `app/page.tsx` (login screen, likely path)
- Wherever login tiles render — likely a sub-component

### Deferred work captured in amendments

- **C.34** Module #2 user lifecycle — recruitment pipeline, onboarding, training pipeline (4-week trainee period), promotion mechanics, cross-location candidate allocation, region scoping
- **C.35** Login tile performance indicators
- **C.36** Module #3 content/social media
- **C.27** Multi-tier notes visibility (public vs managerial)
- Role labels: tactical inline lookup in PR 5d; system-wide registry translation pattern deferred

### Production identifiers

- Repo: `https://github.com/Juan-CO-dev/co-ops`
- Production URL: `co-ops-ashy.vercel.app`
- Supabase project: `bgcvurheqzylyfehqgzh`
- Locations: MEP (`54ce1029-400e-4a92-9c2b-0ccb3b031f0a`), EM (`d2cced11-b167-49fa-bab6-86ec9bf4ff09`)
- Closing template IDs: MEP `764eba7a-975d-4a53-b386-952a15cb2d9e`, EM `b67c9fda-ee22-48f7-9bf5-01054e6ecf6d`

### Working rhythm (preserved across builds)

- Surface architectural decisions before any code (alternatives + recommendation pattern)
- Surface code before commit (review gate before git history)
- Independent calls during implementation get flagged with rationale for Juan to accept or push back
- Small focused PRs through CI gate; rebase onto fresh `origin/main` between PRs from same long-lived branch
- Single commit per PR
- Capture any new architectural decisions in `docs/SPEC_AMENDMENTS.md` if they emerge during implementation

### Working principles reaffirmed in Build #1.5

- **Ship-complete:** always finish things fully before moving on, unless architecturally better to defer. Default is ship-complete; partial scope must clear the architectural-deferral bar.
- **System-key vs display-string discipline:** business keys stay English source-of-truth; translation happens at render only.
- **Translate-from-day-one (C.37):** every new UI surface ships with translation keys + Spanish translations in the same PR.

---

## Next session pickup

1. Re-read this handoff
2. Re-read `docs/SPEC_AMENDMENTS.md` (especially C.28–C.39 from Build #1.5)
3. Re-read `AGENTS.md` for the most recent durable lessons (Build #1.5 added: i18n translate-from-day-one, role-label tactical pattern, authed redirect path is currently static, role-label registry-translation deferred)
4. Reset branch to fresh `origin/main`
5. Run PR 6 recon (verify role code state in `RoleCode` enum + `lib/roles.ts`)
6. Surface findings + path to Juan before any code
7. Implement, surface diff before commit, single commit, through CI gate, squash-merge

Build #1.5 closes when PR 6 merges; this handoff doc is the architectural artifact for that closure. After PR 6 ships, decide next direction with Juan (Build #2 prep workflow per the long-term roadmap, or other priorities surface).

---

## The unwritten contract

Juan operates as the architectural lead and final decision authority. Claude Code surfaces alternatives, recommends, implements after lock. Real-time pushback on flawed assumptions before building on them; fix the foundation first. Quality outweighs speed. Direct and honest feedback without softening.

Build #1.5 reaffirmed: the working rhythm holds across substantial architectural arcs. Eight PRs shipped clean through this session including significant architectural commitments (revoke/tag accountability, full i18n infrastructure, authenticated route group). PR 6 closes the build.

Standing by.
