<!-- tester codex/gpt-6-sol · session sol-staff-r2 -->
# Report — sol — staff guide
Model I am: GPT-6 (Codex)

## Goals

| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in | done | Selected P Street, Employee, Maya Torres; entered PIN |
| 2 | Verify last night’s count and send Phase 1 | partly | Marked 10 stations and entered one test temperature; reopening showed the entries had not saved |
| 3 | Enter morning prep and finish the report | stuck | Phase 2 remained locked |
| 4 | Find or take a station | done | Claimed Crunchy Boi Station |
| 5 | Check the shop now | done | Opened Mid-Shift Pulse |
| 6 | Record the warm prep fridge | done | Saved a maintenance note; it appeared under Maya’s name |
| 7 | Do mid-day prep | partly | Entered 16 test counts; submission failed twice |
| 8 | Close my station and leave a note | partly | App showed 6 of 6 lines complete and saved a note; physical jobs could not be verified |
| 9 | Leave the closing count | partly | Submitted AM Prep with zero placeholders and an explicit test-data note; no physical inventory was available |
| 10 | End my shift | done | Confirmed End my shift; station and tasks disappeared |
| 11 | Switch to Spanish and back | stuck | Tried Settings and user menu; both returned save errors |
| 12 | Log out | done | Signed out to “Where are you?” |

## Where I got stuck

- **2 — `/operations/opening`, “Opening Report”:** Station checks and a temperature appeared entered, but the page said “Not saved — check your connection.” Reopening reset them. Under **Morning → Opening verification (Phase 1)**, the guide says, “The page saves as you go.”
- **3 — `/operations/opening`, “Opening Report”:** Phase 2 stayed locked because Phase 1 could not be submitted. Under **Morning → Opening prep (Phase 2)**, the guide says, “After you send Phase 1, the Phase 2 — Prep Entry tab opens.”
- **7 — `/operations/mid-day`, “Mid-day Prep”:** All 16 on-hand fields showed complete, but submitting twice returned “Could not submit the count.” Under **All day → Mid-day prep**, the guide says, “Tap Submit count → Phase 2.”
- **8 — `/operations/closing`, “Closing Checklist”:** The app accepted six checks and a note, but this test supplied no way to perform or verify the physical jobs. Under **All day → Your station’s closing jobs**, the guide says, “Do a job, then tap its line.”
- **9 — `/operations/am-prep`, “AM Prep”:** Submission worked, but the zeros were placeholders, explicitly identified in the note, rather than observed stock. Under **Night → AM prep (the closing count)**, the guide says, “In the first box of each row, type how much is left.”
- **11 — `/settings`, “Settings”:** Tapping Español showed “Could not save — try again”; the user menu showed “Update failed.” Under **Your stuff → Language**, the guide says, “Under Language, tap English or Español.”

## Notes for the team

- What would make the guide better: Explain what to do when a report says it did not save or could not submit, and provide observed stock and temperature values for a guide test.
- What is hard in the app for no reason: Prep fridge was absent from Maintenance’s equipment list, so I had to use “Other…”. AM Prep required 42 answers without a quick way to move between sections.
- Steps that confused me even when the guide was right: “Prep Fridge” appears as a station but not as a named maintenance item. AM Prep uses ON HAND, PORT, and LINE for the first count box.
- Anything that looked broken: Opening entries vanished after reopening; mid-day count would not submit; language changes failed; one closing line briefly showed “Undo failed.”

## The 5 best things CO-OPS does for a restaurant

1. **Station board:** Shows who covers each station and lets crew claim an open spot, so managers can see coverage.
2. **Mid-Shift Pulse:** Shows uncovered stations, open tasks, fridge status, and catering timing in one place, so the shop can spot gaps.
3. **Maintenance log:** Saved the warm-fridge note with Maya’s name, so a manager has a record to follow up.
4. **Closing checklist:** Tracked six station jobs, a fridge entry, and a note, so the next shift can see what was recorded.
5. **AM Prep:** Saved and submitted a section-by-section count with a note, so the opener has a handoff record—though this test’s counts were placeholders.
