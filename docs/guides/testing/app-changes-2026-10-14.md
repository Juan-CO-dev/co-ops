# App changes merged 2026-10-13/14 (what the guides must now reflect)

## PR #458 — fix(closing): PIN confirm fires once; a late 'already closed' no longer overwrites a saved closing
## What
On the closing checklist, the 4-digit PIN confirm could POST `/api/checklist/confirm` twice. The first request saves the closing; the second is correctly refused (409 `instance_closed`), and the page then replaced the success banner with **"Just modified by someone else — try again."** Nothing was lost — the closing saved exactly once — but the message tells a closer to redo a closing that is already done.

Found by a guides-v2 photo walker on the sim (dev build: React Strict Mode double-invokes the `setPin` updater that scheduled the submit). In production a fast extra tap right after the 4th digit can open the same window.

## Fix
- `components/auth/PinConfirmModal.tsx`: an `inFlight` ref latch at the top of `submit()` (released on every non-success exit, reset when the modal opens); the submit is scheduled outside the `setPin` updater; digit/system input ignored while a submit is in flight.
- `app/(authed)/operations/closing/closing-client.tsx`: a late `instance_closed` after this tab confirmed is ignored; a genuine one (another device/manager) shows `closing.error.instance_closed` ("This checklist is already confirmed.") instead of the concurrent-modification text.
- `tests/pin-confirm-double-submit.test.ts`: 7 source-shape pins (6 fail on the old code).

## Test plan
- [x] `npx vitest run tests/pin-confirm-double-submit.test.ts tests/checklist-confirm-denial.test.ts tests/auth-pin-source-throttle.test.ts` (22 pass)
- [x] `tsc` — only the 6 pre-existing leaflet PNG module errors
- [ ] CI build
- [ ] Opus review

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31

## PR #459 — fix(dates): show the business (ET) date for stored timestamps, not the UTC slice
## What
Found by the guides-v2 testers: a maintenance note written after 8 PM ET showed **tomorrow's** date. Several places took the first 10 characters of a UTC ISO timestamp. This branch adds `etDisplayDate()` (lib/operational-day.ts) and switches every user-visible site of that bug class to the ET business date.

## Sites
Maintenance overview/detail (incl. the "today" chip after 8 PM), reading fallback dates, admin customers + consent, admin cron status, SKU overlay, weight board, catering insights, counts on-hand anchors, receiving vendor claims, written reports stamp, batch "made on", mid-day/opening `todayIso` fallbacks — and `isPastShelfLife` (an evening batch looked a day younger: a logic bug, not just display).

Deliberately unchanged (listed in the commit): pure calendar math on existing YYYY-MM-DD values, UTC cron days, and query-window cutoffs (data-semantics call).


