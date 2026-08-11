# Priya Shah — AGM, P Street — sim journal (Tue Aug 11)

## Goal 1 — Log in — DONE

Tile flow: location (P Street) → role (AGM) → name (Priya Shah) → 4-digit PIN keypad. Four taps and I
was on the dashboard. No friction, no re-prompt. Fastest login I've used on a shop tablet.

INFO-QUALITY (dashboard, unprompted manager read):
- **Trends tiles read as all-zero and I can't tell if that's good or empty.** "Under / Over Par 0",
  "Fridge Temp Flags 0", "Cash Over / Short $0.00", "Checklist Completion 100%". Three zeros and a
  perfect score. Is that a clean week or a week with no data in it? The tiles don't say what window
  they cover or how many days fed them. As the person accountable for those numbers I would not put
  my name on "100%" without knowing the denominator.
- **Team panel flags literally everyone.** Header: "0 on track · 6 need a check-in". Then all six
  people, me included, each captioned "Worth a check-in". Rosa Delgado is ranked #1 with 116 tasks
  and *still* says "Worth a check-in". A list where every row is flagged is not a signal, it's
  wallpaper — I'll stop reading it by Thursday. Rosa doing 116 tasks and Deshawn doing 0 should not
  land in the same bucket.
- CONFUSED: the counters "tasks · finals · oversight · notes" are never explained. Different rows
  show different subsets of them (Rosa: tasks/finals/oversight/notes; Deshawn: tasks/notes only) with
  no reason given. I'm guessing at what "finals" and "oversight" even count.
- FELT: clean, fast, well laid out. My complaint isn't the design, it's that the numbers don't defend
  themselves.

## Goal 2 — Physical count at P Street — DONE (on the second try)

Counted 7 SKUs off the walk-in and dry rack: Sub Roll 3 flat · Bacon 2 case · Ham 1 case ·
Duke's Mayo 2 case + loose/partial · Iceberg 1 case · Tomatoes 2 case · Tuna 3 container.
Note attached. Saved and the On-hand panel flipped from "No audit yet" to "Anchored to the audit on
Tue, Aug 11" with my seven items badged "Audited Tue, Aug 11". So: it worked.

### THE PASSWORD MOMENT (the thing I was asked to watch)

Yes, it appeared. I hit **Record audit** and a small dialog came up, near enough verbatim:

> **Confirm your password**
> Re-enter your password to confirm this action.
> [ Password ] — [Confirm] [Cancel]

Was it clear? **Yes, as a sentence. No, as a reason.** It tells me *what* to do and nothing about
*why* a shelf count needs my password when a 4-digit PIN got me into the building. One line —
"counts change inventory value, so we re-verify it's you" — and I'd stop resenting it. Right now it
reads like the system doesn't trust the badge it just issued me.

**Did the submit complete after? NO — and this is the real finding.** I typed my password, hit
Confirm, the dialog closed... and the save **failed** on a validation error:

> "Can't convert that unit to ounces — set the item's pack chain or avg oz first."

**BUG? — the order of operations is backwards.** It made me do the security ceremony *first* and
*then* discovered my form was invalid. The password should be the **last** gate, after the form is
known-good. As it stands the app spends my credential on a save that was never going to happen.

**BUG? (and this one worries me more) — the second submit never re-asked.** After I fixed the rows
and hit Record audit again, it saved **with no password prompt at all**. So either the confirmation
is sticky for a window, or it was consumed-but-held from the failed attempt. Nobody told me either
way. If I'd walked away from an unlocked tablet after that first error, the next person could have
recorded a count over my name without ever seeing a password box. For a step deemed important enough
to gate, silently un-gating it is worse than not gating it.

### What tripped me in the first place (info-quality, and it's a real one)

**The Unit field silently changes species depending on the item, with no explanation.** Pick Sub Roll
→ Unit is a dropdown (flat / Packs / Sub roll). Pick Provolone or Turkey or Coke → the same Unit
field is a **free-text box** reading "Unit (e.g. tub)". So the app invites me to type a unit it
cannot actually use, accepts it into the form, lets me fill out the whole audit, makes me confirm my
password — and only *then* says it can't convert it. I typed "lb" for sliced deli. That is the most
natural thing an AGM will ever type on this screen.

- The error names no item and no row. Seven rows, one error, zero pointers. I fixed it by *guessing*
  the three rows that had free-text units. On a 30-line audit I'd be hunting for ten minutes.
