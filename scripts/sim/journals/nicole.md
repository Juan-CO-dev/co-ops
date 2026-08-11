# Nicole Boyd — AGM, Capitol Hill — shift journal (Tue Aug 11)

## Goal 1 — Log in — DONE

Tile login was clean: Capitol Hill → AGM → Nicole Boyd → PIN. Four taps and I was on the
dashboard. No complaints, fastest part of my day.

**Manager info-quality note (this is the one that bugs me):** my dashboard is the first
thing I see and it told me *nothing about what was waiting for me*. Two specific misses:

- **Receiving** card says "Log a delivery when a truck arrives." Angel logged a delivery
  this morning. The card reads like nothing has happened today. It should say "1 delivery
  logged today" — I shouldn't have to go dig to find out whether the truck came.
- **Ordering** is just a nav link in the Explore list, same weight as "Recipes" and
  "Feedback." If there's a confirmed PO sitting there waiting on me to actually place it,
  that is a *time-sensitive* task with a vendor cutoff, and the dashboard gives it zero
  billing. No badge, no count, nothing in "Today's operations."

"Today's operations" only shows the closing checklist. For an AGM walking in mid-day, the
two things I most need to know — did the truck come, and is there an order waiting on my
signature — are both invisible from the landing screen.

CONFUSED: no. FELT: mildly annoyed before I'd even started. The system knows both of these
facts; it just doesn't tell me.

---

## Goal 2 — Ordering / place a PO — DONE (built my own; Angel's draft wasn't there)

**No confirmed draft was waiting.** I opened /ordering and "Today's orders" read
"Nothing ordered yet today." I checked the whole board — the only other controls were the
vendor accordions and a disabled "Review order." No draft, no PO code, nothing with Angel's
name on it. So I did the walk myself.

Important for the controller: I later proved the board *does* surface drafts properly —
after I made mine it showed up as "PFG · MEP-20260811-PFG · 6 lines · **Draft**" in that
same panel. So this isn't a case of a draft hiding. There simply wasn't one at Capitol Hill.

**My par walk** (PFG, marked "Order day"): Cucumber 4, Butter 2, Heavy Cream 4, Arugula 3,
Iceberg 4, Duke's Mayo 2 — 6 SKUs. Two entry styles both worked: typing a number, and the
"Empty · order N" one-tap for shelves that were wiped. The "We're full · 0" counterpart is a
nice touch — it records that I *looked* at an item and decided zero, which is different from
skipping it.

**The lifecycle, which is genuinely good:**
Record walk → **Draft** (PO code `MEP-20260811-PFG` minted immediately) → open it → editable
line list ("Adjust quantities, then confirm. A quantity of 0 removes the line.") → Confirm →
**double-tap guard** ("Tap again to confirm") → **Confirmed** → "Send the order" panel →
Mark placed → **channel modal** → **Placed**.

The channel modal asks Channel (Email/Text/Phone/Portal/In person), Sent to, and Note, and
says "Record how the order went out — it becomes part of the order's trail." That is exactly
right. I picked **Phone**, logged conf# PFG-4471. Afterward the order shows a **Timeline**
(Draft 12:38 · Confirmed 12:39 · Placed 12:40) and a **Sent** record with the channel, who
sent it (me, by name), and my note. If a rep later says "we never got that order," I can
answer with a time, a person, and a confirmation number. That closes the loop.

There's also a **Three-way match** panel (ordered vs received vs billed) already sitting on
the order, currently "No delivery received yet / No invoice yet." Good bones.

### Gaps that matter to me as the person approving spend

1. **BUG? / biggest one — there is no money anywhere.** The order lines have a third column
   that renders "—" for every row, and three-way match shows "Ordered total —" and
   "Billed total —". I confirmed and placed a six-line produce/dairy order without the system
   ever telling me what it costs. I'm the AGM; approving an order I can't price is the part
   of this screen I'd push back on hardest. Whether that's missing vendor cost data or a
   missing display, from my chair it's the same problem.