## PR #460 — fix(auth/ui): PIN entry can't drop or double-submit; rate limit isn't 'Wrong PIN'; menu no longer covers content; Production for Employee+
## What
- **PIN login (#55):** a 429 rate-limit now shows "Too many tries" with a countdown instead of "Wrong PIN" (the whole shop shares one IP). Throttle/lockout rules unchanged (pinned).
- **PIN entry, login keypad + closing confirm (#57 + reviews):** a synchronous `createPinEntry()` controller (lib/pin-entry.ts) — fast taps can't lose a digit, input freezes once the 4th digit lands (display and submitted PIN can't diverge), submit fires exactly once, Cancel/Escape/Clear are dead while queued; every error/cancel/reopen path releases. Hardens the confirm path from #458.
- **Menu (#53):** the user menu renders in page flow instead of a fixed overlay, so it no longer covers breadcrumbs/buttons.
- **Language (#54):** switching language refreshes the page.
- **Cash (#59):** the deposit/over-short readout waits until projected and a drawer figure are entered; a counted $0 drawer counts.
- **Production (Juan D-64, "lower Production to level 3"):** in the menu and recordable for Employee and up (PRODUCE_MIN = 3 at the lib, both API routes, the page and nav); the page defaults to the user's shop instead of redirecting; yield stats keep their own floor. No DB floor existed (service-role writes only) — no migration.


## PR #461 — fix(prep): phone-usable mid-day Save/Finalize, real finalized view, clean quantities, crew-read-only consumption
## What
- **#1 Mid-day Phase 2 on a phone:** the long "Uses: …" line no longer widens the page (operations `<main>` w-full, `min-w-0` on the panel/row), so Save / Finalize stay on screen; number inputs are 16px so phones don't zoom (incl. batch fields).
- **#2 Finalized mid-day:** replaces the old "forms ship in the next build" placeholder with a read-only "Finalized at … by …" summary built from the SAVED records (snapshot par/unit/name per C.44, saved batch need, made read from each record's persisted shape; retired items stay, newly added items don't appear).
- **#3/#4 Quantities:** "5 × 1/3 Pan", no float noise (display-only rounding — no comparison changed).
- **#5 NumericInput:** keeps what you type ("5."), commits the parsed number, shows a hint for invalid text (incl. overflow), keeps the last valid value; accepts a decimal comma.
- **#6–#10:** no-par rows say "No par set — type what you made"; title follows the tab; static Verified chip on Phase 2 sections; recount boxes red only while required and empty; footer hint names the missing reason/temperature.
- **D-13 (Juan, option b):** the "Uses:" consumption panel is read-only and collapsed for crew (< key holder); enforced on the server (crew overrides dropped, derived consumption recorded). `CONSUMPTION_EDIT_MIN = 4`.


## PR #462 — fix(location): the shop you pick at login sticks — one shop resolver across ~25 pages
## What
- One pure resolver (`lib/shop-context-shared.ts` `pickShop`): URL shop → remembered shop → first allowed. It only ever picks among the shops the page already allows; explicit `?location=` (incl. `all`) and every existing access gate are unchanged.
- Remembered shop = a `co_shop` cookie written client-side after tile login and after a real navigation to one of your shops (not prefetch). Server re-checks it on every read; a forged/stale value falls through. Nothing added to the JWT.
- Report pages honour their existing all-shop read grant (level 8+); a per-route parameter contract (`shopParamFor`) is shared by pages and the sync so the remembered shop is always the one on screen; repeated params are no selection.
- Production page uses the resolver too.


## PR #463 — fix(catering): ezCater comparison works, customer pages show their leads/quotes, leads editable, cross-shop contact never leaks
## What
- **#32** ezCater comparison: the review-queue fallback filtered a jsonb column with an array literal and errored on every lead → "Order comparison is currently unavailable." everywhere. Now a jsonb containment filter; a typed lead with nothing to compare shows no panel.
- **#33** dev text "Sub — par comparison in W4b" removed from Prep Demand.
- **#34/#35** saving a quote links its lead to the customer (only an empty link, access-checked, location-bound compare-and-swap, audited); customer pages list their quotes and leads; the saved quote shows client + lead.
- **#36** lead details editable after creation (only changed fields sent). Phone/email on Add lead is D-48 — not in this PR.
- **#37–#40** no empty first quote line; picking a lead pre-fills empty quote fields; lead options show contact · company · date · shop; plural/wording fixes.
- **Juan option (b):** a quote may attach another shop's existing customer by email; that GM never sees the customer's saved contact (quote page "contact details hidden", Send returns no recipient, customer page closed, lead not linked). A raw cross-shop customerId is refused. (Accepted side effect: the hidden-client line reveals the email exists at the other shop.)
- **Hardening found in review (several pre-existing on main):** quote create/revise now validates the customer; quote parties, customer leads, sendQuote and pipeline search all apply the catering contact policy; email failures never log or store a recipient address (redacted provider errors) — for every caller.


## PR #464 — fix(closing/board/pulse): report links open the right page, closing ticks carry true times, Closed stations show, Pulse late only after 3:30
## What
- **#15** Closing report lines open their own page (PM report no longer opens AM Prep); tap labels name the actual report.
- **#16** Report lines show the true submit time. Mid-day closing ticks: instance + time from the latest-confirmed report, never "now"; stale ticks from the old code are repaired.
- **#17** Amber AM-prep note reworded (AM prep is the closer's count). Timing (D-17) not changed here.
- **#18** Fridge temp lines on the closing say "Temp (°F)".
- **#19** A crew member whose station closed sees "Closed · time" (not "No station"); hidden once they end their shift.
- **#20** START BREAK hidden after End my shift (also when still clocked into Toast).
- **#21** Dashboard compact card reads "My station" instead of a roster count.
- **#23** The Pulse counts mid-day prep late only after 3:30 PM (overdue), not from 2:00 (due).
- **Pre-existing bug fixed on the way:** a second mid-day finalize could never update the closing tick (insert-before-supersede hit the 0196 one-live-head index; the closing page swallowed the 23505). Replacement is now supersede → insert → link, compare-and-swap on the head read, monotonic (never replaces a newer/higher-count tick), respects a manager's revoke, restores on a failed insert.

**Follow-up (filed, not in this PR):** an atomic replace RPC (migration) for closing ref ticks, to close the crash gap between supersede and insert (today: the line is unticked until the next closing load repairs it).


## PR #465 — feat(board/pulse/reports): Juan's decisions D-26/27/28/60/62/63 + DST-correct cutoffs
## What
- **D-26** "fill first" only on an uncovered station's first open position (Pulse coverage rule: someone on break doesn't cover).
- **D-27** Pulse "Needs attention": red items first, then stations, then yellow.
- **D-28** PM report: no default grades (each must be picked); roster seeded from today's presence, intersected with who the PM route accepts.
- **D-60** Counts: a negative theoretical on-hand shows 0 + a "below zero — count it" pill; the real number stays in the detail (display only).
- **D-62** Reports Hub "Last close" = the newest finalized closing (one bounded query, ≤92 days); auto-closed days count, labelled "auto closed".
- **D-63** a vendor cutoff that passed with nothing placed shows red "missed" on the Pulse, dashboard tile and /ordering (crew never see it).
- **Pre-existing DST bug fixed on the way:** every cutoff after 2 AM on a DST-change day was an hour off (walker chip, Pulse, dashboard, /ordering, PO `cutoff_at_confirm`). One resolver (`etWallMinutesInstant`, the digest's algorithm) now backs ordering, POs and the digest — skipped hour rolls forward, repeated hour = first occurrence.


## PR #466 — feat(prep/closing): one bad prep row no longer stops the shift; AM-prep note from 6 PM (Juan D-66, D-17)
## What
- **D-66** one malformed prep row (a `PrepShapeError`, like the text par that blanked AM prep on the sim) no longer stops the shift:
  - AM prep and mid-day pages show every other row plus a note naming the items that couldn't load ("These items couldn't load and weren't included… A manager can fix them in Admin." — en/es);
  - AM prep submit, mid-day Phase 1 submit, Phase 2 save and finalize skip bad rows they aren't writing; a skipped item is never required; a write aimed at a bad row is refused (400 `prep_shape`); `PrepInvariantError` and everything else stay strict;
  - AM-prep EDITS use the original submission's item set (C.44/C.46) and refuse writes to an item whose latest completion is malformed.
- **D-17** the closing checklist's amber AM-prep note shows only from 6 PM ET on that business day (DST-correct; its reads are skipped before then).
- **D-14 (mid-day save-on-blur) is NOT in this PR** — review found finalize/autosave races; it moves to its own PR (`feat/d14-midday-autosave`). Mid-day keeps its per-row Save.