- The error is written for a developer: "set the item's **pack chain** or **avg oz**". I do not know
  what a pack chain is, I have never seen those words on any other screen, and it tells me to go set
  something without telling me where. Say: "Turkey has no case size on file — ask your GM to set it,
  or count it in a listed unit."
- **The free-text box shouldn't exist.** If an item has no units configured, say so on the row
  ("no pack size set for this item — can't count it yet") instead of handing me a blank box.

CONFUSED: **changing the item on a row keeps the previous row's quantity.** I switched row 2 from
Provolone to Bacon and my "4" was still sitting there. I caught it and set it to 2. A closer at 11pm
does not catch it. That's a silent wrong number straight into inventory value.

CONFUSED: **Loose vs Partial is genuinely ambiguous and I still don't know what I recorded.** The row
has "How many", a checkbox "Loose (below a full container)", and a separate number "Partial". The
Partial box is always live even with the checkbox unticked. Nothing says whether Partial is a
fraction of a case (0.5) or a count of the next unit down (6 jars). I entered 2 cases + Loose + 1.

The result came back as "256.0 oz" plus a footnote "1 loose · 1 partial" — see Goal 3, because that
number does not add up.

## Goal 3 — Studying the ON-HAND panel — DONE (verdict: honest plumbing, unreadable gauge)

Sat with it properly, before and after my audit. It is clearly doing real work underneath. As a
panel I'm supposed to run a shop from, it does not explain itself.

### The good
- The header line changes state and that's genuinely useful: before, "No audit yet — on-hand is
  inferred from deliveries, production, and sales"; after, "**Anchored to the audit on Tue, Aug 11**."
  "Anchored" is the right word and I understood it instantly.
- Every row is badged **Inferred** or **Audited Tue, Aug 11**. Provenance on every number is exactly
  what I want and most systems don't bother. Credit where it's due.

### The bad — and the first one is a flat contradiction
- **It says "No audit yet" and then labels every row "counted:".** Pre-audit, the panel told me no
  audit existed, then every single row read `counted: 3.3 oz · since: 0.0 oz · 0d ago`. Nobody
  counted 3.3 oz of provolone. It's an *inferred* figure wearing the word "counted". If I quote that
  to the owner as a counted number I'm wrong, and the screen is what misled me.
- **"since: 0.0 oz · 0d ago" is mute.** Since *what*? Since the last count? Used since then? Received
  since then? It reads 0.0 on all thirty-odd rows, so I can't even reverse-engineer it. And "0d ago"
  on every row on a panel that just told me there had never been an audit — 0 days since a thing that
  never happened. Either label it ("used since last count: 0.0 oz") or drop it.
- **Everything is in ounces and only ounces.** I counted 1 case of iceberg; it tells me
  **640.0 oz**. I counted 3 flats of sub rolls; **360.0 oz**. No manager on earth walks the walk-in
  thinking in ounces. Show me what I counted with the ounces in parentheses: "1 case (640 oz)".
  Right now the panel throws away the unit I actually work in.
- **BUG? — my loose/partial didn't make it into the number.** Duke's Mayo: I entered 2 cases, ticked
  Loose, and put 1 in Partial. Result: **256.0 oz**, footnoted "1 loose · 1 partial". A case is
  plainly 128 oz, so 2 × 128 = 256 — **the partial contributed exactly zero ounces.** The open case I
  walked over and looked at is recorded as a note and nothing else. Either it should add oz or the
  form shouldn't ask. As written it's a number that lies quietly.
- **BUG? — Ham's case size looks wrong and the panel hides the evidence.** My counts convert as:
  Bacon 2 case → 480 oz (**240 oz/case**), Iceberg 1 case → 640 oz (**640 oz/case**), Mayo 128 oz/case,
  Tomatoes 160 oz/case, Sub Roll 120 oz/flat, Tuna 66.6 oz/container — and **Ham 1 case → 16.0 oz**.
  A case of ham is one pound? Next to a 15-lb case of bacon? Somebody typed a pack size wrong. I only
  caught it by dividing seven rows by hand. **The conversion factor is never shown**, so the one
  screen that could have caught a bad pack size is the screen that conceals it.
- **No par, no variance, no cost — so the panel can't answer the only two questions I have.** "Am I
  short?" and "did we lose product?" Not on this screen. It's a list of levels with nothing to
  compare them against. That's the single biggest gap, and it's what makes the whole audit feel like
  filing rather than managing.
- **Audited and Inferred rows are interleaved alphabetically.** My seven hard numbers are scattered
  through thirty-odd soft ones. Sort or group by trust so I can see my anchor at a glance.
