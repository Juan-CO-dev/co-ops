# Floor notes, Wave 1 - spec (GO 2026-10-06)

Source: GO-coops-wave1-2026-10-06.md (sections below are verbatim).

## Who builds what
| Branch | Builder (your subagent) | Reviewer after the PR |
|---|---|---|
| A `feat/am-prep-drafts` | Opus 5.5 | Astra (CC dispatches it) |
| B `feat/collapsible-checklist-sections` | Sonnet 5.5 | Sol (CC dispatches it) |
| C `feat/catering-shop-chip-lost-calendar` | Sonnet 5.5 | Sol (CC dispatches it) |

You (Fable) supervise: brief each subagent, read its diff before you open the PR, and send back anything that's off. Then CC dispatches the OpenAI review, CC reads the diff last, and Juan merges.

## Setup
1. `C:\co\co-ops-build` is clean but at 8721c83 (09-17). Fast-forward it: `git fetch origin; git checkout main; git pull --ff-only`. Expect main = f041675 (#382) or newer.
2. Give each branch its OWN worktree from origin/main, for example `git worktree add C:\co\wt-w1-a -b feat/am-prep-drafts origin/main`, and the same for b and c. Run a real `npm ci` in each worktree (no node_modules junctions; CC's laptop lost a junction twice). The desktop is 2-core/7 GB, so run at most 2 builds at once.
3. Read the repo `AGENTS.md` first (design law: 44px tap floor, co-card, i18n en+es, location-bind law).

## A - AM prep holds its inputs (Opus 5.5)
**Problem (Juan):** "the AM prep list resets whenever someone exits the am prep, which makes them have to recount everything. It should just hold its inputs, so that even if the 10 minute timer hits, they don't lose all their work, or if they need to stop the count and do something else."
**Pattern to copy:** opening already has this. Read `supabase/migrations/0203_opening_phase1_drafts.sql`, `lib/opening.ts` (draft load/save) and `app/(authed)/operations/opening/opening-client.tsx` before writing a line, and mirror their shapes and guards.
**Spec:**
- Server-side draft (NOT localStorage): it must survive the session timeout, logout, closing the tab and switching phones.
- ONE shared draft per shop per business day (location_id + date), so if one person starts the count and another finishes, the second person sees the first person's numbers. If opening's draft is keyed differently, follow this rule here and say why in the PR.
- Autosave as they type (debounce about 1 s, plus save on blur and on visibilitychange to hidden). A quiet "Saved" / "Saving..." indicator, and a quiet "not saved - retrying" on failure. Never block typing.
- On reopen, restore every field and show one line: "Picked up where you left off at 9:42 (Maria)" (en + es).
- On successful submit, clear or mark the draft consumed. A failed submit keeps the draft.
- Same role gate as AM prep submit. Every draft write is location-bound to the actor's shops (the location-bind CI test must cover the new writer; add it to that test's list).
- Migration `0214_am_prep_drafts.sql` (lineage is 0213). AUTHORED ONLY: never apply it to prod and never run it against the prod DB. Grants: revoke from public/anon, RLS location-scoped, same as 0203.
- Tests: unit tests for save/restore/clear-on-submit and the location bind. The existing suite stays green.
- Likely files: `components/prep/AmPrepForm.tsx`, `lib/prep.ts`, `app/(authed)/operations/am-prep/page.tsx`, a new API route under `app/api/operations/...`.

## B - Collapsible checklist sections (Sonnet 5.5)
**Problem (Juan):** "collapsible menu checklist sections. So that people don't scroll endlessly looking for things."
**Spec:**
- Applies to EVERY sectioned checklist: AM prep (`components/prep/PrepSection.tsx` + `components/prep/sections/*`), opening (`components/opening/*`), mid-day (`components/MidDayPhase1Form.tsx`, `MidDayPhase2Form.tsx`) and closing (find it). Inventory them first and list them in the PR body.
- Each section header becomes a toggle (button, aria-expanded, at least 44px tall) that shows "3 of 8 done". Count with the SAME completeness rule each form already uses; don't invent a new one.
- Starting state: the first unfinished section is open, finished sections are collapsed, the rest are collapsed. Each device remembers what was opened (localStorage keyed by form + section, every read/write in try/catch, and it must work with storage blocked).
- If submit finds a problem inside a collapsed section, that section opens and scrolls into view.
- Pure UI: zero change to any submit payload, API or schema. en + es strings.
- Branch A also edits the AM prep form. Merge order is A, then B: if B conflicts, rebase B onto A once A's PR exists.

## C - Catering: shop on pipeline cards + lost orders on the calendar (Sonnet 5.5)
**Problem (Juan):** "in the catering pipeline it should tell you what location the catering is for... also in the catering insights calendar we should mark the lost orders."
**Spec:**
- Pipeline (`components/catering/pipeline/PipelineClient.tsx` + its loader): every lead card shows a small shop chip with the location NAME from the locations table. WARNING: prod location codes are crossed (EM = P Street, MEP = Capitol Hill), so never derive the label from the code.
- Insights calendar (`components/catering/InsightsCalendar.tsx`, `app/(authed)/catering/insights/page.tsx`): show leads/orders in stage `lost` (see `lib/catering/pipeline-shared.ts`) on their event date, greyed + struck through, plus a legend toggle "Show lost" (default ON; the device remembers the choice, try/catch). Lost ones with no event date aren't plotted; show a small "N lost without a date" note instead.
- Lost orders are DISPLAY ONLY. They must not change any money total, count or insights v2 figure (0194/0195 money split). Add a test that totals are identical with lost rows present.
- Location-scoped exactly like the existing calendar reads (a GM sees only their shop). en + es.

## All three branches
- CI green before you call it done (lint, typecheck, tests, build, as the CI workflow runs them).
- Open a PR to main per branch. Body: what/why (quote Juan's note), files touched, test evidence, any deviation from this spec and why. In branch C, also commit this GO's spec sections as `docs/specs/2026-10-06-floor-notes-wave1.md`.
- NO merge, NO prod migration, NO force-push, NO edits outside your three worktrees, no secrets/.env in commits. Stop only your own PIDs.
- Questions mid-build: `dispatch-cc` (mode ask). Anything that is Juan's call: HOLD and copy CC.
- When done: a note in `05-BRIDGE\to-cc\` named `2026-10-06-wave1-done.md` plus a `dispatch-cc` note with the PR numbers, which model built each, CI status, deviations and open questions. Review fixes come back to you as a follow-up GO.