2. **The vendor contact is a dead end.** "Contacts: PFG Rep" — a name with no phone number
   and no email. "Order methods: Order portal — TBD — PFG order portal." So the screen tells
   me to send it manually, then gives me nothing to send it *to*. I had to fall back on
   knowing my rep's number from my own phone. The Copy buttons copy a placeholder ("TBD").
3. **Channel modal defaults to "In person,"** which is the least likely way anyone orders
   from a broadline distributor. Portal or Phone would be a saner default, or no preselection.
4. **BUG (minor): "Today's orders" doesn't live-update.** Right after "Record walk," the page
   rendered my new draft with its PO code in a "Draft orders" block, while the panel directly
   above it still said "Nothing ordered yet today." Two contradictory statements on one
   screen. It fixed itself on reload. Cosmetic, but it made me doubt the save had worked.
5. Tiny: the placement note prints twice on the order — once inside the Sent entry, once as a
   standalone "Note:" line underneath.

**Did the board make it clear what was waiting for me?** Once I was *on* the page, yes —
status badges (Draft/Confirmed/Placed), the PO code, line count, plus "Order history" and
"Recent walks" drawers. It's a well-built board. The failure is upstream: nothing outside
this page ever told me to come here. DONE.

---

## Goal 3 — Physical count (operations → counts) — DONE, but it took me three tries

Counted 6 SKUs. **Final accepted audit:** Sub Roll 6 packs · Cucumber 2 containers + 0.5
partial · Arugula 3 cases · Tomatoes 2 cases · Iceberg 2 cases · Bacon 1 case.

### Do partials count? YES — confirmed.

Cucumber came back **158.0 oz on hand** tagged "**1 loose · 1 partial**". Two full containers
plus a half works out to 2.5 × ~63 oz = 158, so the half-container was absolutely counted, not
dropped. That's the answer to the question, and it's the right behavior.

One nit on the display: it reads "1 loose · 1 partial" — that's a *count of partial entries*,
not the amount. I entered a half. Reading it back later I can't tell whether that partial was
a tenth or nine-tenths. I'd want "0.5 container" there.

### The three tries — this is the part I'd complain about

**Try 1 → rejected: "Partial must be between 0 and 1."**
I had Provolone as 2 cases plus a partly-used case, and I put **3** in Partial, meaning three
loose pounds. Wrong — "Partial" wants a *fraction of a container* (0.5 = half). Nothing on the
screen says that. The field is labeled just "**Partial**", with no range, no hint, no example,
and the checkbox beside it says "**Loose (below a full container)**" — which reads like
"count the loose units here." Loose units and a decimal fraction are two different mental
models and the form uses the words for one and the math of the other.

**CONFUSED: genuinely, yes.** This is the single most confusing control I touched today.

**Try 2 → rejected: "Can't convert that unit to ounces — set the item's pack chain or avg oz
first."**
Here's the trap. When I pick an item, the Unit field is sometimes a **dropdown of real units**
(Sub Roll → flat/Packs/Sub roll; Tomatoes → case) and sometimes a **free-text box** reading
"Unit (e.g. tub)" (Provolone, Turkey, Gloves Large). The free-text ones are precisely the items
the system *cannot convert*. So the form invited me to type "case" and "box", accepted them
without a murmur, and then threw out **the entire six-item audit** at submit. Everything I'd
typed had to be reworked.

**Try 3 → accepted**, after I swapped the three free-text items (Provolone, Turkey, Gloves
Large) for items with real unit pickers (Cucumber, Arugula, Iceberg).

### BUG? — the password confirm runs BEFORE validation

On try 1 the order of events was: fill six rows → Record audit → **"Confirm your password"** →
I type my password → **then** "Partial must be between 0 and 1." I authenticated a save that
was never going to succeed. Validation should run first; a manager shouldn't be asked for
credentials to commit something the system already knows it will reject. It also briefly
made me think my password had failed.

