# App issues triage: guide testing round 1 (2026-10-13)

**Sources:** `walk-findings.md` (photo walk, sections "Fixed during the walk" and "App ideas"), 18 round-1 reports (`round-1/*.md`, including `sol-staff.md`, which landed during triage; `runs/sol-manager-r1` has no report yet) and 4 probes (`probes/*.md`), the walk steplogs (`docs/guides/walks/*.steplog.md`), and the run logs and screenshots in `runs/<session>/`.

**Code base:** `docs/guides-v2`. The app code here is the same as `main`. Every file:line below was read for this triage.

**Harness facts used throughout.** These are from `scripts/guide-test/browser-daemon.mjs`.
- The sim runs `next dev` with React Strict Mode. Every testing session came from 127.0.0.1.
- A tap is a Playwright `click({timeout: 5000})`. After each action, `settle` waits for at most 5 s of network-idle plus 300 ms (`:33-36`).
- `look` numbers controls by writing `data-gt` attributes (`:74-79`). A re-render throws those away, so the next "tap 4" waits on a node that no longer exists. The logs show more than 30 failures of the form `waiting for locator('[data-gt="N"]')` with nothing resolved.
- Named targets only match buttons, links, tabs or exact text (`:103`). Inputs never match by label, which is why "type into the field by label" timed out.
- `look` prints `innerText`, `aria-label` or `placeholder`. It cuts input values at 40 characters (`:84`). It never shows `aria-pressed` state or `aria-hidden` dots.

Reporter codes: W = photo walk · AC/AM/AS = Astra catering/manager/staff · DS = deepseek · DF = dsflash · FC/FM/FS = Fable catering/manager/staff · S/SS = Sol catering/staff · G = glm · GF = glmflash · L = luna · OC/OM/OS = Opus catering/manager/staff · SN = sonnet · T = terra · P-x = probes.

---

## 1. Summary table

Severity: **LB** = launch-blocking · **H** = high · **M** = medium · **L** = low. Fix size: S, M or L. "—" means no code fix.