- **The list is a mystery subset.** The item picker offers ~160 SKUs; On hand shows ~33. No heading,
  no count, no "showing 33 of 160", no reason. Are the other 127 at zero? Not stocked at P Street?
  Not tracked? I can't tell, and "the item isn't on the list" is exactly how a stockout hides.

FELT: I trust the machinery and I don't trust my ability to defend its output in a meeting. Every
number on this panel is *derived* — inferred, converted to ounces, anchored — and the panel shows me
the answer while hiding every input. Show the conversion, show the par, name the window, and this
goes from a screen I tolerate to the screen I open first.

## Goal 4 — Ordering for P Street — DONE (full lifecycle, walk → draft → confirmed → placed)

No confirmed draft was waiting ("Nothing ordered yet today"), so I walked it myself. Marked 6 PFG
SKUs off the chips — Duke's Mayo Suggest 1 · Iceberg Suggest 3 · Celery Suggest 3 · Lemon Juice
Suggest 3 · Onion (red) Suggest 5 · Chicken Breast "Empty · order 1" — then Review order → Record
walk → opened the draft → Confirm order → Mark placed (channel Portal).

**Lifecycle feel: this is the best-built screen I've touched today, and it's not close.** It thinks
like a walk. Vendors are accordions, only PFG was auto-expanded and it's the only one badged
**"Order day"** — the app knew today was PFG's day and put it in front of me. Every row is
`item · unit · Par N · ~X on hand · audited|inferred` plus a stepper and three chips. The chips are
the whole design: **"Suggest N" · "Empty · order N" · "We're full · 0"**. That is exactly how a
manager actually walks a shelf — you're not doing arithmetic, you're making a judgement per shelf and
the app does the math. A running "6 SKUs marked" pinned at the bottom, then Review order. Genuinely
good.