(On the successful try it didn't re-prompt for the password at all — the step-up was still
good from earlier. Fine by me.)

### Other manager notes

- **Errors don't say WHICH row is wrong.** Both messages appeared as a single line above the
  Record button. With six rows I had to work out for myself that it was the Provolone line,
  then that it was three *different* lines. On a 30-item audit that's brutal.
- **BUG?/data gap: several real items can't be counted at all.** Provolone, Turkey and Gloves
  Large are things we physically have on the shelf, and there is currently no way to get them
  into an audit — they have no pack chain, so any unit I type is refused. If the owner calls a
  full audit tomorrow, those items simply can't be recorded. That's a hole in the count, not
  just an annoyance.
- **Good, and worth keeping:** the On-hand panel labels the *source* of every figure —
  "**Audited** Tue, Aug 11" for the six I just counted vs "**Par-pass** Tue, Aug 11" for
  Butter / Duke's Mayo / Heavy Cream, which came from my ordering walk earlier. Knowing
  whether a number came from someone's eyes on the shelf or from an inference is exactly the
  distinction I need to trust it.
- **Good:** the standing instruction "Count each unit once: full containers, then loose units
  below. Never count the same stock twice." That's the right warning in the right place.
- FELT: competent screen, sharp edges. The double-count guidance and the audited-vs-inferred
  labelling show someone understood the job. The partial field and the silent free-text unit
  trap cost me two full re-entries.

---

## Goal 4 — Receiving history + cross-links — DONE

Angel's delivery is in "Recent deliveries" and the row reads:

> **Baldor** · 2026-08-11 · `Photo missing` · 5 item(s) · #BLD-88421 · Angel Reyes

**Does it show correctly? Mostly yes.** Vendor, date, line count, reference number, and who
logged it — that's the right set of facts for a glance, and the receiver's name being on it
matters to me. The **`Photo missing` badge is accurate and useful**: Angel ticked "photo
later" and left "[PHOTO PENDING]" in his note, and the badge surfaces that without my having
to open anything. That's a genuine open loop flagged at the right altitude — I know to chase
him for the packing slip.

Clicking through opens a real detail page: invoice total **$462.30**, Angel's note ("Truck on
time, everything came in good shape, nothing to flag"), the `Photo missing` badge again, a
**Vendor claim** block, and all 5 items with quantities (Cholula 12 packs, Ham 3 case, Onions
25 packs, Salami 8 packs, White Cheddar 6 packs).

### The cross-link verdict — this is the part worth flagging

**The `#BLD-88421` on that row is NOT a PO code — it's the Invoice #.** I confirmed it by
looking at the log form: the fields are Vendor / Delivery date / **Invoice #** / Invoice total.
Our PO codes look like `MEP-20260811-PFG`. So the history row shows the *vendor's* paperwork
number, not our order thread.

**The detail page does not link back to any order.** No PO field, no PO code, no link. The
only navigation off it is "‹ Back to Receiving."

To be fair to the system I checked whether there was anything to link to: Order history for
Capitol Hill contains exactly one order — the PFG one I placed today. **There is no Baldor
purchase order at all.** So Angel received a truck that was never ordered through CO-OPS, and
the detail page had no order to point at. The link isn't broken so much as absent-by-
circumstance.

**But the threading absolutely does exist — I found it going the other direction.** On the
receiving form, the moment I chose **PFG** as the vendor, a banner appeared:

> **Receiving against MEP-20260811-PFG**

…and it preloaded all six lines from the order I'd placed an hour earlier — "Cucumber
Expected 4 × container", "Butter Expected 2 × case", and so on — each with a one-tap ✓
"Confirm as expected", plus a picker to add anything that showed up off-order. That is
genuinely excellent. A receiver doesn't retype the truck; they tick off what matches and only
touch the exceptions. (I backed out without saving — the PFG truck hasn't actually arrived and
I'm not logging a delivery that didn't happen.)