| # | Issue | Reporters (n) | Class | Sev | Fix |
|---|---|---|---|---|---|
| 1 | Mid-day Phase 2 on a phone: Sauces rows are wider than the screen, so SAVE and FINALIZE PREP sit off-screen. The page also zooms when you type | OS, FS, AS, SS (4) | BUG | LB | S |
| 2 | Finalized mid-day prep shows "The interactive count and prep forms ship in the next build." | OS, FS, AS, AM, FM, OM, W (7) | BUG | H | S |
| 3 | Prep units read as fractions: "Prep need 5 1/3 Pan" means 5 third-pans, and "0 1/3 Pan" means 0 | FS, W (2) | BUG | H | S |
| 4 | Raw float on screen: "Above prep need by 0.33000000000000007" | FS, W (2) | BUG | L | S |
| 5 | Opening prep box drops the decimal point as you type ("5." becomes "5"). "5 1/3" is ignored without any message | W, FS (2) | BUG | M | S |
| 6 | Rows with no par still say "Prep need: verify section first" after the section is verified | AM, AS, FS, FM, OM, OS, SS, W (8) | BUG | M | S |
| 7 | The Opening Phase 2 tab still shows the title "Phase 1 — Verification" | W, AM, AS, FM, FS, OM, OS (7) | BUG | L | S |
| 8 | Phase 2 section headers show a grey VERIFIED and "Recount items without closer data first" | AM, FM, FS (3) | BUG | L | S |
| 9 | Phase 1 recount boxes stay red after they are filled | W (1) | BUG | L | S |
| 10 | Opening footer says only "Submit disabled" when the no-prior-data reason is missing. The temp hint does not open the station it names | FM, FS, OM, OS (4) | BUG | M | S |
| 11 | HC Aioli / HP Mayo rows show no name | FS (1) | NOT-A-BUG | — | — |
| 12 | "44 of 44 verified" before the prep sections are verified | AM, AS (2) | NOT-A-BUG | — | — |
| 13 | The "Uses: …" consumption panel is long, and crew can edit its quantities and Case/Each | FS, OS, AS (3) | DECISION | L | — |
| 14 | Three save styles: opening saves on blur, mid-day needs a per-row Save, closing saves on tap | AS, FS, AM (3) | DECISION | L | — |
| 15 | Closing report lines: every link's label says "tap to submit from the AM Prep page", PM Report links to AM Prep, and the subtitle says "submit from the dashboard" | FM, OM, W (3) | BUG | H | S |
| 16 | Closing report-line times are the closing's auto-tick time, not the report's own time | W (1) | BUG | L | S |
| 17 | Amber note "AM Prep had 0 items saved today - check with the opener." points at the wrong person | W, OS, FS (3) | BUG | M | S |
| 18 | The closing fridge-temp line opens a box labelled "COUNT" | FS, OM, OS, AS (4) | BUG | L | S |
| 19 | When a station's closing lines are all done, My shift falls back to "No station" instead of "Closed {time}" | OS, FS, AS, SS (4) | BUG | M | S |
| 20 | After End my shift, START BREAK is still offered | OS, FS, W (3) | BUG | L | S |
| 21 | Dashboard "Take or assign stations 0 of 1" while the board says "0 of 12" | FM, P-glmf (2) | BUG | L | S |
| 22 | Station dropdown shows "No station" right after a claim (unverified) | OS (1) | BUG (verify) | L | S |
| 23 | Pulse says "Mid-day prep is late" at 3:10 PM, inside the 2:00–3:30 due window | OS (1) | BUG | M | S |
| 24 | Closing: "Just modified by someone else — try again." right after the PIN, although it saved | W (1) | SIM/HARNESS | — | — |
| 25 | Closing sections (Closing Manager, Prep Fridge, Walk-Out…) appear as uncovered floor stations | AM, FM, W (3) | DATA | H* | — |
| 26 | "fill first" shows on 10 of 12 station options | FS, P-dsf (2) | DECISION | L | — |
| 27 | Pulse "Closing is overdue" is hidden behind See more, under 8 uncovered-station rows | AM (1) | DECISION | L | — |
| 28 | PM report starts with only app-touchers, and grades default to "Good" | OM (1) | DECISION | L | — |
| 29 | PM report after submit: MVP missing from view, text boxes lose labels, MVP shows "SAVING…" with no saved state | AM, OM, FM (3) | BUG (verify) | L | S |
| 30 | Shop context: a GM who logs in at P Street lands on Capitol Hill on the dashboard, Reports Hub, Catering sales, Prep Demand and the new-quote Location | W, AC, DS, DF, FC, G, GF, L, OC, S, SN (11) | BUG | H | M–L |
| 31 | The first tap on the P Street switch does nothing | DS, G, GF, OC (4) | SIM/HARNESS | — | — |
| 32 | Amber "Order comparison is currently unavailable." on every typed lead | W, AC, DF, FC, G, GF, OC (7) | BUG | M | S |
| 33 | Developer text "Sub — par comparison in W4b" on Prep Demand | FC (1) | BUG | L | S |
| 34 | Customer page says "Pipeline: None yet / Orders: None yet" although the customer has a lead and a quote | W, AC, DS, DF, FC, OC, SN (7) | BUG | M | M |
| 35 | The saved quote page does not show the client or the linked lead | FC, DF, GF, SN (4) | BUG | M | S–M |
| 36 | A lead cannot be edited after it is created (notes, date, headcount). The API already supports this | W, FC, G, GF (4) | BUG | M | M |
| 37 | A new quote starts with an empty line that stays after a package is added | FC, OC, SN (3) | BUG | L | S |
| 38 | Picking a Pipeline lead does not fill name, company, date, headcount or shop | AC, DS, FC, DF (4) | BUG | L | S |
| 39 | Pipeline-lead dropdown: two leads with the same name cannot be told apart | G, SN (2) | BUG | L | S |
| 40 | Catering copy: "1 sources", hub "inquiry to confirmed" vs page "inquiry to completed", setup sub-line lists pricing | OC, W (2) | BUG | L | S |
| 41 | Pipeline search "ezcater" seemed to do nothing | FC (1) | SIM/HARNESS | — | — |
| 42 | Board did not refresh after Add lead or a move. Prep Demand was stale after a shop switch. The old page lingered | DF, G, DS, FC, SN (5) | SIM/HARNESS | — | — |
| 43 | Package picker "would not accept a selection" | L, T (2) | SIM/HARNESS | — | — |
| 44 | No ezCater orders anywhere in the practice copy | all 13 catering runs | DATA | — | — |
| 45 | A per-head package (Light Lunch) drops in at Qty 1, not the headcount | AC, DS, FC, SN, G (5) | DECISION | M | — |
| 46 | Confirmed with a draft quote: the kitchen plans it but Insights shows $0. A lead can be Confirmed with no quote | FC, OC, AC, T (4) | DECISION | M | — |
| 47 | "Choose your sub — NEEDS PICK": nothing says how the sub gets chosen | FC, OC, S, SN (4) | DECISION | M | — |
| 48 | Add lead has no phone or email | DF, FC, G, GF (4) | DECISION | L | — |
| 49 | Stage moves have no confirm, and Completed/Lost are final | G (1) | DECISION | L | — |
| 50 | Insights money is not "accepted quotes only" (it also counts estimated revenue) | SN (1) | NOT-A-BUG | — | — |
| 51 | Pipeline board shows both shops with no shop filter | DF, GF, OC (3) | NOT-A-BUG | — | — |
| 52 | Packages "Deactivate has no confirm" | DF (1) | NOT-A-BUG | — | — |
| 53 | The floating round user button covers breadcrumbs and buttons (DASHBOARD, ORDERING ›, VEG Verified, Add note) | W, P-dsf, P-glmf (3) | BUG | H | M |
| 54 | Settings stays half English after switching to Spanish | AS, FS, OS, SS (4) | BUG | L | S |
| 55 | PIN: a 429 rate-limit shows as "Wrong PIN". The login keypad submits from inside a state updater. The keypad re-enables while the page navigates, so a 5th tap re-submits | G, GF, DS, DF, P-dsf, W (6) | BUG | M | S |
| 56 | PIN pad shows "no dots" | P-dsf, DF (2) | SIM/HARNESS | — | — |
| 57 | #458 follow-up: Cancel and Escape stay live for ~60 ms after the 4th digit, so the confirm fires after a Cancel | review | BUG | M | S |
| 58 | A maintenance note written after 8 PM ET shows tomorrow's date (UTC slice) | AS (1) | BUG | M | S |
| 59 | Cash: the empty form reads "Deposit -$200.00 · $200.00 short". Inputs "have no labels" | OM, FM (2) | BUG (readout) | L | S |
| 60 | Counts on-hand list shows negative oz (-433 oz). Capicola showed -189 and then 230 | OM (1) | DECISION (+DATA) | M | — |
| 61 | Trends "Fridge Temp Flags 8" vs Reports Hub "Temperature flags: 0" | W (1) | BUG (repro first) | M | M |
| 62 | Reports Hub "Last close · Mon, Oct 12 · No activity recorded" after today's closing was confirmed | FM, OM (2) | DECISION | L | — |
| 63 | Pulse does not raise a missed vendor cutoff as late | OM (1) | DECISION | M | — |
| 64 | The Production page has no menu path, and `/operations/production` alone bounces to the dashboard | W (1) | DECISION | L | — |
| 65 | Pulse floor map labels overlap | W (1) | SIM/HARNESS | — | — |
| 66 | One bad prep item (text par) blanks the whole AM prep page | W (1) | DECISION | M | — |
| 67 | Other unverified UI nits: "Confirm with your PIN" text stays, AM-prep banner missing (FM), empty "DRAFT ORDERS" heading | OM, FM (2) | BUG (verify) | L | S |
| 68 | Equipment and stations still say "Walk-In Fridge" / "WALK INS STATION" | W, P-glmf (2) | DATA | L | — |
| 69 | Baldor's "usual order" is one hot-sauce line (Cholula) | OM, FM (2) | DATA | — | — |
| 70 | Practice-data leftovers (Taken by Nicole at login, earlier maintenance notes, PFG drafts, par walk at 3:27) and a cold opening | FM, FS, OS, G, DF (5) | SIM/HARNESS | — | — |
| 71 | Harness artifacts: label typing times out, first tap after a re-render fails, aria-pressed is invisible, values are cut at 40 chars, first navigation is slow | AS, AM, GF, OS, FC, OC, DF, FM (8) | SIM/HARNESS | — | — |
| 72 | Employee dashboard has no Reports or Trends cards | P-dsf, P-glmf (2) | NOT-A-BUG | — | — |
| 73 | Pulse has "MAP VIEW" but no "3D view" | FS, OS (2) | NOT-A-BUG | — | — |
| 74 | Reports Hub → Receiving opens the live Receiving page | AM, OM, FM (3) | NOT-A-BUG | — | — |
| 75 | Counts "Unit" is a pick list, not typed | W, AM, FM, OM (4) | NOT-A-BUG | — | — |
| 76 | Cash "$200 short" when the drawer equals projected | FM (1) | NOT-A-BUG | — | — |
| 77 | AM prep box names are LINE / PORTIONED, not ON HAND / PORT | OM, FS (2) | NOT-A-BUG | — | — |
| 78 | Receiving "Some expected items were never confirmed" did not appear | OM (1) | NOT-A-BUG | — | — |
| 79 | Vendor credit shows "—". Send quote with no email marks the quote Sent | OM, S (2) | NOT-A-BUG | — | — |
| 80 | Assign task saves at once. Receiving "didn't arrive" needs a PO. "Photo later" is needed to confirm | W (1) | DECISION (keep) | L | — |

\*#25 is high only if prod has the same station rows. That is a one-query check.

