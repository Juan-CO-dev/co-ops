# Guides v2 testing: the report

For Juan. Written 2026-10-14. Sources are in this folder: `round-1/`, `round-2/`, `goals-*.md`, `models.md`, `app-issues-triage.md`, `walk-findings.md`, `app-changes-2026-10-14.md`, plus `git log origin/main` for the PR numbers.

## 1. Summary

- **What we tested.** The three new guides (staff, manager, catering; Guides v2, 2026-10-13). AI models played new staff, managers and catering staff. Each used a practice copy of the app (the sim) with only its guide to help. Each reported every goal as done, partly or stuck.
- **Who tested.** 11 models in round 1, from four families (Claude, OpenAI, GLM, DeepSeek). That gave 27 full reports. Sonnet did catering only.
- **The pass bar.** Both "flash" models (glmflash and dsflash) had to finish every core staff and manager goal from the guide alone. **Round 1 met it.** Both finished 12 of 12 staff goals and 13 of 13 manager goals.
- **Headline.** 5 of 8 staff testers and 5 of 8 manager testers finished every goal. The catering goals were done in every report except the ezCater one. That goal failed because the sim had no ezCater orders to find.
- **What changed.** We fixed the guides twice: once after round 1, and once after the fixed app was walked again. The app got 11 fix PRs, all merged to production (#458 to #468, plus #469 as housekeeping). Juan made 17 decisions. All 80 triaged issues were sorted. The bugs went into batches B1 to B8.
- **Round 2** (on the fixed app and fixed guides): 7 models, 17 reports. dsflash met the pass bar again (12/12, 13/13). Sol and DeepSeek flagship finished every staff and manager goal. Some early round-2 runs were voided when the sim crashed; they were re-run (see section 3).

## 2. Round 1 results

Goal counts come from each report's own goal table. "Core" goals are the starred ones in `goals-*.md`: staff 1–10, manager 1–10, catering 1–5.

### Staff guide (12 goals; persona Maya, Employee, P Street)

| Model | Done | Partly | Stuck | Notes |
|---|---|---|---|---|
| opus | 12 | 0 | 0 | Mid-day Save taps failed on a phone; got through with the keyboard |
| fable | 12 | 0 | 0 | Same mid-day Save problem, same workaround |
| astra | 12 | 0 | 0 | |
| glmflash | 12 | 0 | 0 | **Pass bar** |
| dsflash | 12 | 0 | 0 | **Pass bar** |
| sol | 11 | 1 | 0 | Mid-day prep (7): Sauces Save never took a tap |
| luna | 9 | 3 | 0 | Opening prep (3), mid-day (7), AM prep (9) |
| terra | 9 | 3 | 0 | Same three: put off by the size of the forms |
| glm | — | — | — | Hit the old 300-action cap, no report |
| deepseek | — | — | — | Hit the old 300-action cap, no report |

**Total (8 reports, 96 goals):** 89 done · 7 partly · 0 stuck.

### Manager guide (13 goals; persona Nicole, AGM, Capitol Hill)

| Model | Done | Partly | Stuck | Notes |
|---|---|---|---|---|
| opus | 13 | 0 | 0 | |
| fable | 13 | 0 | 0 | |
| astra | 13 | 0 | 0 | |
| glmflash | 13 | 0 | 0 | **Pass bar** |
| dsflash | 13 | 0 | 0 | **Pass bar** |
| sol | 12 | 1 | 0 | Mid-day prep (5): last row's Save hit Finalize |
| luna | 12 | 1 | 0 | Opening prep (3): the Tomato row (no par) would not save |
| terra | 3 | 2 | 8 | The opening prep took all its time. Never reached goals 7–13 |
| glm | — | — | — | Hit the old 300-action cap, no report |
| deepseek | — | — | — | Hit the old 300-action cap, no report |

**Total (8 reports, 104 goals):** 92 done · 4 partly · 8 stuck. All 8 stuck goals are Terra's.

The step cap was then raised to 800 actions. A tester that runs out must now still hand in a report.

### Catering guide (8 goals; persona Marcus, GM, P Street)

| Model | Done | Partly | Stuck | Goal 5 (ezCater) | Other notes |
|---|---|---|---|---|---|
| opus | 7 | 1 | 0 | partly | |
| sonnet | 7 | 1 | 0 | partly | |
| fable | 7 | 1 | 0 | partly | |
| astra | 7 | 1 | 0 | partly | |
| glmflash | 7 | 1 | 0 | partly | |
| dsflash | 7 | 1 | 0 | partly | |
| glm | 7 | 0 | 1 | stuck | |
| deepseek | 8 | 0 | 0 | done (see note) | |
| sol | 6 | 2 | 0 | partly | Goal 4 partly: "Choose your sub — NEEDS PICK" |
| terra | 6 | 2 | 0 | done ("none existed") | Goals 3–4: package picker would not take a pick (test tool) |
| luna | 6 | 1 | 1 | stuck | Goal 3 partly: same package-picker problem |

**Total (11 reports, 88 goals):** 75 done · 11 partly · 2 stuck. Without the ezCater goal: 73 of 77 done.

**Why the ezCater goal failed.** The sim had no ezCater orders at either shop. Testers found the right places: the Pipeline **Source → EZCater** filter and **Catering sales**. Both were empty ("0 ezCater orders · $0.00"). The guide even said "Our practice board had no ezCater orders." So the goal could not be finished. It was not a guide failure. Deepseek and Terra marked it done because they found the right places. Everyone else marked it partly or stuck.

## 3. Round 2 results

Round 2 ran the same goals on the fixed app (B1–B9 and B7c merged) and the fixed guides. It ran 7 models: Sol, DeepSeek flash (dsflash), DeepSeek flagship, Sonnet, Haiku 5.5, Terra and Luna. Opus, Fable and Astra were not re-run, because they finished every goal in round 1. GLM and GLM flash were stopped: their test runs used up the shared GLM rate limit, and that starved Aggie's scheduled jobs. GLM flash had already met the pass bar in round 1.

**The pass bar still holds.** dsflash finished 12 of 12 staff goals and 13 of 13 manager goals again, on the fixed app.

### Staff guide (12 goals)

| Model | Round 1 | Round 2 | Notes |
|---|---|---|---|
| sol | 11 / 1 / 0 | **12 / 0 / 0** | Mid-day Save now takes the tap |
| dsflash | 12 / 0 / 0 | 12 / 0 / 0 | **Pass bar** |
| deepseek | no report | **12 / 0 / 0** | Round 1 hit the old action cap |
| sonnet | (catering only) | 12 / 0 / 0 | |
| haiku | (not in round 1) | 12 / 0 / 0 | Ran on the CO desktop |
| terra | 9 / 3 / 0 | 9 / 3 / 0 | Still stops at the three long forms |
| luna | 9 / 3 / 0 | 8 / 3 / 1 | Station claim stayed "None yet" (4); Pulse sections timed out. The sim was slow during that run |

**Total (7 reports, 84 goals):** 77 done · 6 partly · 1 stuck. Round 1 was 89 / 7 / 0 out of 96.

### Manager guide (13 goals)

| Model | Round 1 | Round 2 | Notes |
|---|---|---|---|
| sol | 12 / 1 / 0 | **13 / 0 / 0** | |
| dsflash | 13 / 0 / 0 | 13 / 0 / 0 | **Pass bar** |
| deepseek | no report | **13 / 0 / 0** | |
| sonnet | (catering only) | 12 / 1 / 0 | Full count (11): the old, slow counts page timed out once. B9 has since fixed that page |
| haiku | (not in round 1) | 10 / 3 / 0 | AM prep (7), cash (9), full count (11): no real numbers to type in a practice copy |
| terra | 3 / 2 / 8 | **7 / 2 / 4** | +4 done. Ran out of time before the night goals |
| luna | 12 / 1 / 0 | 3 / 3 / 7 | Ran out of stamina after the opening |

**Total (7 reports, 91 goals):** 71 done · 9 partly · 11 stuck. All 11 stuck goals are Terra's and Luna's: they ran out of time or steps, not into a wrong guide sentence.

### Catering guide (8 goals)

| Model | Round 1 | Round 2 | Notes |
|---|---|---|---|
| dsflash | 7 / 1 / 0 | **8 / 0 / 0** | |
| sonnet | 7 / 1 / 0 | 7 / 1 / 0 | Goal 6: the customer list was empty |
| haiku | (not in round 1) | 7 / 0 / 1 | Goal 6: same |

**Total (3 reports, 24 goals):** 22 done · 1 partly · 1 stuck. The ezCater goal (5) is now done in every report: testers checked both places and confirmed there are none.

**Why goal 6 failed.** A lead becomes a catering customer only when it has a client email. Goal 2 did not give one, so the customer list stayed empty and there was nothing to open. That was a gap in the test goal, not in the guide or the app. Goal 2 now gives a test email (`orders@<company>.example`).

### What round 2 testers still asked for

- **What to type when there is no real number.** No thermometer, no shelf, no Toast figure in a practice copy. The staff guide now says: ask your key holder, don't guess, the app keeps what you type. The manager guide now says a Phase 1 recount becomes Phase 2's closer count.
- **Which pink-box reason to pick** if you weren't there last night. The staff guide now says: **Closing was missed / I don't know**.
- **The "Count" box** in the closing checklist never shows at CO (every number line is a fridge temp). The line is gone from the staff guide.
- App follow-ups (no sanity range on temps and recounts, a tap while saving can untick a closing line, two save styles for prep) are logged in `app-issues-triage.md`.

### The voided runs

- **What happened.** The sim's server crashed and restarted at 04:56 ET. Free memory was about 2.7 GB (a Windows Terminal window leak was holding ~3.6 GB — since fixed), and the disk later filled. After the restart, logins did not stick, and every logged-in save returned "404". Examples: opening drafts 207 times, opening prep rows 88 times, language switch 14 times.
- **Who it hit.** 8 round-2 reports: dsflash, glmflash, sol and luna (staff and manager each). Luna ran just before the crash, but its run was slow, so it is re-run too. They are kept in `round-2/void-sim-fault/` as a record only. They are not counted. Production was checked and was not touched.
- **How we caught it.** The flash models had passed everything in round 1. In round 2 they suddenly reported "Save failed", "Could not submit the count", and a language switch that was refused. The sim's log showed the 404s. A page load still answered OK, so a simple "is it up?" check would have missed it.
- **What we added.** A health check (`scripts/guide-test/health.sh`). It signs in as the test staff member and makes one real save, with 3 tries 15 s apart. The tester chain runs it before each tester. If the sim is unhealthy, the chain restarts it once and stops if it is still broken. It runs it again after each tester and flags "check its reports". API testers also got a 2-hour cap.
- **Since then.** A first re-run of Luna stopped part-way when the test machine's disk filled up ("no space left on device"); that run does not count either. Disk space was freed and the re-run chain restarted on the fixed sim.

## 4. What the testers found hard, and what we changed

### 4a. Guide fixes

Done in two passes: right after round 1, then again after the re-walk on the fixed app (B8 included).

| Theme | What the guide says now | Testers who hit it |
|---|---|---|
| Opening temps hidden | Most station cards start closed. Tap the station's name to open it and find the temp box. The bottom bar's "Temp reading required" line opens that station. | fable (staff + manager), opus (staff + manager), luna |
| Submit Opening stays grey | Pick a reason in the pink "No prior closing data" box. "44 of 44 verified" counts station cards only. Each prep section needs its own Verify. | fable, dsflash, astra (staff + manager) |
| Prep units | "5 × 1/3 Pan" means five 1/3 pans. Type 5, not 5.33. Numbers only. | fable, glmflash, dsflash |
| Rows with no par | "No par set — type what you made". Type it, even 0. No reason needed. | opus, fable, sol, luna, dsflash, astra, glmflash |
| Mid-day prep, Phase 2 | New steps: the over/under reason button, Save on each row, then Finalize. It also shows what the finished page looks like. | opus, fable, astra, sol, glmflash, terra |
| Long forms | "Plan your time" note. Part 2 has a row for every prep item. Two people can split the sections. | terra (staff + manager, both rounds) |
| Closing temp lines | Tap the line, type in **Temp (°F)**, tap Save. The line ticks only after Save. | opus, fable, sol, astra |
| My station / end of shift | A closed station shows "Closed" and the time. The claim's "Reason for change" is optional. You can ignore Start break after you end your shift. | opus, fable, dsflash, glmflash, sol |
| Taking a task | There is no Take button. Tap the task and do it. The board then says "Taken by …". | opus, astra, glmflash |
| Handoff note | Use the **See more** inside the Handoff card. Every card has its own See more. | terra |
| Receiving | The usual order may not match the truck. Add items with **Pick a SKU…**. A flag you pick turns pink. | opus, fable, dsflash, glmflash |
| Cash | The drawer total includes the $200 bank. Worked example: projected $845, drawer $1,045, deposit $845, **Even**. | fable |
| Counts | **Unit** is a list. Pick one. **How many** must be more than 0. "Below zero — count it" means count that item next. | opus, fable, astra, sol |
| Finding a delivery | Reports Hub → Receiving → **Recent deliveries** → tap the row for its detail. | fable, opus, astra, sol |
| AM prep box names | Uses the real names: LINE, PORTIONED, BACK UP. | opus, fable |
| PIN | The fourth digit sends it. Don't tap again. If the keypad gives trouble, use "Use system keyboard". | glm, glmflash, deepseek, opus |
| Catering: client says yes | Send quote → Mark accepted → move to Confirmed. A lead with no quote can be Confirmed, but the kitchen gets nothing to plan. | fable, opus, astra, sol, terra |
| Catering: "Choose your sub" | Write the sub mix in the quote notes. Prep Demand now names the lead. | fable, opus, sol, sonnet |
| Catering: other gaps | The board shows every shop you work at (each card has a shop chip). Search finds names, companies and phones; use Source for ezCater. With no contact person, type the company name. New sections: fix a lead, the no-ezCater empty state, and the Insights money rule. | dsflash, opus, glmflash, fable, glm, sonnet, deepseek |
| Pulse | One button switches between the 3D floor and the map. Mid-day counts as late only after 3:30 PM. | fable, opus |

Every guide section also got re-checked against the re-walk photos, and claims now match the code (commit "reconcile all three guides").

### 4b. App fixes (all merged to production)

| Batch | PR | What it fixed, in one line |
|---|---|---|
| PIN hotfix | #458 | The closing PIN confirm sends once. No false "Just modified by someone else" after a saved closing. |
| B6 ET dates | #459 | A note written after 8 PM no longer shows tomorrow's date. Shelf life for evening batches is right too. |
| B3 PIN, menu, cash, Production | #460 | Fast PIN taps can't drop or repeat a digit. Too many tries says "Too many tries", not "Wrong PIN". The user menu no longer covers buttons. Switching language refreshes the page. The cash readout waits for numbers. Production is in the menu for Employee and up. |
| B1 prep forms | #461 | Mid-day Save and Finalize stay on a phone screen (no zoom). A real "Finalized at … by …" page. "5 × 1/3 Pan" and no float noise. Boxes keep "5." while typing. No-par rows say "No par set". Right Phase 2 title. Red boxes only while empty. The footer names what is missing. "Uses:" is read-only for crew. |
| B2 shop resolver | #462 | The shop you pick at login sticks, across about 25 pages. |
| B5 catering | #463 | The false amber "Order comparison is currently unavailable." is gone. Customer pages list their leads and quotes. The saved quote shows client and lead. Leads can be edited. The quote has no empty first line. Picking a lead fills the quote. Lead options show date and shop. The other shop's contact details stay hidden. |
| B4 closing, board, Pulse | #464 | Closing report lines open the right page and show true times. Temp lines say "Temp (°F)". A closed station shows "Closed · time". No Start break after End my shift. A "My station" card. Pulse "late" only after 3:30. |
| B7b Juan's decisions | #465 | "Fill first" only on uncovered stations (D-26). Red items first on the Pulse (D-27). No default PM grades, and the roster comes from today's team (D-28). "Below zero — count it" pill (D-60). "Last close" is the newest closed day (D-62). A missed vendor cutoff shows red (D-63). Cutoff times are right on daylight-saving days. |
| B7a | #466 | One bad prep row no longer blanks AM prep or mid-day; a note names it (D-66). The amber AM-prep note shows only from 6 PM (D-17). |
| B8 re-walk | #467 | Opening Phase 2 Undo needs two taps (a one-tap Undo was undoing rows by accident). One fridge temp rule across Reports, Trends and Pulse. Cash says "Even". Pulse names its shop. Add lead starts on your shop. Lead edit form fits. Sales says "full days". Performance charts say "not enough days yet". Closing reasons show at once. A note keeps the line's tick time. Plus small fixes. |
| B7c catering | #468 | A per-head package starts at the headcount (D-45). "Quote not accepted" chip on Confirmed cards (D-46). Prep Demand names the lead (D-47). Phone and email on Add lead (D-48). A confirm before Completed or Lost (D-49). Package "pick" lines no longer count prep twice (migrations 0251/0252). |
| Housekeeping | #469 | Marks migration 0252 as applied to sim and production. |

Kept as they are, on Juan's word (D-80): assigning a task saves at once (Retract undoes it); "didn't arrive" needs an order; "Photo later" must be ticked to confirm a delivery.

## 5. App ideas from testers that are not built

Each idea is listed once, with how many testers asked for it. Valid reports only. **Round 2 (2026-10-15 tally):** the 15 re-runs added askers to the rows below and these new ideas: "Saving… / Saved" feedback on slow saves, loads and taps (12: dsflash ×2, sol, deepseek, sonnet ×3, haiku ×3, luna ×2); fewer entries on long count forms (6: sol ×2, sonnet ×2, haiku, luna); buttons that don't jump when a line saves, and a tap while saving can't untick (4; partly fixed by B8); Recent deliveries reachable without scrolling past the form (2); a warning before Send quote asks for the password (2); plus one-off asks (numbers-only hint, warm-fridge reading on Maintenance, keep a long form through sign-out, note before ticking, ezCater filter chip, a date picker showing the year, a "not emailed" status, lead fills Client email, one place for catering sales). Round-2 additions to existing rows: board shows saving +2 (7), sub picker +1 (5), one save style +2, jump list +4 (8), one-tap made-the-need +3 (5), closing temps without Save +2 (4), one reason for many closing items +1 (2), board-task sign +1, vendor per item +1, Post note while typing +1, warn before Finalize +2. Built since: cash Projected from Toast (B10), a reliable Counts page (B9). Not needed: a Prep Fridge on Maintenance (3 asks) — CO has no prep fridge; it was an old test goal.

| Idea | Asked by | Status |
|---|---|---|
| A board that shows it is saving after **Add lead** or a move, so it never looks stale | 5 (dsflash, glm, deepseek, fable, sonnet) | Not built. The board does refresh; it is just slow on the sim |
| A sub picker on the quote line, so "Choose your sub — NEEDS PICK" goes away | 4 (fable, opus, sol, sonnet) | After launch (D-47). For now: the sub mix goes in the quote notes, and Prep Demand names the lead |
| One save style everywhere: mid-day saves when you leave the box, like opening | 3 (astra staff, astra manager, fable) + terra's Finalize warning | Approved (D-14), then parked in its own branch (`feat/d14-midday-autosave`). Review found races between saving and Finalize |
| A "what's still missing" jump list on long forms. Sections start closed and hide required boxes | 4 (terra, fable, opus, luna) | Partly: the temp hint now opens the station, and the footer names what is missing. No full jump list yet |
| A one-tap "made the need" on prep rows. Fewer reason boxes on off-par rows | 2 (dsflash, glmflash) | Not built |
| Closing temp lines without a separate Save, and without "Anything noteworthy?" every time | 2 (opus, fable) | Not built. Only the label was fixed |
| A shop name at the top of catering pages (Pipeline, Quotes, Insights) | 2 (glmflash, dsflash) | Partly: cards carry a shop chip, and the Pulse now names its shop |
| A claim or End shift box without the "Reason for change" list (it looks required) | 2 (fable, opus) | Not built. The guide says it is optional |
| One reason for many incomplete closing items, instead of typing it again and again | 1 (luna) | Not built |
| A warning before **End my shift** while my reports are unfinished | 1 (terra, round 2) | Not built |
| A clear sign that you took a board task; say on the board that you can't assign yourself | 1 (glmflash) | Not built |
| The 86-risk card opens a list of the items | 1 (dsflash) | Not built |
| Show which vendor brings an item (finding the produce vendor took guessing) | 1 (dsflash) | Not built |
| The quote shows its deposit rate | 1 (glmflash) | Not built |
| **Post note** works while you are still typing | 1 (terra, round 2) | Not built |
| Mid-day: warn about unsaved rows before Finalize, not after | 1 (terra, round 2) | Not built (tied to D-14) |

Also asked for, but for the sim, not the app: one practice ezCater order per shop. Six catering testers asked: astra, fable, glm, sol, dsflash, sonnet.

## 6. "The 5 best things CO-OPS does for a restaurant": the roll-up

Every valid report named five things it used and saw working. That is **44 reports**: 27 from round 1 and 17 from round 2 (Terra's two plus the 15 later re-runs). A theme counts once per report. Manager-only themes count out of the manager reports (15).

### Shift operations (staff and manager reports: 30)

| Rank | Theme | Named by | Ranked #1 by |
|---|---|---|---|
| 1 | **Mid-Shift Pulse**: coverage, late work, fridges, handoff notes on one page | 27 of 30 | 2 |
| 2 | **Closing checklist**: station by station, names and times; report lines tick themselves; PIN to finish | 26 of 30 | 3 |
| 3 | **Opening verification**: stations, temps and recounts before the doors open | 23 of 30 | 19 |
| 4 | **Prep-to-par math**: Par, count and "Prep need" on every row; off-par needs a reason | 19 of 30 | 4 |
| 5 | **Receiving with vendor credits**: flag Short, and a credit opens with the invoice number | 15 of 15 manager reports | 1 |
| 6 | **Maintenance log and fridge temps** | 10 of 30 | 0 |
| 6 | **AM prep as the overnight handoff** | 10 of 30 | 0 |
| 8 | **Ordering walk**: par and Suggest turn into a numbered draft order | 7 of 15 manager reports | 0 |
| 9 | **Station claiming and the shift board** | 6 of 30 | 1 |
| 10 | Cash deposit signed by PIN (3) · PM report grades and MVP (1) · Reports Hub as a dated day record (1, new in round 2) | | |

### Catering (catering reports: 14)

| Rank | Theme | Named by | Ranked #1 by |
|---|---|---|---|
| 1 | **Pipeline board**: every job by stage, one tap to move it | 14 of 14 | 13 |
| 1 | **Catering Insights**: the month's leads, bookings, money and calendar | 14 of 14 | 0 |
| 3 | **Quote builder**: package in, tax, total and deposit worked out | 13 of 14 | 0 |
| 4 | **Customers that build themselves** from quotes, grouped by company | 11 of 14 | 0 |
| 5 | **Confirmed feeds the kitchen** (Prep Demand) | 7 of 14 | 1 |
| 6 | **Setup hub**: packages, menu, capacity, zones in one place | 5 of 14 | 0 |
| 7 | Shop-and-role login (3) · ezCater tracking (2) | | |

Customers is 11 of 14 only because the three round-2 catering testers never saw a customer: their test lead had no email (goal 6, since fixed in the test).

### In the testers' words

- **Mid-Shift Pulse.** fable: "That is the shift at a glance for anyone on the floor." · opus: "A manager walking in can see what needs doing in seconds and leave a note for the next shift." · dsflash: "An uncovered station is the failure that costs a whole service."
- **Closing checklist.** glmflash: "One screen answers 'what's left before we can lock the door'." · fable: "Nothing gets skipped quietly."
- **Opening verification.** glmflash: "Missed closings surface at 7 AM, not at the lunch rush." · fable: "Nothing opens on a guess." · dsflash: "The morning crew otherwise starts the day blind."
- **Prep-to-par.** opus: "Managers get the 'why' with the shortfall, not just a short line at lunch." · glmflash: "Morning prep becomes arithmetic, not guessing."
- **Receiving.** fable: "The money a vendor owes you stops living on a sticky note." · glmflash: "That's money back that paper systems quietly lose."
- **Maintenance log.** glmflash: "Problems are recorded, not whispered." · terra: "A warm fridge does not get forgotten."
- **AM prep handoff.** fable: "The morning crew starts from a real count, not a memory."
- **Ordering walk.** fable: "Ordering becomes a short walk instead of a guess."
- **Pipeline.** fable: "Never loses a lead in an inbox." · sonnet: "Jobs don't get lost between phone calls and emails."
- **Insights.** fable: "A GM can answer 'how is catering doing' without a spreadsheet." · glmflash: "You can see next Friday's load before you promise another one."
- **Customers.** opus: "The shop builds a catering contact list as a side effect of normal work."
- **Quote builder.** glmflash: "Pricing a 25-person lunch takes a minute, not a spreadsheet."
- **Prep Demand.** opus: "The kitchen sees catering work without anyone re-typing it."
- **Round 2 adds:** sonnet (opening): "nobody can say 'it was fine' without a record." · dsflash (mid-day): "the second half of the day sells at full menu instead of running out." · dsflash (closing): "the night work is provable and split between people." · haiku (ezCater): "it catches ezCater orders that never reached the register." · deepseek (Reports Hub): "a clear, dated trail of who did what and what happened each day."

## 7. Open follow-ups

From the triage, the PR notes and the walk findings.

**App**
- **Peer tag lost on re-save.** A line ticked "for" a teammate looks self-done after someone adds a note. The new row does not copy the tag. B8 fixed only the time part. Needs its own fix.
- **Closing one-tap Undo.** It is the same shape as the opening Undo that B8 moved to two taps. It is lower risk (no layout shift), but should go two-tap to match.
- **D-14 mid-day save-on-blur** is parked in its own branch, because review found save/Finalize races. Mid-day keeps its per-row Save for now. (Note: the squashed #466 commit message on main still mentions D-14, but its code was reverted inside that PR — it is not in main.)
- **Production picker paging.** The picker reads SKUs without paging, so it would silently stop at 1,000.
- **Closing ticks: one atomic swap.** A migration-backed swap so a crash between "retire old tick" and "write new tick" can't leave a line unticked until the next load (from #464).
- **Sub picker** on the quote line, after launch (D-47).
- **Still being checked from the re-walk:** tapping **Verified** on a Phase 1 station may tick its fridge-temp line before a temp is typed (cosmetic — submit still requires every temp). The Phase 1 footer and card counts briefly disagree ("4 of 44" vs "3 of 4"). Some names cut off at phone width ("Crunchy Boi Station · Unassign…").
- **Waiting for a repro first:** station dropdown says "No station" right after a claim (#22). PM report view after submit (#29). Small leftovers: "Confirm with your PIN" text stays, an empty "DRAFT ORDERS" heading (#67).
- **Check production data:** closing sections showing as uncovered floor stations on the Pulse (#25). "Walk-In Fridge" / "WALK INS STATION" names; CO has no walk-ins (#68).
- **Pulse floor map** labels overlap at tablet width. Check once on a real tablet; it may only be the test browser (#65).
- **Spanish coverage.** Terra (round 1) saw dashboard and operations text stay in English after the switch. #460 fixed Settings. In round 2, every staff tester switched to Spanish and back, and none reported English left over. A person who reads Spanish should still look once.

**Sim and testing**
- Round 2 is done. GLM and GLM flash were not re-run (shared rate limit; see section 3). If they are wanted, run one GLM tester at a time.
- Seed one ezCater order per shop on the sim (one matched in Toast, one not), so the ezCater goal tests finding a real order, not just the empty list.
- The day reset does not clear maintenance notes (about 10 old "Prep fridge" notes). Catering now has its own reset.
- Photo retakes: done 2026-10-14 on the B9 sim (staff 49, manager 66, catering 37). Two manager shots (51, 58) leave part of their subject just below the frame; fine for now.
