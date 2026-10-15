<!-- tester deepseek/deepseek-v4-pro · session deepseek-staff-r2 · 396 actions · 1005s -->
# Report — deepseek — staff guide
Model I am: deepseek-staff-r2

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in | done | 11 |
| 2 | Check last night's count at the stations and send Phase 1 of the morning report | done | 82 |
| 3 | Put in morning prep and finish the morning report | done | 55 |
| 4 | Find out which station is yours; take one if none | done | 8 |
| 5 | Check what is happening in the shop right now | done | 3 |
| 6 | Record the warm prep fridge so a manager knows | done | 9 |
| 7 | Do the mid-day prep count to get back to par | done | 47 |
| 8 | Do your station's closing checklist and leave a note on one line | done | 15 |
| 9 | Do the closing AM prep count | done | 50 |
| 10 | End your shift | done | 5 |
| 11 | Switch the app to Spanish, then back to English | done | 5 |
| 12 | Log out | done | 3 |

## Where I got stuck
None — every goal was completed. I hit two UI frictions but was able to work around them:

- **Login PIN**: tapping the on-screen keypad digits did not visibly register (after four taps on "1", the screen stayed on the PIN page). I used **Use system keyboard** to reveal the PIN field and typed **1111** there.
- **Opening Phase 2, Slicing section**: the later rows were not visible in the screen text until I collapsed the earlier prep sections. Scrolling alone did not bring them into view.

## Notes for the team
- What would make the guide better:
  - In **Log in**, add a fallback note: if the on-screen keypad digits don't seem to register, tap **Use system keyboard** and type the PIN in the field.
  - In **Opening prep (Phase 2)**, clarify that the last row in a section only saves after you tap outside it or move focus; I had to tap **Show me what needs fixing** to blur the final box before **Finalize Phase 2** would see it.
  - Add a tip that collapsing completed prep sections reveals later sections when the screen doesn't scroll enough.
- What is hard in the app for no reason:
  - Long prep pages are hard to navigate; the later rows don't come into view reliably without collapsing earlier sections.
  - The language radio tap by label timed out; tapping by control number worked, but the label mismatch is easy to hit.
- Steps that confused me even when the guide was right:
  - Phase 1's "verified" count excludes the prep sections, which made it hard to tell at a glance whether the prep sections were still pending.
  - The maintenance note has no explicit "saved" confirmation; I had to trust the cleared box and look for my note at the top of the list.
- Anything that looked broken:
  - The on-screen PIN keypad appeared to ignore repeated taps (the value stayed at "1" until I switched to the system keyboard).
  - `tap "Select language: Español"` timed out; the same radio worked only when tapped by control number.

## The 5 best things CO-OPS does for a restaurant
1. **Opening Report (Phase 1 + Phase 2)** — checks last night's closing against reality, then turns closer counts into a "prep need" for every item. It saves the opener from doing the math by hand and makes the morning handoff auditable.
2. **AM Prep closing count** — captures what is left on the line at close so tomorrow morning's crew starts from real numbers instead of guessing. It closes the loop with the opening report.
3. **Mid-day prep count-to-par** — lets the line count what's left after lunch and instantly see how much to make to get back to par. It keeps the shop ready for the afternoon without a manager recalculating.
4. **Closing checklist by station** — gives each station its own checkable jobs, temps, and notes, so closing work is visible all day and people can tick things as they finish. It also records who did what and when.
5. **Maintenance log** — lets a crew member quickly record a warm fridge or broken equipment with a timestamped note. It turns a verbal "the prep fridge feels warm" into a record a manager can act on.

