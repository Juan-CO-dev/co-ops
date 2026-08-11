# Angel Reyes - Shift Simulation Journal
**Date:** 2026-08-11 (Tuesday)
**Location:** Capitol Hill (MEP)
**Role:** Key Holder

## Shift Goals Progress

### GOAL 1: Log in
**Status:** DONE
- Root URL had nobody signed in already, went straight to tile login
- Selected: Capitol Hill location tile, Key Holder role, Angel Reyes name
- PIN keypad (not a text field) — clicked 5-5-5-5, auto-submitted on 4th digit
- Landed on /dashboard, greeted "Hi, Angel Reyes." · MEP · Capitol Hill
- FELT: smooth, fast, no friction. Dashboard shows today's ops (closing checklist not started, opening report in progress from someone else), reports hub tiles for AM Prep/Mid-day Prep/Receiving/Cash Deposit/PM Report, and trend tiles all at zero. Nice clean landing.

### GOAL 2: Receive a delivery (Capitol Hill, operations → receiving)
**Status:** DONE
- From dashboard, clicked "Log a delivery" under Reports → Receiving
- Picked vendor **Baldor** from the dropdown
- BUG?: the instant I picked Baldor, an unlabeled "New item / Added — not on the usual order" card appeared already sitting in the list, qty blank, no SKU name shown anywhere on it. Turned out this was stale draft state — header said "Saved on device 12:08 PM" — i.e. an old unfinished Baldor draft (from a previous keyholder's session on this same browser/device) bled into my new delivery. Confirmed by adding a real item (Cholula) via the "Pick a SKU…" selector, which created a properly-named second card next to the nameless one. Removed the stray line before proceeding — a real shelf guy would definitely stop and go "wait, what's this blank line for?"
- Built a 5-line delivery: Cholula (12 units, $8.50/pack), Ham (3 case — note the Qty label itself changes to "Qty (case)" once you pick a Unit, nice touch), Onions (25 units), Salami (8 units, $22.75/pack), White Cheddar (6 units)
- Filled Invoice # (BLD-88421) and Invoice total ($462.30)
- Checked "Photo later" (no real photo to snap in this sim) and left a note: "Truck on time, everything came in good shape, nothing to flag."
- No discrepancies logged — everything arrived fine, so I didn't touch the Short/Over/Damaged/Sub flags
- Clicked "Delivery confirmed" — form reset cleanly and "Recent deliveries" now shows: Baldor · 2026-08-11 · **Photo missing** · 5 item(s) · #BLD-88421 · Angel Reyes
- FELT: the flow itself is dead simple once you know it — vendor picker loads a "usual order" (empty for Baldor today) then you hand-pick SKUs off a short vendor-scoped list, one card per item, qty/price/flag-a-problem right there. Fast to move through on a truck morning. The stray leftover-draft card was the only real hiccup and it's a device/localStorage thing, not a data-loss risk, but it'd trip up a real employee who doesn't know to distrust a blank line.
- CONFUSED: momentarily by that nameless card — had no item name, no way to tell what it was, only a Remove button once you look. If I hadn't caught it, I probably would've just filled a random qty into a mystery line and shipped it.

### GOAL 3: The Ordering Walk (Capitol Hill)
**Status:** BLOCKED
**Attempts Made:**
1. Navigated straight to `/ordering?location=...` via URL — landed on a hard error screen: "Something went wrong / Algo salió mal / An unexpected error occurred." Clicked "Try again" — same error.
2. Went back to Dashboard, clicked the "Ordering" link in the site nav instead — same error screen again.
3. Clicked "Try again" once more on the error boundary — same error a third time.
- BUG (confirmed via console): `CountError: Insufficient role level for counts`, thrown in `loadOnHand`, called from `loadWalkerData`, called from `OrderingPage` — an unhandled server-side error that crashes the whole page instead of degrading gracefully. Looks like the ordering walker tries to load on-hand counts data that requires a higher role level than Key Holder has, and there's no guard/fallback — it just throws and the error boundary catches it as a hard failure.
- This is a real bug worth flagging to the controller: as a Key Holder I could not open the Ordering page AT ALL, not even to look around. If Ordering is meant to be a KH-usable surface (my shift goals assume it is — "the ordering walk" is written as a normal KH task), this is a blocking regression for my role.
- Could not proceed with the shelf walk, chip/banner review, vendor draft generation, drafts board, or confirm — all of Goal 3 is unreachable from this account.
- FELT: frustrating — three clean attempts, same wall every time. As a shelf guy I'd just tell the AGM "Ordering's broken for me, can't get past a red error screen" and move on with my day.

### GOAL 4: Log out
**Status:** DONE
- Straight "Log out" button right on the dashboard, no user-menu digging needed
- Landed back on root tile login ("Where are you?" — Capitol Hill / P Street tiles)

## Shift Summary
Logged in clean, received a full 5-line Baldor truck with no discrepancies (caught and cleaned up a leftover stale-draft line first), then hit a hard wall on the Ordering Walk — the whole page 500s for a Key Holder with `CountError: Insufficient role level for counts` out of `loadOnHand`/`loadWalkerData`. Confirmed reproducible 3/3 tries (direct URL, nav link, in-page retry). Never got to see the walker chips, the "can't estimate" hints, any top banner, draft generation, the drafts board, or a confirm — Goal 3 is a total blackout for this role today. Logged out clean at the end.

**Suspected bugs (flag to controller):**
1. **Receiving — stale draft bleed:** picking Baldor as vendor surfaced an old unlabeled "New item" draft line (localStorage "Saved on device" from a prior session) mixed in with a fresh delivery, no item name shown, easy to miss. Not data loss (has a Remove button once you spot it) but a real trap for a real employee.
2. **Ordering — role-gated hard crash:** `/ordering` throws server-side (`CountError: Insufficient role level for counts`) for Key Holder and never renders — no partial page, no friendly "ask your manager" message, just the generic error boundary. If KH is supposed to be able to walk the shelf and order (which my shift goals assume), this is a full regression for that role.

---
**Journaled by Angel, shift complete**
