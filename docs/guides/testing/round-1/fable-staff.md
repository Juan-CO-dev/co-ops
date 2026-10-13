# Report — fable — staff guide
Model I am: Fable 5.1 (claude-fable-5-1)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in | done | 7 |
| 2 | Opening verification (Phase 1) and submit | done | ~96 |
| 3 | Opening prep (Phase 2) and finalize | done | ~88 |
| 4 | Find my station / take one | done (claimed Crunchy Boi Station) | 5 |
| 5 | Check the shop right now (Mid-Shift Pulse) | done | 1 |
| 6 | Record the warm prep fridge (Maintenance note) | done | 6 |
| 7 | Mid-day prep count and prep | done, but Save/Finalize buttons would not take a tap (keyboard workaround) | ~101 |
| 8 | My station's closing lines + a note | done (6 of 6, note saved) | 13 |
| 9 | AM prep (closing count) | done ("AM Prep submitted at 6:26 PM by Maya Torres") | 51 |
| 10 | End my shift | done ("Ended shift 6:26 PM") | 3 |
| 11 | Spanish, then back to English | done | 3 |
| 12 | Log out | done | 2 |

Actions = tap / type / press / scroll / back commands. Looks are not counted.

## Where I got stuck
No goal failed. One goal nearly did:

**Goal 7 — Mid-day prep, Phase 2.** Screen: `/operations/mid-day?instance=…`, heading "MID-DAY PREP — Phase 2 — prep". The guide says (heading **Mid-day prep**, step 4): "Type how much you made in **Prepped**. Then tap **Save** on that row." Tapping **Save** worked for all six Veg rows, but for every one of the ten Sauces rows the tap did nothing (the tool timed out on the button) — I tried the button by number, by label, after scrolling, after collapsing Veg, and after opening the row's usage disclosure. Pressing Enter inside the field did nothing either. What finally worked: focus the Prepped field, press Tab (moves focus to Save), press Enter. The same happened with **Finalize prep** (step 6): the tap never landed; Tab-Tab-Tab-Enter from the last field did. The guide is right about *what* to tap; the button does not respond to a tap on that part of the page. That is an app problem, but the guide could add "if Save does nothing, …" until it is fixed.

After **Finalize prep** the page did not say "finalized". It showed: "The interactive count and prep forms ship in the next build. Items below are the template for this mid-day prep." — a placeholder that looks like a broken build. I only knew it worked because the dashboard tile said "Mid-day Prep #1 — Finalized at 6:22 PM by Maya Torres — SUBMITTED". The guide (step 6) says "Tap **Finalize prep**. This checks the Mid-day Prep line on the closing checklist for you." It should also say what you see afterwards and to check the dashboard tile.

## Notes for the team
- What would make the guide better:
  - **Opening Phase 1, step 2 (heading "Opening verification (Phase 1)"):** "Read the fridge thermometer. Type the number in the temp box on that card." Only the first card is open; the other seven temp boxes are inside collapsed cards. Say: "Tap the card's name (▸) to open it and find the temp box." The bottom bar does tell you which temp is missing, which helped.
  - **Phase 2 units.** Rows read "Par: 7 1/3 Pan · Closer count 2 1/3 Pan · Prep need 5 1/3 Pan". I read that as five-and-a-third pans, typed 5.33, and got "Above prep need by 0.33000000000000007 — tap to record reason". The unit is actually "1/3 Pan" (a third-pan), so the need was 5. Explain in **App words** or in **Opening prep (Phase 2)**: "'5 1/3 Pan' means five third-pans. Type whole numbers."
  - **Phase 2 rows with no par** (Tomato "Prep Daily", Caesar Dressing) say "Prep need: verify section first" even after the section is verified. The guide does not mention them. Typing 0 (or what you made) saves the row. Say so.
  - **Mid-day prep:** mention that Phase 2 rows with no par (Caesar Dressing) show no NEED and still need a number saved; mention the "Uses: … tap to confirm usage" disclosure under each row so crew know they can ignore it.
  - **Closing checklist, step 3 ("Your station's closing jobs"):** "Do a job, then tap its line. The line gets a check." The fridge-temp line is different: tapping it opens a small form labelled **COUNT** (placeholder "e.g. 38") with **NOTES (OPTIONAL)** and a **SAVE** button. Add a line for that, and note the label says "COUNT" even though it is a temperature.
  - **Claim a station / Worth knowing:** "When all of a station's lines are done, the station closes. The board says 'Closed' and the time." I never saw "Closed". After my six lines were done, My shift said "Stations 0 of 1 assigned", "No station", the **My station:** card vanished, and Crunchy Boi Station disappeared from the dropdown. If that is intended, say "your station drops off your board once it is closed"; it looks like you lost your station.
  - **Mid-Shift Pulse:** "**Map view** and **3D view** switch the look." I saw only a MAP VIEW button, no 3D view.
  - **Language:** the Settings page itself stays half English after switching ("Settings", "Your app preferences.", the whole Profile card, GO TO PROFILE). Worth a "Worth knowing" line so nobody thinks the switch failed.
  - **AM prep, step 3:** the box is called **PORTIONED**, not "PORT".
  - **End my shift:** after the board says "Ended shift", a **START BREAK** button is still there. Say to ignore it, or get it removed.
  - **Phase 1 "No prior closing data" pink box** appears only after the sections are verified (it showed after Veg). The guide's step 5 reads as if it may already be on the page. Say "it appears near the bottom once you verify a section with no closer data".
  - The Phase 2 section headers still say "Recount items without closer data first" and show a greyed **VERIFIED** button. Harmless, but a "you can ignore that text" line would save a second look.

