# Manager guide — review round 1, Opus 5.5 (2026-10-13). FIX FIRST (~190 claims checked)

FALSE
1. **Assigning has a confirm step** (L189; ES L280 "no hay paso para confirmar"): Assign task, Set station, Retract and End shift open "Confirm change" / "Cancel" first (`components/assignments/ShiftBoardClient.tsx:130-133,293-301,322-341`; `en.json:370`; staff.steplog:172,321). → "Tap **Assign task**, then **Confirm change**" (ES **Confirma el cambio** — check es.json). Same after **Set station**.
2. **Submit Opening also needs every prep section verified** (L348; ES L412) — same as Fable 1.
3. **"With no purchase order, that list does not show"** (L535; ES L659) is wrong: the expected-items list shows for usual-order prefills too; only the SHORT CLAIM is PO-gated (`ReceivingForm.tsx:1821-1836`; `en.json:3268`). Without a PO, "Didn't arrive" claims nothing (`ReceivingForm.tsx:1188-1194`).
4. **"Add the item and flag it Short"** (L535) does not work for an item that never came: a line needs qty > 0 (`ReceivingForm.tsx:596`; `lib/receiving-shared.ts:102-109`). **Short** makes a credit only for a partly delivered line. → without a PO a fully missing item can't be claimed; flag **Short** only when some of it came.
5. **Missing step — first tap may not submit**: with unconfirmed expected lines, the first tap shows the list and the button becomes **Tap again to confirm** / **Toca otra vez para confirmar** (`ReceivingForm.tsx:1265-1271,1940-1942`; `en.json:3264`). Add to step 4.
6. **No invoice number needed** (L548; ES L660) — same as Fable 2 (`lib/receiving.ts:502` invoice optional).
7. **Cash deposit can't be redone** (L842; ES L935): once signed, `/cash` is read-only (`app/(authed)/cash/page.tsx:141-208`; tile offers only "View", `CashDepositTile.tsx:29-30`). The page lock text is "Today's closing is already finalized — the cash deposit is locked." (`en.json:2159`). → "Once signed, the deposit is read-only. Check the amounts before you sign."
8. **Production is reachable** (L1069; ES L1254): Shift leads and up: Trends → **Yield** card → **‹ Production** back link (`TrendsLanding.tsx:35,73-88`; `app/(authed)/operations/production/yield/page.tsx:35`; `lib/nav-parents.ts:97`). → "Shift leads and up: Trends → Yield → ‹ Production. Key holders: ask a shift lead or GM to open it." (Replaces Fable 12.)
9. **Inventory in the Reports Hub** (L1116; ES L1262): every key holder sees Inventory → Receiving and Ordering (`lib/assignments.ts:77` hasTaskAccess at 4+; `app/(authed)/reports/page.tsx:57-58,92`). Only **Counts and variance** needs AGM. Fix.
10. **Counts PIN before Record audit** (L993; ES L1238) — same as Fable 3 (`CountForm.tsx:167,215-218,368-375`).
11. **"Record audit stays grey until each line has a unit"** (L984; ES L1237): it turns on once ONE line has item, unit and quantity; unfinished lines are dropped with "{n} unfinished line(s) — they won't be saved" (`CountForm.tsx:53-59,167,362-365`; `en.json:3434`).

MISSING PASSWORD PROMPT
12. **Changing station times asks for the password** (L177, L1225; ES L279, L1285) (`app/(authed)/stations/page.tsx:11,36-38`; `app/api/admin/stations/route.ts:18,38`). → "It asks for your password (**Confirm your password**)."

MINOR
13. Pulse "Each line has an Assign button" (L442; ES L642): the button varies — Assign, Trim, Close, Check, Order, Ring in, Prep, Link (`AttentionList.tsx:77`; `en.json:5695-5703`). → "an action button, like **Assign**".
14. "Assigned to someone else" (L195) shows under a task the person can't open, not as a reaction to a tap (`ShiftBoardClient.tsx:225,229`). Reword (also Fable 6).
15. Counts step 4 "Check the list on the right" (L1001): AGM+ only (`counts/page.tsx:29,47`); on a phone it's below. Qualify.
16. "Closer count is last night's AM prep count" (L366): or your recount (manager.steplog:112).
17. PM report "Only the people on shift are listed at first" (L770): it's everyone with recorded activity today plus anyone already graded (`pm-report-client.tsx:345-350`). Reword.