**Counts:** BUG 38 (3 of them need a repro first: #22, #29, #67) · SIM/HARNESS 9 · DATA 4 · DECISION 16 · NOT-A-BUG 13 · **80 in total.**

---

## 2. BUG details (code, cause, fix, risk, test)

### Prep forms (opening + mid-day)

**#1 Mid-day Phase 2 on a phone: Save and Finalize off-screen, plus zoom.**
- **What happens:** screenshot `runs/opus-staff-r1/105.png` shows the Sauces rows wider than the 390 px viewport. The "Uses: 0 Duke's Mayo · ~0 oz · …" line runs past the right edge, with the Prepped box and SAVE beyond it.
- **Why:** the mid-day `<main>` is `mx-auto max-w-2xl …` (`app/(authed)/operations/mid-day/page.tsx:100, :206`) inside `body.flex.flex-col` (`app/layout.tsx:29`). A cross-axis auto margin turns off stretch, so `main` sizes to fit its content.
  - The consumption summary is a `white-space: nowrap` line (`components/production/ProductionConsumptionPanel.tsx:171`, `truncate`), so its min-content width is the full sentence.
  - Sauce recipes have long ingredient lists. They push `main` wider than the screen, and `truncate` never gets a width to cut against.
  - Veg rows have short lines, which is why their Saves worked.
- **Zoom:** the Prepped inputs are `text-sm` (14 px) (`components/MidDayPhase2Form.tsx:362-366`, `components/MidDayPhase1Form.tsx:195, :212`). iOS Safari and Chromium mobile zoom on focusing an input under 16 px. Opening's `NumericInput` is `text-base` (`OpeningPrepEntry.tsx:990`), which is why opening did not zoom.
- **Harness part:** "taps stop landing" is Playwright clicking at layout coordinates of an element pushed outside the viewport while zoomed. A real thumb can pan and tap. The overflow and zoom themselves are real on a phone.
- **Fix:**
  1. Add `w-full` to both mid-day `<main>`s.
  2. Add `min-w-0` to the panel root (`ProductionConsumptionPanel.tsx:163`) and to the row's `<li>` (`MidDayPhase2Form.tsx:321`).
  3. Change the number inputs in both mid-day forms to `text-base`.
  4. Same no-risk sweep: add `w-full` to the other operations mains with the same shape (`am-prep/page.tsx:197, :326`, `closing/page.tsx:582, :609`, `closing-client.tsx:813`, `counts/page.tsx:33`, `receiving/page.tsx:43`, `production/page.tsx:24`).
- **Risk:** layout only. At wide breakpoints `max-w-*` still caps width, and `w-full` changes nothing there.
- **Test:**
  - Source-pin test: mid-day mains contain `w-full`, mid-day number inputs are not `text-sm`, and the panel root has `min-w-0`.
  - Sim check (Playwright, 390×844, isMobile): on Phase 2 of a mid-day with Sauces, `document.documentElement.scrollWidth <= 390`, and each SAVE `boundingBox().x + width <= 390`.

**#2 Finalized mid-day shows the "next build" placeholder.**
- **What happens:** `mid-day/page.tsx:238-272` renders `mid_day_prep.page.forms_pending` plus a bare par list for any status that is not `open` or `phase1_complete`. Finalize sets `phase2_complete` (`lib/prep.ts:1555`), so every finished mid-day lands there. The heading also stays "Phase 2 — prep" (`:141-144`).
- **Fix:**
  - For `phase2_complete`, render a read-only finalized view:
    - a banner reusing `dashboard.mid_day_prep.finalized_by` ("Finalized at {time} by {name}") from `state.instance.confirmedAt` / `state.authors[confirmedBy]`;
    - one row per item: label · need · made (`prepData.inputs.total`), with the unit through the #3 formatter.
  - Set the heading to a new `mid_day_prep.page.finalized_heading`.
  - Keep a neutral fallback for unknown statuses. Delete `forms_pending` from en.json:2167 and es.json, and update the stale header comment (`:9-14`).
  - Put the row math in a pure `midDayFinalizedRows(templateItems, completions)` in `lib/mid-day-shared.ts`.
- **Risk:** read path only. The dashboard tile already deep-links finished instances here (FM).
- **Test:** unit-test `midDayFinalizedRows` (latest live completion per item, null for unsaved). Pin that `forms_pending` no longer exists in en.json or the page.

**#3 Units read as fractions.**
- **What happens:** `OpeningPrepEntry.tsx:653-656` (par), `:683-687` (closer count) and `:703-711` (prep need) print `${n} ${parUnit}`. With `parUnit = "1/3 Pan"`, 5 reads "5 1/3 Pan" and 0 reads "0 1/3 Pan". `MidDayPhase2Form.tsx:341-345` does the same. Testers typed 5.33 for a need of 5.
- **Fix:** add a pure `formatPrepQty(n, unit)` in a new `lib/prep-display-shared.ts`:
  - round to at most 2 decimals and trim zeros;
  - if the unit starts with a digit (`/^\d/`), render `5 × 1/3 Pan`;
  - otherwise render `3 Bottle`;
  - render `0` as just `0`.
  - Use it at the five sites above, in `MidDayPhase1Form` (par display) and in the #2 view.
- **Risk:** display only. No stored value changes. Wording is Juan's call: "5 × 1/3 Pan" vs "5 third-pans".
- **Test:** a `formatPrepQty` table covering (5, "1/3 Pan"), (0, "1/3 Pan"), (7.3333, "Pan"), (3, "Bottle") and (null, x).

**#4 Raw float in the over/under prompt.**
- **What happens:** `delta = openerPrepped − prepNeed` (`OpeningPrepEntry.tsx:612-619`) goes into `opening.phase2.signal.over_prep` unrounded (`:783, :797, :809, :823`).
- **Fix:** pass `roundQty(overDelta)` / `roundQty(underDelta)`, the same helper as #3, for display only. Leave the comparisons alone.
- **Test:** covered by the #3 helper test (5.33 − 5 → "0.33").

**#5 The opening prep box drops decimals.**
- **What happens:** `NumericInput` (`OpeningPrepEntry.tsx:960-984`) is a controlled `type="text"` input whose value is `String(number)`. Typing "0." parses to 0, the parent stores 0, and the box re-renders "0", so the dot disappears. A real user cannot type 0.5 one key at a time. "5 1/3" parses to NaN and is ignored without a word, so the box stays empty under Playwright `fill`.
- **Fix:**
  - Keep a local `draft` string.
  - Commit `Number(draft)` only when the draft is a complete number. Keep a partial draft such as "5." as shown.
  - Show an inline "numbers only" hint (new key) when the draft is invalid.
  - Re-sync the draft from the prop with the during-render prev-compare pattern (AGENTS: never an effect).
  - Put the parse in a pure `parseDecimalDraft(raw)` that returns empty, partial, number or invalid.
- **Risk:** this input saves on blur. Make sure blur commits the last valid number.
- **Test:** `parseDecimalDraft` cases: "", "5", "5.", ".5", "5 1/3", "-1".

**#6 "Prep need: verify section first" on no-par rows.**
- **What happens:** `prepNeed` is null whenever `parValue` is null (`:604-610`), and the null branch always prints `prep_need_pending_verification` (`:713-717`). Tomato and Caesar Dressing have no par, so verifying never changes it.
- **Fix:**
  - When `parValue === null`, show a new `opening.phase2.prep_need_no_par` ("No par set — type what you made"). Keep the pending text only when `groundTruth === null`.
  - Add the es key. Same treatment for mid-day's `Par —` line if wanted.
- **Test:** a pure `prepNeedLabel({parValue, groundTruth})` with three cases.

**#7 Phase 2 tab title.**
- **What happens:** `opening-client.tsx:1797-1801` always renders `opening.page.title` ("Phase 1 — Verification") and the Phase 1 subtitle.
- **Fix:** when `activePhase === "prep"`, use `opening.phase.tab_phase2` ("Phase 2 — Prep Entry") and a new `opening.page.subtitle_phase2`. `ScaffoldHeader` (`page.tsx:344-354`) can keep the label only.
- **Test:** source-pin that the header branches on `activePhase`.

**#8 Phase 2 section headers.**
- **What happens:** `OpeningPrepEntry.tsx:377-387` renders `OpeningSectionVerify` in Phase 2. Its `disabled` comes from `sectionDisabledMap` (`:292-305`), which reads Phase-2 `values`. Those carry no `openerRecount`, so every section with an item that had no closer count shows a grey VERIFIED and "Recount items without closer data first" (`OpeningSectionVerify.tsx:80-83`).
- **Fix:** Phase 1 is submitted before Phase 2 opens, so every section is verified. In Phase 2, replace `headerExtras` with a static "Verified ✓" chip and drop the toggle.
- **Risk:** this also removes the ability to un-verify a section during Phase 2. That is correct, because Phase 1 is locked, but confirm `onSectionVerifyToggle` has no Phase-2 server path.
- **Test:** source-pin that Phase 2 does not render `OpeningSectionVerify`.

**#9 Recount boxes stay red.**
- **What happens:** `OpeningChecklistItem.tsx:227-236, :266-268, :285-293, :311-313` style red on `isNullSource` alone.
- **Fix:** use `needsRecount = isNullSource && value.openerRecount === null` for the container, label and border. For a batch item, use `openerRecountLine === null || openerRecountBackUp === null`. Keep `aria-required`.
- **Test:** source-pin that the class conditions reference `openerRecount`.

**#10 Opening footer: no reason named, and hidden temps.**
- **What happens:** with `needsAttestation` (`opening-client.tsx:1080`) still unanswered, the footer falls through to `gate_disabled_generic` "Submit disabled" (`:2031-2052`). The comment at `:2024-2030` defends that choice, but the pink prompt is far up the page, and FM lost actions on it. "Temp reading required for X" is plain text, and the temp box sits in a collapsed station card (4 reporters).
- **Fix:**
  - Add `opening.submit.gate_disabled_reason_required` ("Pick a reason in the pink 'No prior closing data' box") when `needsAttestation && attestationReason === null`.
  - Make the temp hint a button that reveals and scrolls to that station, using the Phase 1 collapsible `reveal()`.
- **Test:** a pure gate-hint selector (`openingFooterHint(state)`) with cases for each blocker.

### Closing, shift board, Pulse

**#15 Closing report-line links.**
- **What happens:**
  - `components/ReportReferenceItem.tsx:81-97`: `reportRoute()` has no `pm_report` case, so "PM Report submitted" opens **/operations/am-prep**.
  - `:244` uses `closing.report_ref.tap_to_submit_aria` ("{label} — tap to submit from the AM Prep page", en.json:2519) for every type.
  - The visible subtitle `:220` says "Pending — submit from the dashboard", but the row is a link to the report.
  - The Edit aria (`:201`, en.json:2521) says "Edit AM Prep…" for every type.
- **Fix:**
  - Add `case "pm_report": return "/pm-report"`. `/pm-report` takes `?location` (`pm-report/page.tsx:38-45`).
  - Use a per-type aria "{label} — tap to open {report}", with `{report}` from the existing `assignments.task.<type>` keys.
  - New subtitle "Pending — tap to open".
  - Edit aria "Edit {report} submitted by {name}".
- **Test:** export `reportRoute` (or move it into a shared module) and unit-test every `ReportType`. Pin that en.json has no "AM Prep page" in report_ref keys.

**#16 Closing line times.**
- **What happens:** `ReportReferenceItem.tsx:154` formats `completion.completedAt`, the moment the closing auto-tick row was written (often when the closing was first opened). `AutoCompleteMeta.reportSubmittedAt` (`lib/types.ts:494-499`) is the report's real time.
- **Fix:** use `completion.autoCompleteMeta?.reportSubmittedAt ?? completion.completedAt` there and in the aria label.
- **Test:** source-pin.

**#17 "check with the opener".**
- **What happens:** en.json:2321, rendered at `closing-client.tsx:962-967`. AM prep is the closer's count (`lib/opening.ts:659-668`). The banner shows all day whenever today's AM prep has 0 rows (`closing/page.tsx:476-507`).
- **Fix:** copy only, en and es. Suggested: "Tonight's AM prep count isn't in yet. The closer does it before lock-up." Whether it should only appear after a set hour is folded into #17's decision note in §3 (D-17).
- **Test:** key-text pin.

**#18 Closing fridge-temp line labelled "COUNT".**
- **What happens:** `ChecklistItem.tsx:1135` uses `closing.expand.count_label` for every `expectsCount` item.
- **Fix:**
  - In `closing/page.tsx`, load the temp item ids with the existing `loadLocationTempItemIds(service, locationId)` (`lib/reports-hub.ts`) and pass them to `closing-client`.
  - Pass `isTempReading` to `ChecklistItem`, and render a new `closing.expand.temp_label` "Temp (°F)" when true.
- **Risk:** one more read on the closing page, a single small query.
- **Test:** source-pin plus a sim check.

**#19 Station done → "No station".**
- **What happens:** when a station's closing lines finish, the close releases the holder. The person's head event becomes `kind:"release"` with `releaseReason:"station_closed"` and `stationId` null (`lib/assignments-shared.ts:62-70, 103-113`). `ShiftBoardClient.tsx:255` then prints `assignments.noStation`, and `stationStatus` (`:88-92`, the "Closed {time}" line) only renders when a station is found.
- **Fix:**
  - Add a pure `closedStationFor(board, userId)` in `assignments-shared.ts`: when the head is a `station_closed` release, resolve the station through `priorPositionId`.
  - In the compact card, render "{station} · Closed {time}" with the existing `assignments.lifecycle.closed` key.
- **Risk:** confirm the 0230 release writer fills `priorPositionId`. If it does not, use the last non-release event's `stationId` instead.
- **Test:** unit-test `closedStationFor` with assign→release(station_closed), release(ended_shift) and no events.

**#20 START BREAK after End my shift.**
- **What happens:** `ShiftBoardClient.tsx:252` shows the break button for any available self.
- **Fix:** hide it when `board.whosHere && person.presence && !person.presence.onShift && !person.onBreak`.
- **Keep CLAIM:** a new claim is new activity, and that is the documented way back on shift (`lib/presence-shared.ts:6-9, 70-79`).
- **Test:** source-pin, or extract `showBreakButton(person, board)` and test it.

**#21 Dashboard "0 of 1".**
- **What happens:** in compact mode the stations section counts "do I hold a station" out of 1 (`ShiftBoardClient.tsx:142, :235`) under the title "Take or assign stations". `progressText` (`:149`) prints "{done} of {total} assigned".
- **Fix:** in compact mode, use the title `assignments.myStation` ("My station") and the progress text "Yours: {station}" or "None yet" (new keys).
- **Test:** source-pin.

**#22 Dropdown shows "No station" right after a claim (verify first).**
- **What happens:** the select is keyed on `current?.id` with `defaultValue={current?.positionId ?? ""}` (`ShiftBoardClient.tsx:268`). It should show the claim unless the claim event has no `positionId`.
- **Next step:** reproduce on the sim. If it reproduces, check that `loadShiftBoard` maps `position_id` onto claim events.

**#23 Pulse "late" during the due window.**
- **What happens:** `lib/pulse/sections.ts:283-284` builds `late` from `overdue === "overdue" || overdue === "due_now"`. Mid-day is `due_now` from 2:00 to 3:30 PM (`lib/midshift-shared.ts:285-289, 327-328`), so every assigned mid-day is "late" from 2:00.
- **Fix:** count only `overdue`.
- **Test:** this needs a pure extraction. `lateTaskKeys(reports)` returns only overdue keys, with cases for due_now and overdue.

**#29 / #67: PM report and other nits (verify first).**
- Reproduce on the sim before building: MVP missing on the submitted PM report view, labels lost after submit, the MVP Save state, the "Confirm with your PIN" text remaining, the AM prep "submitted at" banner (FS saw it and FM did not), and the empty "DRAFT ORDERS" heading.
- Several may be dev-render timing.

### Shop context

**#30 A GM at P Street lands on Capitol Hill.**
- **What happens:**
  - Login never passes the chosen shop on. `app/page.tsx:134-137` pushes `safeNextPath(next)`, which is `/dashboard` with no `?loc`. The PIN body carries only `user_id` (`:199`).
  - Every page then falls back to the first location: `dashboard/page.tsx:351-354` (alphabetical: Capitol Hill < P Street), `reports/page.tsx:25` and the sales pages (`auth.locations[0]`, the JWT order), `catering/quotes/page.tsx:63` with `QuotesClient.tsx:216` (`locations[0]`), `admin/catering/prep-demand/page.tsx:55`, `lto/page.tsx:50`, `assignments/page.tsx:23`, `stations/page.tsx:22`, `my-feedback/page.tsx:62`, `reports/written/page.tsx:34`, `opening/page.tsx:145`, `admin/stations/page.tsx:23` and `admin/toast-employees/page.tsx:24`.
  - So even after switching on the dashboard, each new page starts on Capitol Hill.
  - This is not only cosmetic. The new-quote Location defaults to the wrong shop, which invites a P Street quote filed under Capitol Hill.
- **Fix:**
  1. Login sends the user to `/dashboard?loc=<tile location id>` when there is no `next`.
  2. In `proxy.ts`, when a request carries `?loc=` or `?location=` with a UUID value, set cookie `co_shop` (Path=/, SameSite=Lax, HttpOnly, Secure, 30 days). Any explicit shop pick anywhere then sticks.
  3. Add a pure `pickShop({accessibleIds, explicit, remembered})` in a new `lib/shop-context-shared.ts`. It returns explicit if accessible, else remembered if accessible, else the first id. Add a server wrapper `lib/shop-context.ts` that reads the cookie through `cookies()`.
  4. Replace every fallback site listed above with `pickShop`, and pass `defaultLocationId` into `QuotesClient` (one line at `:216`).
- **Risk:**
  - The proxy runs at the edge, and AGENTS limits proxy imports to `lib/auth.ts`. A cookie write needs no import.
  - Access is checked at read time, so a stale or forged cookie falls back safely.
  - Level-9 "all" scopes and the reports `"all"` value must pass through unchanged.
  - The work touches about 15 pages, so it needs a full sim walk at both shops.
- **Test:**
  - Unit-test `pickShop`: explicit wins, a remembered value that is not accessible is ignored, the first id is the fallback, and an empty list returns null.
  - A grep test that no `locations[0]` or `auth.locations[0]` default remains under `app/` outside the helper, with an allow-list for intentional cases.

### Catering

**#32 "Order comparison is currently unavailable." on every lead.**
- **What happens:** `lib/catering/ezcater-reconciliation.ts:31-32`. For a lead with no ezCater order the query is `.contains("candidates", [leadId])`.
  - postgrest-js turns a JS array into the Postgres array literal `cs.{uuid}`.
  - `candidates` is **jsonb** (`0225_ezcater_pass2.sql:341`), so PostgREST errors.
  - `reviewError` then returns `unavailable` (`:35`), and the panel prints the amber line (`EzcaterReconciliationPanel.tsx:27-31`).
- **Fix:** `.filter("candidates", "cs", JSON.stringify([leadId]))`. Log `reviewError` with `console.error`, as the shrinkage path does, instead of hiding it.
- **Then:** the "ignore it" sentence in `catering-guide.md:328` comes out.
- **Test:** extract `reviewQueueScope(order, leadId)` and assert the jsonb literal `'["<id>"]'` with op `cs`. Add a pin that no `.contains("candidates", [` remains.

**#33 "Sub — par comparison in W4b".**
- **What happens:** a W4-era placeholder at `PrepDemandClient.tsx:548-550`, en.json:4555 and es.json.
- **Fix:** remove the span and both keys. If a note is wanted, use "Made to order".
- **Test:** key-absence pin.

**#34 Customer page "None yet".**
- **What happens:** `lib/catering/customers.ts:155-168` lists leads with `catering_pipeline.customer_id = id` and orders from `catering_orders`. Saving a quote with an email creates or resolves the customer onto the **quote** only (`app/api/catering/quotes/route.ts:31-41`, `lib/catering/quotes.ts:600-606`). The staff-typed lead keeps `customer_id` null, and quotes are not shown on the customer page at all.
- **Fix:**
  - In `createQuote` (after the line insert) and in `reviseQuote`: when `pipelineId && customerId`, update `catering_pipeline set customer_id = $customer where id = $pipeline and customer_id is null`. Check `error` and the count. Audit with the action the lead-edit PATCH already uses.
  - In `loadCustomer`, also load live quotes (`customer_id = id`, `superseded_at is null`), and render a "Quotes" list in `CustomersClient.tsx` (~`:170-200`).
- **Risk:**
  - A second writer on `catering_pipeline`. Keep it null-only so it never moves a lead between customers.
  - AGENTS customer-profile contact rules apply to `customers` (0234), not `catering_customers`. Confirm before showing anything new.
  - Existing linked leads need a one-off backfill, by migration if wanted.
- **Test:** unit-test a pure `shouldLinkLead({pipelineId, customerId, leadCustomerId})`. Sim check: quote with email → customer page lists the lead and the quote.

**#35 Saved quote page has no client or lead.**
- **What happens:** `QuoteDetailPanel` shows date and headcount only (`QuotesClient.tsx:766-771`). `loadQuote` (`lib/catering/quotes.ts:350`) returns ids only.
- **Fix:** in `loadQuote`, join the customer (name, email) and the lead (contact, company, event date). Return them from `app/api/catering/quotes/[id]/route.ts:26-28` and render "Client: …" and "Lead: …" lines.
- **Risk:** this is a GM-level read of an email that is already visible in the Customers directory.
- **Test:** sim check, plus a type-level test of the DTO shape.

**#36 A lead cannot be edited.**
- **What happens:** `PATCH /api/catering/pipeline/[id]` already accepts `EDIT_KEYS` (`route.ts:36-47`, "D3 — … edit in place", `lib/catering/pipeline.ts:6`). `LeadDetail` (`PipelineClient.tsx:371-470`) has no edit form.
- **Fix:** add an "Edit details" disclosure in `LeadDetail` with contact, company, date, headcount, follow-up and notes. PATCH, then `router.refresh()`, gated at `writeMin`.
- **Test:** sim check. The route is already covered.

**#37 Empty first quote line.**
- **What happens:** `QuotesClient.tsx:223-238` seeds `[blankLine()]`. `addPackage` and `addItem` append (`:285-320`). Submit drops blank lines (`:325-327`), so this is cosmetic.
- **Fix:** before appending, drop untouched blank lines (empty description, no ids, empty price).
- **Test:** extract `appendLines(prev, next)` and test it.

**#38 The lead does not prefill the quote.**
- **What happens:** the `leads` prop already carries `contactName`, `company`, `eventDate`, `headcount` and `locationId` (`QuotesClient.tsx:37`). The `<select>` at `:438` only sets the id.
- **Fix:** on pick, fill **empty** contact name, company, date and headcount, and set the location to the lead's shop.
- **Test:** pure `prefillFromLead(form, lead)` that never overwrites typed values.

**#39 Lead dropdown labels.**
- **Fix:** label each option "Contact · Company · {date} · {shop code}" (`QuotesClient.tsx:438-…`).
- **Test:** source-pin.

**#40 Catering copy nits.**
- `catering.insights.source_count` "{n} sources" (en.json:4250) becomes `_one/_other` keys.
- `catering.hub.pipeline_desc` (:4134) becomes "Leads from inquiry to completed."
- `admin.catering.subtitle` (:628) drops "pricing" so it reads true for a GM (W).
- es keys follow.

### Chrome, auth, i18n

**#53 The floating user button covers controls.**
- **What happens:** `app/(authed)/layout.tsx:55` places `UserMenu` at `fixed top-4 right-4 z-30` (44 px). Anything at the page's top-right sits under it permanently: the `ReportPageNav` DASHBOARD on `/my-feedback` and `/reports/written`, and ORDERING › on Receiving. Anything that scrolls under it gets covered mid-page: VEG Verified, closing headers, Add note.
- **Fix (recommended):** make the menu in-flow. Render `<div className="flex justify-end px-4 pt-3 sm:px-6">` above the children in the authed layout. It scrolls away and covers nothing. The dropdown is already `absolute right-0 top-12` (`UserMenu.tsx:162`) and still works.
- **Alternative:** keep it fixed and give every page's first row `pr-14`. That is fragile and does not fix content scrolling under it.
- **Risk:** every authed page moves down about 56 px. Check sticky progress bars (z-20) and pages with their own `pt-4`. Take a screenshot pass at 390 and 1024 on the five walk shots.
- **Test:** source-pin that the layout has no `fixed top-4 right-4`, plus a visual check.

**#54 Settings half English.**
- **What happens:** `LanguageSettingCard.tsx:28-35` (and `UserMenu.tsx:94`) call the provider's `setLanguage` only. Client strings switch. Server-rendered `serverT` strings (`settings/page.tsx:31-56`) stay in the old language until the next navigation. The es keys exist (es.json:527-534).
- **Fix:** call `router.refresh()` after a successful save in both places.
- **Test:** source-pin for `router.refresh()` after `setLanguage(next)`.

**#55 Login PIN: 429 shown as "Wrong PIN", updater side effect, re-enable while navigating.**
- **Updater side effect:** `components/auth/PinKeypad.tsx:131-137` schedules `submit()` inside the `setPin` updater. That is the exact bug #458 removed from `PinConfirmModal`. In Strict Mode (the sim) every PIN POSTs twice.
- **Throttle as "Wrong PIN":** all testers shared 127.0.0.1, and the per-source throttle allows 30 per 15 min (`lib/auth-throttle.ts`). `app/page.tsx:205-218` maps every non-ok answer, including `429 rate_limited`, to `{kind:"invalid"}`, which reads "Wrong PIN. Try again." with the correct PIN (G, GF, DS).
- **Re-enable while navigating:** `submit` resets `submitting` in `finally` even on success (`:110-124`). While `router.push` is still loading, the keypad re-enables, and a 5th tap re-submits "1111" (P-dsf).
- **Prod exposure:** prod has no Strict Mode. A shop is one NAT IP, though, so the 429 mislabel is real.
- **Fix:**
  1. Compute `next` outside the updater and add an `inFlight` ref latch. Copy `PinConfirmModal.tsx:249-265`.
  2. Set `submitting` the moment the 4th digit lands, and keep it true when the result is ok.
  3. Map 429 to a new `{kind:"throttled", retryAfterSeconds}` with en and es copy ("Too many sign-ins from this device. Try again in m:ss."). Map 5xx to network.
- **Test:** extend the `tests/pin-confirm-double-submit.test.ts` pattern to `PinKeypad.tsx` (no `setTimeout`/`submit(` inside `setPin` updaters, inFlight guard). Add a pure `pinErrorFromResponse(status, code)` table test.

**#57 #458 follow-up: Cancel and Escape live during the 60 ms.**
- **What happens:** `PinConfirmModal.tsx:259-262` schedules the submit 60 ms out, and `submitting` stays false until `submit()` runs. Cancel (`:391-394`, `disabled={submitting}`), Escape (`:298-301`) and Clear (`:355`) are live in that window.
  - A Cancel closes the modal, but the timer still POSTs, so the closing gets confirmed after the person said cancel.
  - Clear empties the dots while the submit is already scheduled.
- **Fix:**
  - Hold the timer id in a ref and set a `queued` flag (state for rendering, and checked through `inFlight.current` as well) when the 4th digit lands.
  - Cancel, Escape and Clear check `submitting || queued`.
  - Cancel and unmount clear the timer.
- **Test:** extend the source-pin test. Cancel's `disabled` includes the queued flag, the Escape branch checks it, and a `clearTimeout` exists on cancel.

**#58 Maintenance note dated tomorrow.**
- **What happens:** `components/maintenance/EquipmentOverview.tsx:119, :145` render `n.at.slice(0, 10)`, a UTC date. Astra-staff wrote at 02:00Z, which is 10 PM ET on Oct 13, and saw Oct 14. Same pattern at `EquipmentDetail.tsx:19` ("today"), `app/(authed)/maintenance/page.tsx:74` and `lib/maintenance.ts:160`. After 8 PM EDT every closer's note is dated tomorrow.
- **Fix:** use `etCalendarDate(iso)` from `lib/operational-day.ts`.
- **Test:** unit-test `etCalendarDate("2026-10-14T02:00:00Z") === "2026-10-13"`. Add a grep pin that there is no `.slice(0, 10)` on timestamps in `components/maintenance`.

**#59 Cash readout before input.**
- **What happens:** `cash-client.tsx:54-58, :101-106` compute the over/short from empty fields, which gives "Deposit -$200.00 · $200.00 short".
- **Fix:** render the readout only once the projected field and the drawer total (or any denomination) are non-empty.
- **"No labels":** the inputs are wrapped in `<label>` (`:121-133`) and are accessible. The harness reads placeholders, so that part is harness.
- **Test:** pure `cashReadoutVisible(...)`.

### Reports

**#61 Trends temp flags vs Reports Hub (repro first).**
- **Why the numbers can differ:** there are three definitions.
  - Trends counts completions on registry temp items with `count_value > 41` across its bucket window (`lib/reports-trends.ts:327-331`).
  - Hub maintenance rows count fridges whose day status is out of range against each fridge's `safeMaxF` (`lib/maintenance.ts:545-556`).
  - The Hub summary sums the per-report signals for the selected range (`lib/reports-hub.ts:1432-1447`, `report-summary.ts:28-38`).
  - The windows differ too (Trends default range vs the Hub date filter).
- **Next step:** first run the sim SQL for the walk day to see which side is wrong.
- **Fix:** one pure `isTempFlag(reading, safeMaxF)` and one window, shared by both.
- **Test:** pure test of the shared predicate, plus a sim check on both pages for one day.

---

## 3. FIX BATCHES

Order is by value. Each batch touches mostly separate files. The shared overlaps are:
- `lib/i18n/en.json` and `es.json`: each batch adds keys inside its own namespace block, so conflicts are trivial.
- `app/page.tsx`: B2 edits `navigateToDashboard`, B3 edits `handlePinSubmit`.
- `QuotesClient.tsx`: B2 changes only line ~216, B5 everything else. Rebase whichever lands second.

### B1 · Prep forms (opening + mid-day) · **Opus** · issues 1–10
- **Files:**
  - `app/(authed)/operations/mid-day/page.tsx`
  - `components/MidDayPhase2Form.tsx`, `components/MidDayPhase1Form.tsx`
  - `components/production/ProductionConsumptionPanel.tsx`
  - `components/opening/OpeningPrepEntry.tsx`, `components/opening/OpeningChecklistItem.tsx`
  - `app/(authed)/operations/opening/opening-client.tsx`
  - new `lib/prep-display-shared.ts`; `lib/mid-day-shared.ts` (finalized rows)
  - the `w-full` main sweep on the other operations pages
  - en/es keys
- **Plan:**
  1. Overflow and zoom: `w-full` mains, `min-w-0`, `text-base` inputs (#1).
  2. Finalized view, and delete `forms_pending` (#2).
  3. `formatPrepQty` / `roundQty` at every par, need and delta site (#3, #4).
  4. `NumericInput` draft parsing (#5).
  5. No-par label (#6).
  6. Phase-aware title (#7).
  7. Phase 2 static Verified chip (#8).
  8. Recount red only while empty (#9).
  9. Footer reason hint and temp-reveal button (#10).
- **Tests:**
  - `tests/prep-display.test.ts`: `formatPrepQty`, `roundQty`, `parseDecimalDraft`, `prepNeedLabel`, `openingFooterHint`.
  - `tests/mid-day-finalized.test.ts`: `midDayFinalizedRows`.
  - `tests/prep-forms-layout-pins.test.ts`: `w-full`, `text-base`, `min-w-0`, no `forms_pending`, no `OpeningSectionVerify` in Phase 2.
  - Sim check at 390×844: `scrollWidth <= 390` on mid-day Phase 2 with Sauces.
- **Why Opus:** seven files, two live forms that save on blur, and a judgment call on the unit wording. Review with Astra.

### B2 · Shop context · **Opus** · issue 30
- **Files:**
  - `proxy.ts`
  - new `lib/shop-context-shared.ts` + `lib/shop-context.ts`
  - `app/page.tsx` (`navigateToDashboard` only)
  - page defaults: `dashboard/page.tsx`, `reports/page.tsx`, `reports/sales/{page,catering/page,checks/page}.tsx`, `reports/written/page.tsx`, `my-feedback/page.tsx`, `assignments/page.tsx`, `stations/page.tsx`, `operations/opening/page.tsx`, `catering/quotes/page.tsx`, `admin/catering/{prep-demand,lto}/page.tsx`, `admin/stations/page.tsx`, `admin/toast-employees/page.tsx`
  - `QuotesClient.tsx:216` (prop only)
- **Plan:** login to `/dashboard?loc=`, the proxy cookie on explicit `loc`/`location`, `pickShop` everywhere, and checks at read time.
- **Tests:** `tests/shop-context.test.ts` (`pickShop`), a grep test for leftover `locations[0]` defaults, and a two-shop sim walk (log in at P Street, then dashboard → Reports Hub → Catering sales → Prep Demand → New quote should all be P Street).
- **Why Opus:** cross-cutting, edge-runtime proxy, and auth-adjacent. Review with Astra.

### B3 · PIN, language and chrome · **Sonnet** (tight review; screenshots for #53) · issues 53, 54, 55, 57, 59
- **Files:**
  - `components/auth/PinKeypad.tsx`, `components/auth/PinConfirmModal.tsx`
  - `app/page.tsx` (`handlePinSubmit` 429 mapping)
  - `app/(authed)/layout.tsx`, `components/UserMenu.tsx`
  - `components/settings/LanguageSettingCard.tsx`
  - `app/(authed)/cash/cash-client.tsx`
  - en/es keys
- **Plan:** fix the PinKeypad updater and keep the lock through navigation, add the 429 throttled state, add the queued guard on PinConfirmModal Cancel/Escape/Clear, call `router.refresh()` after a language save, make the user menu in-flow, and hold the cash readout until input.
- **Tests:** extend `tests/pin-confirm-double-submit.test.ts` with PinKeypad and the queued guard, add `pinErrorFromResponse` and `cashReadoutVisible` unit tests, and run the screenshot pass for the walk's covered-control list.
- **Note:** this is mostly mechanical, but #57 touches the closing confirm path. Run a sim closing confirm with a fast Cancel.

### B4 · Closing, shift board and Pulse · **Sonnet** · issues 15–21, 23 (and 22 if it reproduces)
- **Files:**
  - `components/ReportReferenceItem.tsx`
  - `app/(authed)/operations/closing/page.tsx`, `closing-client.tsx` (temp ids prop only)
  - `components/ChecklistItem.tsx` (temp label)
  - `components/assignments/ShiftBoardClient.tsx`, `lib/assignments-shared.ts`
  - `lib/pulse/sections.ts`
  - en/es keys
- **Plan:** report routes, aria and subtitle (#15), the report time (#16), the amber copy (#17), the temp label (#18), `closedStationFor` (#19), hiding the break button off-shift (#20), compact station copy (#21), and only overdue counts as late (#23).
- **Tests:** unit tests for `reportRoute` over all `ReportType`, `closedStationFor` and `lateTaskKeys`, plus copy pins (no "AM Prep page", no "check with the opener").

### B5 · Catering · **Opus** · issues 32–40
- **Files:**
  - `lib/catering/ezcater-reconciliation.ts`
  - `components/admin/catering/prep-demand/PrepDemandClient.tsx`
  - `lib/catering/quotes.ts` (`createQuote` / `reviseQuote` lead link; `loadQuote` names)
  - `app/api/catering/quotes/[id]/route.ts`
  - `lib/catering/customers.ts`, `components/catering/customers/CustomersClient.tsx`
  - `components/catering/quotes/QuotesClient.tsx` (empty line, prefill, labels, detail lines)
  - `components/catering/pipeline/PipelineClient.tsx` (lead edit)
  - en/es keys
- **Plan:** fix the jsonb filter first. It is a one-liner and stops a false warning on every lead. Then the copy and W4b text, the lead↔customer link plus quotes on the customer page, client and lead on the quote page, lead edit, empty line, prefill and labels.
- **Tests:** `reviewQueueScope`, `shouldLinkLead`, `appendLines`, `prefillFromLead` and plural-key unit tests, plus a sim run of the catering guide goals 2–6.
- **Why Opus:** several files, a new writer on `catering_pipeline`, and contact-data care.

### B6 · Maintenance dates and report consistency · **Sonnet** (#58), then **Opus** for #61 after the repro · issues 58, 61
- **Files:**
  - `components/maintenance/EquipmentOverview.tsx`, `components/maintenance/EquipmentDetail.tsx`
  - `app/(authed)/maintenance/page.tsx`, `lib/maintenance.ts`
  - for #61: `lib/reports-trends.ts`, `lib/reports-hub.ts`, plus a shared predicate
- **Plan:** fix the ET dates now. Run the sim SQL repro for #61, then unify the temp-flag definition and window.
- **Tests:** an `etCalendarDate` boundary test, a grep pin, and the shared temp-flag predicate test.

Not batched until reproduced: #22, #29, #67.

---

## 4. DECISIONS for Juan (one line each: options → recommendation)

- **D-13 Consumption "Uses:" panel on prep rows** (crew can edit quantities and Case/Each): show to all / read-only for crew / hide below KH → **read-only and collapsed for level < 4, editable for KH+.**
- **D-14 Three save styles** (opening on blur, mid-day per-row Save, closing on tap): unify mid-day to save on blur / leave as is → **move mid-day Phase 2 to save on blur, like opening, after B1.**
- **D-26 "fill first" on every station option:** keep / show only on uncovered stations' first open position → **only where the station is still uncovered.**
- **D-27 Pulse Needs-attention order** (Closing overdue below 8 uncovered rows): keep / sort red items (missed checklists, fridge) first → **red first, stations after.**
- **D-28 PM report roster and default grades:** keep "Good" defaults and app-toucher roster / no default grade and roster from on-shift presence → **no default grade (must pick); seed the roster from today's presence.**
- **D-45 Per-head package Qty:** keep Qty 1 / default Qty = headcount when the package is per-head → **default to headcount for per-head packages.**
- **D-46 What "Confirmed" means:** keep (the kitchen plans a draft, Insights $0) / moving to Confirmed auto-accepts the linked quote / block Confirmed until the quote is accepted → **keep for launch, add a "quote not accepted" chip on Confirmed cards, and the guide says Send → Mark accepted → Confirmed.** A lead with no quote can be Confirmed but feeds no prep.
- **D-47 "Choose your sub — NEEDS PICK":** sub picker on the quote line / kitchen picks / notes field → **guide: write the sub mix in quote notes now; build a sub picker on the line after launch.** Also name the lead on Prep Demand lines.
- **D-48 Phone and email on Add lead** (`contact_phone` column exists): add / leave → **add phone and email to Add lead and to the B5 edit form.**
- **D-49 Stage moves without confirm** (Completed/Lost final): keep / confirm on Completed and Lost only → **confirm on Lost and Completed only.**
- **D-60 Negative theoretical on-hand on Counts:** show the raw negative / clamp to 0 with a "below zero — count it" pill → **pill plus the number in the drawer.** Prod will show negatives wherever receiving is not logged yet.
- **D-62 Reports Hub "Last close":** yesterday by design / the most recent confirmed close (today once confirmed) → **most recent confirmed close.**
- **D-63 Missed vendor cutoff:** yellow advisory as today / red "missed cutoff — call the vendor" once the cutoff has passed with no placed order → **red once passed.** `loadOrderingAttention` already has the data (`lib/ordering.ts:2181`).
- **D-64 Production page:** add an Explore entry for KH+ with the shop default / retire it (batch-vs-bottle captures production in prep rows) → **Explore entry for level ≥ 4, and drop the hard `?location` redirect (use the B2 default).**
- **D-66 One bad prep row blanks AM prep** (strict `PrepShapeError`): keep fail-loud / skip the bad row and show a manager note → **skip and flag. Keep the throw in tests and the audit.**
- **D-80 Walk "app ideas" (assign task saves at once; shorts need a PO; "Photo later" gate):** keep / add confirms → **keep all three** (Retract undoes an assignment; credits need an order by design).
- **D-17 (rider) AM-prep amber note timing:** show all day / show only after a set hour (e.g. 6 PM) → **reword now (B4); show from 6 PM.**

---

## 5. SIM / HARNESS / DATA / NOT-A-BUG (one line each, with guide fix)

**SIM/HARNESS**
- **#24 Closing "Just modified by someone else"** (W): this is a `ChecklistItem` error (`components/ChecklistItem.tsx:348-349`), not the PIN path. The walk ran before #458 (merged 14:28) and tapped "8" by text, and `locate()` takes the **first** element with that exact text in DOM order. Re-verify on the sim after #458 using numbered taps.
- **#31 First tap on P Street does nothing** (4): the `data-gt` numbers die on re-render (`browser-daemon.mjs:74-79`). The logs show `waiting for locator('[data-gt="2"]')` with nothing resolved. A real tap works. B2 removes the need to switch anyway.
- **#41 Search "ezcater"** (FC): search works (`PipelineClient.tsx:183-190` pushes `?q=`, with an empty-state message), and G/DF used it fine. It matches name, company and phone, not the source. **Guide:** "Search finds names, companies and phones. Use Source to find ezCater leads."
- **#42 Board or Prep Demand not refreshed** (5): `router.refresh()` is called (`PipelineClient.tsx:415, :535`). In `next dev` the RSC refetch can outlast the 5 s settle. Optional polish: a pending state on Add and Move.
- **#43 Package picker** (L, T): `selectOption({label})` needs the exact option text. The logs show 15 `selectOption` timeouts. Other testers added packages fine.
- **#56 PIN "no dots"** (2): the dots are `aria-hidden` spans (`PinKeypad.tsx:201-215`). `look` prints text only. They are visible in screenshots. (The 5th-tap part is real and is in #55.)
- **#65 Pulse floor map overlap** (W): this is the 3D view in headless Chromium (SwiftShader). The steplog says "3D map … jumbled, big grey wedge". Check once on a real tablet before calling it a bug.
- **#70 Practice-data leftovers and cold opening** (5): earlier sessions shared one sim (Taken by Nicole, maintenance notes, drafts, other testers' leads). There was no AM prep the night before, so 38 recounts were needed. **Reset between runs** (the sim reset function exists, `cd602f16`).
- **#71 Harness artifacts** (8):
  - Typing by label times out, because named targets only resolve buttons, links, tabs or text (`:103`).
  - Numbered controls go stale after a re-render.
  - `aria-pressed` is never shown, so the Insights range, the Receiving Short/Over state and similar look unpressed (the code sets `aria-pressed`, e.g. `InsightsClient.tsx:63`, `IntakeLineRow.tsx:421`).
  - Values are cut at 40 characters (`:84`), so notes look truncated (DF).
  - The first navigation compiles in dev ("Loading…", the AM Prep link "not navigating", slow totals).
  - **Harness fix:** resolve named targets with `getByLabel` too, print `[pressed]`, and raise the value cap.

**DATA**
- **#25 Closing sections shown as uncovered stations** ("11 uncovered", "0 of 12", Closing Manager / Prep Fridge / Walk-Out on Pulse): `isFloorStation` needs `staffed` plus an active position (`lib/assignments-shared.ts:55-57`). The sim's closing-section stations are flagged staffed with positions. **Check prod's `stations` rows.** If prod matches, set `staffed=false` on closing sections (data step), or the Pulse cries wolf daily.
- **#44 No ezCater orders:** seed one ezCater order per shop on the sim (one matched, one "not in Toast") so the guide's ezCater section can be practised. **Guide:** add "If Source = EZCater shows None and Catering sales shows 0 orders, none have come in."
- **#68 Walk-In names:** rename the "Walk-In Fridge" equipment and the "WALK INS STATION" station rows (CO has no walk-ins, AGENTS.md). Check prod too.
- **#69 Baldor usual order = Cholula:** a sim prefill artefact from the last delivery. Give produce vendors a realistic last delivery on the sim.

**NOT-A-BUG** (with guide fixes)
- **#11 HC Aioli / HP Mayo names:** both rows show their names in `runs/opus-staff-r1/105.png`. The label and the aria come from the same field (`MidDayPhase2Form.tsx:339, :360`; `OpeningPrepEntry.tsx:668, :746`). Not reproduced.
- **#12 "44 of 44 verified":** the counter counts station ticks. Sections are a separate gate. **Guide:** say so.
- **#50 Insights money:** values a lead at its accepted quote, **else its estimated revenue** (`lib/catering/insights.ts:12`). **Guide:** fix the "only accepted quotes count" sentence.
- **#51 Pipeline spans your shops:** each card carries a shop chip. **Guide:** "The board shows every shop you work at. The chip on each card says which."
- **#52 Package Deactivate:** two-step (the label turns into Cancel/confirm). Nothing to fix.
- **#72 Employee dashboard:** Reports and Trends cards are role- and assignment-gated. **Guide:** per-role "what your dashboard shows", and point employees to the board's task links.
- **#73 Pulse 3D/Map:** one toggle whose label names the *other* mode (`FloorCard.tsx:86-89`). **Guide:** "The button switches between the 3D floor and the flat map."
- **#74 Reports Hub → Receiving:** opens the live page, with history under **Recent deliveries** (a row opens `/operations/receiving/<id>`). **Guide:** add that step.
- **#75 Counts Unit:** becomes a pick list once an item is chosen. **Guide:** "Pick a unit."
- **#76 Cash $200 bank:** the drawer total includes the $200 bank. **Guide:** "Even night: drawer total = projected + $200."
- **#77 AM prep box names:** LINE (Sauces, Slicing), PORTIONED (Sides), BACK UP. **Guide:** use the real names.
- **#78 Receiving expected-items notice:** lists only lines with an expected qty that are untouched or emptied (`ReceivingForm.tsx:907-912`). A usual-order prefill with no qty never lists. **Guide:** say when it appears.
- **#79 Vendor credit "—" and Send quote without email:** no price was given, and the app says the quote was marked sent without email. **Guide:** one line each.

**Guide fixes also implied by the BUG fixes:** once B1 lands, remove "the title still says Phase 1" (staff-guide.md:246) and the "verify section first" warning (manager-guide.md:386). Once B4 lands, update the amber note text (manager-guide.md:741). Once B5 lands, drop "On a lead you typed in, it always shows. Ignore it." (catering-guide.md:328). Add mid-day's per-row **Save** and the finalized view to the mid-day section now, and the closing temp line (tap → Temp → **Save**).

## Juan's decisions (2026-10-13)

- **D-13:** option (b). The "Uses:" panel is read-only and collapsed for crew (level < 4); key holder and up can edit it. Enforced on the server too.
- **D-64:** Production goes in the menu for **Employee (3) and up**, not key holder ("key holders aren't the only ones doing prep"). Every gate gets lowered to 3; the yield stats keep their own floor.
- **D-14, D-17, D-26, D-27, D-28, D-45, D-46, D-47, D-48, D-49, D-60, D-62, D-63, D-66, D-80:** approved as recommended ("The rest of the recs are good").
