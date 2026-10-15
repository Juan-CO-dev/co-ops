# Report — opus — staff guide
Model I am: Claude Opus 5.5 (claude-opus-5-5)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in | done | 7 |
| 2 | Opening verification (Phase 1), send it | done | ~82 |
| 3 | Morning prep (Phase 2), finalize | done | ~90 |
| 4 | Find my station / take one | done | 5 |
| 5 | Check the shop right now (Pulse) | done | 2 |
| 6 | Record the warm prep fridge | done | 6 |
| 7 | Mid-day prep count back to par | done (fought the screen; see notes) | ~70 |
| 8 | My station's closing lines + a note on one line | done | 12 |
| 9 | Closing count (AM prep) | done | ~58 |
| 10 | End my shift | done | 3 |
| 11 | Spanish, then back to English | done | 3 |
| 12 | Log out | done | 3 |

(Actions = taps, types, presses and scrolls; `look` not counted. Counts include taps that failed and had to be retried.)

## Where I got stuck
Every goal finished, but three places cost real actions:

- **Goal 7, mid-day prep Phase 2, Sauces section** (`/operations/mid-day?instance=…`, heading "MID-DAY PREP / Phase 2 — prep"). Veg rows saved fine by tapping **SAVE**. In Sauces, every tap on **SAVE** and then on **FINALIZE PREP** failed (the tap timed out). The screenshot showed the page zoomed in and pushed sideways after I typed in a "Prepped" box, so the buttons were partly off screen. What worked was keyboard only: type the number, press Tab to move to SAVE, press Enter. To finalize I had to Tab three times from the last row and press Enter. The guide's "Mid-day prep" step 4 says "Type how much you made in **Prepped**. Then tap **Save** on that row." That is right, but on a phone the tap may not land. The guide also says Phase 2 is "(not shown in a photo)", so I had nothing to compare the zoomed screen against.
- **Goal 7, after Finalize.** The page changed to "Phase 2 — prep. The interactive count and prep forms ship in the next build. Items below are the template for this mid-day prep." That reads as if my work was thrown away. Only the dashboard showed it worked: "Mid-day Prep #1 · Finalized at 3:15 PM by Maya Torres · SUBMITTED". The guide says step 6 "checks the Mid-day Prep line on the closing checklist for you". It does not say what the page shows afterwards.
- **Goal 2, Phase 1.** All 38 prep items had no closer count ("—"), so I had to type a recount for every one before **Verify section** turned on. The guide covers this ("Verify section stays grey until each item with no count from last night has a recount"). It was just long: 38 boxes, plus opening and closing each section.

## Notes for the team
- What would make the guide better:
  - **Closing checklist:** the fridge temp line ("Crunchy Boi Fridge temp (≤41°F)") does not tick on one tap. It opens a **COUNT** box ("e.g. 38") and **NOTES (OPTIONAL)**, then **SAVE**. That line also gets no **Add note** link after. The guide ("Your station's closing jobs", step 3: "Do a job, then tap its line. The line gets a check") never mentions this. It also says "You don't type temps here" in Maintenance but never says *where* closing temps go.
  - **"Worth knowing" under closing:** "When all of a station's lines are done, the station closes. The board says 'Closed' and the time." What I saw: my board went back to "No station · Stations 0 of 1 assigned", and the **My station:** card disappeared from Reports. I never saw "Closed". Either the guide or the app is wrong here. A new crew member will think they lost their station.
  - **Maintenance:** the guide example uses **Other…** + "Prep fridge". In the app, the fridge at the "Prep Fridge" station is called **Sauce Fridge** in the Equipment list and on the opening card. Say which list item is "the prep fridge", or the same fridge ends up logged under two names.
  - **Mid-day prep:** add a photo of Phase 2, and say what the page looks like after **Finalize prep**.
  - **Opening Phase 2:** some rows have no par ("Tomato", "Caesar Dressing") and show "Prep need: verify section first" even after the section is verified. Tell people what to type there (I typed 0 and it saved).
  - **Pulse:** the guide says "**Map view** and **3D view** switch the look". I only saw **MAP VIEW**.
- What is hard in the app for no reason:
  - Phase 1 makes you open each of 10 station cards just to type a temp. Each card collapses and starts closed, and the numbered controls shift after every tap.
  - Every Opener-prepped box needs "tap outside" to save. There is no Save button, so it is easy to leave a row half-done.
  - The station dropdown goes back to "No station" right after you claim a station, while the row above says "Crunchy Boi Station · Claimed". Two answers on one card.
  - After **End my shift**, the card still offers **START BREAK** and **CLAIM / CHANGE STATION**.
- Steps that confused me even when the guide was right:
  - The opening page title still says "Phase 1 — Verification" on the Phase 2 tab. The guide warns about this, and it still threw me.
  - The **Confirm change** box offers a "Reason for change" list. The guide says no reason is needed, which was correct, but the list makes it look required.
  - "Uses: 1.02 Iceberg · ~685 oz" appeared under a 5-pan iceberg entry. I didn't know if I was supposed to "tap to confirm usage". The guide never mentions this line.
- Anything that looked broken:
  - Mid-day Phase 2 on a phone: the page zooms and slides sideways after typing in a box, and SAVE / FINALIZE PREP taps stop landing. Only keyboard Tab + Enter worked.
  - After finalizing mid-day prep: "The interactive count and prep forms ship in the next build." This placeholder text shows on a finished, saved report.
  - The Pulse showed "Needs action: Mid-day prep is late" at 3:10 PM. The guide says mid-day prep is "late after 3:30 PM".
  - Spanish is only partly translated on Settings: "Settings", "Your app preferences.", "Profile", "View your team and update your profile blurb." and "GO TO PROFILE" stayed in English while the rest switched.
  - The closing checklist showed "AM Prep had 0 items saved today - check with the opener." before I had started AM prep. This is confusing in the middle of the day.
  - Maintenance already had a "Prep fridge — Prep fridge feels warm — Tue, Oct 13 · Maya Torres" note before I logged mine, possibly left over from an earlier test run.
  - Several taps on section headers failed the first time right after the page re-drew (the tap timed out) and worked on a second try.

## The 5 best things CO-OPS does for a restaurant
1. **Opening prep math done for you:** each row shows Par, last count and "Prep need", and stamps "Saved by Maya Torres at 3:07 PM". The opener knows exactly what to make, and managers see who made what and when.
2. **Short prep forces a reason:** when I made 12 tuna salad against a need of 13, the row would not save until I picked a reason and wrote a note. Managers get the "why" with the shortfall, not just a short line at lunch.
3. **Closing checklist by station, all day:** each line I ticked showed "you · 3:16 PM", I could add a note ("found a broken 1/3 pan lid"), and Progress counted the whole shop (9/61). Closing work is spread across the day and everyone can see who did it.
4. **Mid-Shift Pulse:** one page showed what is late ("Mid-day prep is late"), which stations are covered (1 covered, 9 uncovered), fridge status (8 in range) and handoff notes, updating every 60 s. A lead sees trouble before it becomes a problem.
5. **Fridge temps carried everywhere:** the temps I typed at opening showed up right away in the Maintenance log and on the Pulse ("All fridges checked and in range"), next to a simple note form for a warm fridge. This gives a food-safety record with no extra typing.