- What is hard in the app for no reason:
  - Opening Phase 1 with no closer data is ~60 separate taps/entries (10 station Verified taps, 8 temps hidden in collapsed cards, 38 recount boxes, 5 Verify section taps, a reason, Submit). Fine for a real count, but the collapsed cards hide the required temp boxes.
  - Mid-day Phase 2 needs a separate **Save** tap per row, while opening Phase 2 saves when you leave the box. Two different habits for the same kind of row.
  - Saves lag: section headers show "4 of 6 done" for a few seconds after all six are typed; "FINALIZE PHASE 2 (N OUTSTANDING)" counts down late. You wonder whether something was missed.
  - Every prep row carries a long "Uses: 1.9 Duke's Mayo · ~243 oz · 0.08 Lemon Juice …" line. Crew do not need that to type a count.
  - The mid-day prep usage disclosure exposes "Case / Each" toggles and editable ingredient quantities to an employee.

- Steps that confused me even when the guide was right:
  - "Phase 1 — Verification" title staying on the Phase 2 tab (the guide warns; still confusing).
  - "fill first" in the station list: the guide explains it, but 10 of 12 options say it, so it does not help pick.
  - The closing fridge-temp form labelled "COUNT".
  - "Prep need: verify section first" on a row in a verified section.
  - The confirm box for claiming a station and for ending a shift is the same "Confirm change" box with a "Reason for change" dropdown — the guide says no reason is needed, which is true, but the form looks like it wants one.

- Anything that looked broken:
  - Mid-day Phase 2: **Save** (Sauces rows) and **Finalize prep** do not respond to a tap; keyboard Enter on the focused button works.
  - After Finalize prep: "The interactive count and prep forms ship in the next build. Items below are the template for this mid-day prep." shown to a crew member who just finished.
  - "Above prep need by 0.33000000000000007" — raw floating point in a message.
  - Prep need displayed as "0 1/3 Pan" (Roast Beef) — reads as a third of a pan; should be "0".
  - Rows for HC Aioli and HP Mayo show no item name in the Phase 2 lists (opening and mid-day); only the field's accessible label carries the name. Other rows show their names.
  - "Prep need: verify section first" after the section is verified (items with no par).
  - Station disappears from the board after its lines are done instead of showing "Closed".
  - **START BREAK** stays on after "Ended shift".
  - Settings page partially untranslated in Spanish.
  - Maintenance already had two "Prep fridge feels warm" notes by Maya Torres dated today before I wrote mine (leftover practice data, not a bug in itself, but it confuses the test).
  - Opening Phase 1: 38 items had no closer data at all even though an AM prep was assigned last night in the practice data; the closing-checklist footer later said "AM Prep had 0 items saved today - check with the opener." Expected in a practice copy, but worth knowing the morning scenario started cold.

## The 5 best things CO-OPS does for a restaurant
1. **Opening verification ties last night to this morning.** You tick each station, type every fridge temp, and recount anything the closer did not count; Submit stays grey until all of it is in. Nothing opens on a guess, and the temps I typed showed up in the Maintenance log and the Pulse's "8 in range" a minute later.
2. **Par-driven prep needs.** Opening Phase 2 and mid-day prep show Par, what is on hand, and exactly how much to make; a number off the need demands a reason. Crew stop guessing quantities and managers see over/under with a why.
3. **The station-by-station closing checklist with names and times.** Each line is "you · 6:24 PM", notes attach to a line, the fridge temp is captured right there, and progress is counted for the whole shop. A manager can see who closed what without asking.
4. **Mid-Shift Pulse.** One page says what is late ("Mid-day prep is late"), which stations are covered or uncovered, whether the fridges are in range, and which reports are done — refreshed every minute. That is the shift at a glance for anyone on the floor.
5. **The AM prep closing count that feeds tomorrow's opener.** The closer's numbers become the opener's "Closer count", and Submit refuses until every row has an answer. The morning crew starts from a real count, not a memory.
