<!-- tester glm/glm-5.3-flash · session probe-glmflash-staff-r0 · 38 actions · 313s -->
# Report — probe-glmflash — staff guide
Model I am: glm-flash (Z.ai), run probe-glmflash-staff-r0

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in, then report the first heading on the screen you land on | done | 8 (P Street → Employee → Maya Torres → 4 PIN digits → confirm) |

**The answer to goal 1:** I land on `/dashboard`. The first heading on the page is **DASHBOARD**, immediately followed by the greeting "Hi, Maya Torres." (Above it, at the very top of the screen, sit a "COMPLIMENTS ONLY" banner strip and the OPERATIONS app header.)

## Where I got stuck
None — the goal completed. Login followed the guide exactly: location tile → role tile (EMP) → name tile → PIN keypad, and the fourth digit signed me in with no Submit button, as promised.

Two small guide-vs-app gaps I hit *after* the goal (not blockers):
- The dashboard's "Reports" section (Opening Report card with "Open / continue"), the "Trends" charts, and the "Maintenance" card the guide describes do not appear on my employee dashboard — under **"### 1. Read today's status"** and **"### 2. Use the Explore list"** the guide says "Reports holds the **Opening Report** card with **Open / continue**" and "Maintenance near the bottom is the fridge-temperature board". What I actually saw under TODAY'S OPERATIONS was only the CLOSING CHECKLIST card ("In progress · 0 of 61 items") followed directly by LOG OUT. Scrolling changed nothing.
- The guide's login note says the "Manager login →" button is in the top right — it is, and I ignored it correctly.

## Notes for the team
- **What would make the guide better:** A one-line note per role on what the dashboard *shows* for an employee vs. key holders — e.g. "As an employee you may not see an Opening Report card on the dashboard; ask a key holder" would have saved me hunting for the missing Reports/Trends/Maintenance sections. Also, the "Your dashboard" section promises sections I couldn't see; either the screenshots predate my build or role-gating isn't mentioned.
- **What is hard in the app for no reason:** The "DASHBOARD" breadcrumb link on the My Performance page would not click (two timeout failures); I had to use the browser back action instead, while the same-style "Back to Dashboard" links on other pages worked fine. Inconsistent back-navigation between pages.
- **Steps that confused me even when the guide was right:** On My Performance, the breadcrumb reads "REPORTS / DASHBOARD" before the page title, which made it look like I was in the Reports Hub; and the dashboard's station dropdown lists 12 stations where 4 pairs share a name with different second labels ("Walk Ins Station · Walk-ins · fill first" vs "Walk Ins Station · Walk-ins / Online") — hard to tell which is which.
- **Anything that looked broken:** The My Performance breadcrumb link (above). Also the dashboard appears not to scroll beyond the closing checklist card, so the guide's "Scroll the page once" instruction found nothing more to see.

Pages I verified working (read-only): My Performance (score 930, 2 MVP wins, Day/Week/Month, Compare toggle), Maintenance Log (8 fridge tiles with safe max + "No reading today", Oven/Fryer tiles, Save note disabled until text — exactly as the guide says), Team Profiles (teammates at my location, my row marked "You"), Reports Hub (date-range filters, summary counts, Operations/Written reports/People/My feedback tabs), and in-app Training rendering this same staff guide with a 12-section contents list.

## The 5 best things CO-OPS does for a restaurant
1. **Named, four-step sign-in.** Location → role → name → PIN, and you're in on the fourth digit. Why it matters: every tick, note and temperature in the app is stamped with a real person's name and time, so the shift record is trustworthy instead of "someone said".
2. **The dashboard opens on what the shop still owes.** "Hi, Maya Torres", today's date, and TODAY'S OPERATIONS with the closing checklist at "In progress · 0 of 61 items" and a one-tap CONTINUE CLOSING link. Why it matters: nobody stands around asking what's left — the day's outstanding work is the first screen you see.
3. **Station claiming and task counters.** "Tasks 0 of 8 assigned", "Stations 0 of 1 assigned", a dropdown of 12 named stations plus CLAIM / CHANGE STATION, and "Team today" showing who's on. Why it matters: it's instantly clear who owns which station and what's still unclaimed, so handoffs and coverage stop being verbal guesswork.
4. **My Performance.** One private page: your score, 2 MVP wins, manager ratings, Day/Week/Month with a compare toggle — deliberately positive, no leaderboard. Why it matters: gives managers and staff a fair, blame-free basis for coaching conversations and recognition.
5. **The Maintenance Log.** All 8 fridges as tiles showing safe max and the latest reading (mine read "No reading today" pre-open), Oven and Fryer tiles carrying their last note, and a note form that stays disabled until you've typed something. Why it matters: a warm fridge becomes a dated, named record the next shift can actually see and act on, instead of a hallway complaint.
