# Report — haiku — staff guide
Model I am: Haiku 5.5 (claude-haiku-5-5)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in | done | 7 |
| 2 | Opening verification (Phase 1), then send it | done | about 90 |
| 3 | Opening prep (Phase 2), then finish the report | done | about 100 |
| 4 | Find my station; take one | done (took Crunchy Boi Station) | 4 |
| 5 | Check what is happening now (Mid-Shift Pulse) | done | 1 |
| 6 | Record that the Sauce Fridge feels warm | done (box cleared; I could not see my note in the list, see Notes) | 8 |
| 7 | Mid-day prep count to par, then finalize | done | about 60 |
| 8 | My station's closing lines, and a note on one line | done | about 12 |
| 9 | AM prep count, then submit | done | about 55 |
| 10 | End my shift | done (I first finished my station's closing lines, as the guide says closers do) | 3 |
| 11 | Switch to Spanish, then back to English | done | 4 |
| 12 | Log out | done | 2 |

Counts are approximate. They leave out the screen reads.

## Where I got stuck
No goal was stuck. All 12 goals were done. Two places where I was guessing, not stuck:

- **Opening, Phase 1, pink box ("No prior closing data detected").** Every item had no closing count, so I had to pick a reason. The guide, under **Opening verification (Phase 1)**, says "Pick the reason that fits: Location was closed (planned) or Closing was missed / I don't know." It does not say which one a new crew member should pick. I picked "Closing was missed / I don't know" because I could not tell what happened last night.
- **Opening, Phase 1, temp boxes and recounts.** The guide, under **Opening verification (Phase 1)**, says "Read the fridge thermometer" and "Type what you see in the Opener recount box." This practice copy has no thermometer and no shelves to count. I typed 36 for every fridge and 3 for every recount. See Notes.

## Notes for the team
- **What would make the guide better:**
  - Say what to do when you cannot read the thermometer or count the shelf. For example: "If you cannot read it, ask a key holder. Do not guess." The guide assumes you can always read it.
  - Under **Opening verification (Phase 1)**, say which pink-box reason a crew member picks when they were not there last night.
  - Under **Opening prep (Phase 2)**, the guide says a row without a reason shows "Add a reason to save". The screen shows "Below prep need by 10 — tap to record reason" (or "Above prep need by N"). I saw this after I typed a wrong number, then corrected the number, so I never opened the reason dialog.
  - Under **AM Prep (the closing count)**, the guide says the Sides column is **PORT**. The screen says **PORTIONED**.
- **What is hard in the app for no reason:**
  - Mid-day prep (**Phase 2**) needs a **SAVE** tap on every row, including each of the 10 sauces. Opening Phase 2 saves a row when you leave its box. The two screens work differently, and both are called "prep".
  - With no closing data, Opening Phase 1 asks for a recount on every item (38 boxes this morning), one section at a time. I did not find a faster way.
  - The app accepts any number you type for temps and counts. There is no range check on a recount. I typed a count of 3 for 38 items and it became the "Closer count" and changed the "Prep need" on Phase 2.
- **Steps that confused me even when the guide was right:**
  - Opening Phase 2: the **Caesar Dressing** row showed my 0 but no **Undo** button until a later action. It took a second look to be sure it had saved.
  - Closing checklist: the guide says "A few lines ask for a number ... in a box called Count." Only the temp line I opened had a box, labelled **TEMP (°F)** with the placeholder "e.g. 38". The guide's "Count" name did not appear on any line I saw.
- **Anything that looked broken:**
  - **Maintenance:** I picked **Sauce Fridge** in the equipment list. The first text I typed into "What's going on?" did not register. The box stayed empty and **SAVE NOTE** stayed grey. I typed again and it worked. After saving, the box cleared, as the guide says, but my note was not visible in the first part of the list I could read. I did not confirm it saved.
  - **Maintenance shows my fake temps as real.** My 36°F entries from the Opening Phase 1 temp boxes appear on Maintenance as "Sauce Fridge OK 36°F", "Walk-In Fridge OK 36°F", and so on. The app takes whatever is typed and makes it the fridge record. A new crew member who types a wrong number changes what the manager sees. The guide should say so.
  - **Opening, Phase 1 → "SUBMIT OPENING"** showed "SUBMITTING…" for at least two reads before the page changed to Phase 2.
  - **Navigation:** after many taps, the screen said "Loading…" for a moment. One tap on **Maintenance** failed while it was loading and worked on the second try.
  - **Long lists:** the screen text I could read stopped partway through the longest lists (Phase 2 **Sauces** and **Slicing**, and the Mid-day sauces). I could only read the bottom rows after I collapsed the finished sections. I cannot tell whether this is the app or my reading tool.
- **Numbers I made up (practice data, do not trust):**
  - Opening Phase 1: 36 in all eight fridge temp boxes, including the Sauce Fridge and the Crunchy Boi Fridge.
  - Opening Phase 1: 3 in all 38 recount boxes.
  - Opening Phase 2 and Mid-day prep: I typed amounts that matched the need shown, so the rows say "At par".
  - AM prep: counts I invented; NO to all four Misc questions (Meatball mix ready, Meatballs ready to cook, Meatballs for reheat, Cook Bacon). I do not know what those questions mean, and I did not check the shelves or the meatballs.
  - Closing note on the Restock line: "Restock done. Walk-in and sauce shelves are full." I did not check the shelves.
- **Process note:** I used only `guide.md`. Once I tried to read a screenshot file (`005.png`) to see a screen; it did not exist, and I did not read anything else. One write to a temp file was refused. Nothing else was opened or searched.

## The 5 best things CO-OPS does for a restaurant
From what you saw and did today, name the 5 things in this app that would help a restaurant the most, best first. For each: what it does, in one plain line, and why it matters to the people running the shop. Only name things you used or saw working during your goals today, not things the guide promised or you only read about.

1. **Opening Report (Phase 1 verify, Phase 2 prep).** Each station is checked against last night's close, the fridge temps are entered, and each prep row shows par, closer count and need, with the name and time when saved. Why: it catches food-safety and count gaps before the doors open, and the people opening know who did what.
2. **Mid-day prep count to par.** You type what is on the line, the app shows how much each item needs, and **Finalize prep** locks it with your name and time. Why: the lunch rush leaves gaps, and this tells the line exactly what to make next.
3. **Closing checklist by station.** Each line ticks with your name and time, it takes a note, and a station closes by itself when its lines are done, with progress shown at the top. Why: nobody has to remember the close at the end of the night, and the key holder sees what is really left.
4. **Mid-Shift Pulse.** One live page with **Needs attention** ("Mid-day prep is late" showed up for me), station coverage on a map, fridge status ("8 in range · 0 out of range"), and handoff notes. Why: a manager or crew member can see what is late or uncovered without walking the floor.
5. **AM prep count sheet.** You count what is left in each section, the **TOTAL** fills in by itself, and the sheet submits with your name and time. Why: the morning crew starts from a real count, not a guess, and the next day's opener has something to check against.