Lifecycle steps, all clean:
- **Review order** → a real table (SKU / Item # / Qty) with actual vendor item numbers, and an honest
  line: "Delivery options (email, portal, phone) appear once you submit." No surprises.
- **Record walk** → "Walk recorded — 6 SKUs" and a draft **PO EM-20260811-PFG**. Readable PO number.
- **Draft panel** → editable steppers + "Adjust quantities, then confirm. A quantity of 0 removes the
  line." That sentence is perfect — it told me the one non-obvious rule before I needed it.
- **Confirm order** → the button flips to **"Tap again to confirm."** Two-tap on an irreversible
  step, and it earned its place. Best micro-interaction in the app.
- **Mark placed** → a small form: Channel / Sent to / Note, with "Record how the order went out — it
  becomes part of the order's trail." It is honest that CO-OPS is not sending anything.
- **After placing** → status **Placed**, a **Timeline** (Draft 12:27 · Confirmed 12:28 · Placed
  12:30), a **Sent** entry (Portal · 12:30 PM · "PFG online order portal" · **by Priya Shah** · my
  note), and a **Three-way match — 0 flagged** drawer. That trail is genuinely audit-grade. If Pete
  asks who ordered five containers of red onion, the answer is on the screen with my name on it.

### The banner at the top of the walker
**There wasn't one.** At 12:30 PM the top of the walker was just back-links, "Ordering walk — Tue,
Aug 11 · EM · P Street", "Today's orders", "Order history 1", "Recent walks 1". No advisory, no
warning, no "your count is N days old" line. Given that this whole screen's on-hand numbers rest on
an audit, **the one banner I'd actually want is "on-hand anchored to today's audit"** — or, on a bad
day, "last audit was 9 days ago, treat these as estimates." Right now the walker inherits the count's
credibility silently.

### The "no weight set" hints — the biggest information problem here
**37 of the 79 PFG rows say "No weight set — can't estimate on-hand."** Nearly half the order guide.
Only 4 rows showed an audited on-hand and 17 an inferred one.
- The hint is **plain-English and I understood it immediately** — much better written than the count
  screen's "pack chain" error. Credit for that.
- But it lives as a **tooltip/label with no visible text of its own** — there's no readable sentence
  sitting on the row, so on the tablet it's an easy thing to slide right past.
- On those rows the **"Suggest N" chip silently disappears**, leaving only "Empty · order N" and
  "We're full · 0". That's logically right — no on-hand, no suggestion — but **nobody says so**. It
  just looks like some rows have three chips and some have two. One line ("no suggestion — we can't
  estimate this one") would close it.
- **Manager's read: half my order guide can't be suggested on, and the screen never totals that up.**
  I'd want "37 of 79 items can't be estimated — fix these pack sizes" with a list, because that's a
  real work order for me and my GM, not a per-row shrug.

### Other info-quality notes
- **BUG? — there are no prices anywhere, but there IS a Price column.** The confirmed order shows
  SKU / Item # / Qty / **Price**, and every single cell is an em-dash. No line cost, no order total.
  I confirmed and placed an order for 16 units across 6 SKUs with **no idea what it costs.** An AGM
  approving spend blind is the single most serious gap in this flow. Either wire the cost or drop the
  column — an empty Price column is worse than none, because it looks like the data should be there.
- **"Contacts: PFG Rep"** — a job title and nothing else. No phone, no email. If I pick the "Phone"
  channel, the screen that told me to phone them can't tell me the number.
- **"Order portal: TBD — PFG order portal"** — a literal "TBD" placeholder shown as operational data,
  with a **Copy button next to it**. Copying "TBD" is worse than an empty state. Say "no portal link
  on file yet."
- **The Channel dropdown defaults to "In person."** For a broadline distributor that's the least
  likely option of the five (Email / Text / Phone / Portal / In person). Default to the vendor's
  configured method, or force a choice. A rushed closer taps through and the trail records a lie.
- The email explanation is **excellent** and I want to name it: "Automatic email isn't set up for
  this store yet — send the order another way below" / "Email ordering switches on once the store's
  sending domain is verified." That's how you write a degraded state — what's off, what to do now,
  what turns it on. The counts screen should steal this voice wholesale.
- **BUG? — "Suggest 1" still says 1 on Duke's Mayo after I already placed 1 today.** The row picked
  up a small "**last: 1**" marker, which is a real mitigation, but (a) "last: 1" is cryptic — last
  what? last count? last order? when? — and (b) **the suggestion doesn't net out what's already on
  order**, so the chip actively invites me to order a second case this afternoon. Say "1 case ordered
  today — on the way."
- Grammar: the review panel says "**1 vendor orders**". Minor, but it's the first line of the screen
  where I approve spend.
- The "Copy the full order text" button gave me **no visible confirmation** it copied.

FELT: this screen respects my time and my job. The chips, the order-day badge, the two-tap confirm,
and the Timeline/Sent trail are all the work of someone who has actually stood in a walk-in with a
clipboard. Then it hands me an order with no price on it. Fix the money column and the 37 missing
pack sizes and I'd run P Street off this page every morning without complaint.

## Goal 5 — Log out — DONE

"Log out" button at the bottom of the dashboard, one tap, straight back to the location tiles. Clean.
Minor: it's the very last thing under the Team list — on a shared tablet the log-out should be in the
user menu at the top where I'm already tapping, not at the bottom of a long scroll. Half my staff
will just walk away from a logged-in tablet rather than scroll to find it.

---

## END OF SHIFT — Priya's summary for whoever reads these

**Ranked, worst first:**
1. **Ordering has a Price column and never fills it.** I confirmed and placed a real order with no
   cost and no total. I'm the one accountable for food cost. (Goal 4)
2. **The password confirm fires before validation, then doesn't fire again.** I spent my credential
   on a save that failed, and the retry that actually wrote to inventory asked for nothing. (Goal 2)
3. **37 of 79 PFG items have no pack size**, and the count screen's version of that same problem
   ("pack chain / avg oz") is written in a language I don't speak and names no row. Same root cause,
   two screens, two very different qualities of explanation. (Goals 2 & 4)
4. **Ham converts to 16 oz per case** next to Bacon at 240 oz. A bad pack size is sitting in the data
   right now, and the On-hand panel hides the conversion that would expose it. (Goal 3)
5. **My loose/partial count contributed zero ounces.** Counted, footnoted, ignored. (Goal 3)
6. **On-hand has no par and no variance**, labels inferred numbers "counted:", and shows everything
   in ounces. It can't answer "am I short?" (Goal 3)
7. Dashboard flags all six people as "worth a check-in", which is the same as flagging nobody.

**What's genuinely good and shouldn't be touched:** the ordering chips ("Empty · order 4" / "We're
full · 0"), the Order-day badge, the two-tap Confirm, the Timeline + Sent trail with my name on it,
the Inferred/Audited provenance badges, "Anchored to the audit on Tue, Aug 11", and the email
degraded-state copy. Somebody on this build understands restaurants. The gap isn't craft — it's that
the numbers don't show their work.