So the PO thread is **automatic at log time, keyed off the vendor**. My criticisms are about
what happens to that thread afterwards:

1. **BUG? — the thread isn't shown after the fact.** The log screen knows "Receiving against
   MEP-20260811-PFG", but neither the history row nor the saved detail page displays a PO code
   anywhere. If that thread is recorded, it's invisible to me; if it isn't recorded, then the
   link is lost the moment the delivery is saved. Either way, when I open a past delivery I
   cannot answer "which order was this against?" — and the reciprocal panel on the order side
   *does* exist ("Three-way match → No delivery received yet"). One direction of the loop is
   built and the other isn't shown.
2. **A delivery with no PO isn't called out as such.** Angel's Baldor delivery arrived against
   no order. The page says nothing about that. Contrast the Vendor claim block, which
   explicitly states "No vendor claim is linked to this delivery yet" and offers me two ways to
   fix it. The PO relationship deserves the same treatment — an explicit "No purchase order
   linked" with a way to attach one. Silence reads as "fine" when it isn't. An unordered truck
   is exactly the thing an AGM should be looking at.
3. **Money doesn't reconcile.** Invoice total is $462.30, but only 2 of the 5 lines carry a
   price (Cholula $8.50/pack, Salami $22.75/pack); Ham, Onions and White Cheddar all say "no
   price". So I cannot check the invoice against what landed. **Vendor claim: "Not compared."**
   The bones of a three-way match are all here — ordered / received / billed — and on both
   screens the billed leg is empty.

**What the cross-links actually do:** Receiving ↔ Ordering are linked as plain page-level
nav (a "Ordering ›" chip on Receiving, a "Receiving ›" chip on Ordering). They jump between
the two boards but carry no context — they don't take me to *this delivery's* order or *this
order's* delivery. The one piece of real record-to-record threading I found is the
"Receiving against <PO>" banner at log time.

CONFUSED: no. FELT: the good parts are better than I expected (expected-quantity preload,
photo-missing badge, receiver's name), and the gap is a specific, nameable one — the
order↔delivery link is created but never displayed back to me.

---

## Goal 5 — Log out — DONE

### Closing note: the dashboard never caught up (BUG?)

Before logging out I went back to the dashboard to see my shift reflected. After I had placed
a PO, recorded an inventory audit, and with Angel's delivery already logged, the cards still
read:

- **Receiving** — "Log a delivery when a truck arrives." (one delivery logged today, *with an
  unresolved photo-missing flag*)
- **Inventory Audit** — "Run a full audit when the owner calls for one." (I recorded one an
  hour ago)
- **Ordering** — still nothing at all; not even a card, just a nav link. A PO went out today.

These are static strings, not status. And the app clearly *can* do status — right beside them,
Cash Deposit and PM Report both say "Not started today," and Opening Report says "In progress."
So the pattern exists; Receiving, Inventory Audit and Ordering just don't participate in it.

**Why this matters to me as the manager:** this is the same complaint I opened the shift with,
and it's the one I'd actually take to Marcus. Every individual screen I used today was good —
the ordering lifecycle is genuinely well made, the receiving preload is clever, the audit
distinguishes counted-from-inferred. But the landing page is where I decide what to do next,
and it is the least informative screen in the app. I found Angel's delivery because I was told
to look for it. Nothing in CO-OPS would have told me it existed, or that it's still missing its
photo. If I'd walked in cold I'd have missed both.

**One-line ask:** make those three cards say what happened today the way Cash Deposit already
does — "1 delivery logged · 1 photo missing", "Audit recorded 12:47 PM", "1 order placed" /
"1 draft awaiting confirmation". The data is all there; it's a display away.

Logged out cleanly from the dashboard.
