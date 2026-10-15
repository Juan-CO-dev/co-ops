# Catering walk — Marcus Webb (general manager, logs in at P Street, PIN 9999), tablet 1024×768; admin and setup pages at desktop

Guides v2 photo walk for the **catering guide**. Re-shoot 2026-10-14: every photo the guide links, in guide order (two exceptions, noted below), plus new shots for screens the guide had only in words.
Shots go to `docs/guides/img/catering/<file>.png`; the log goes to `docs/guides/walks/catering.steplog.md`.
Source of truth for every label and rule: `docs/guides/testing/facts.md` and `docs/guides/testing/app-changes-2026-10-14.md`. The guide itself: `docs/guides/catering-guide.md`.
Four of these photos are also linked in the manager guide (`21-sales`, `22-catering-sales`, `23-customers`, `24-catering-accounts`): they need a GM, so you take them for both guides.

Order exceptions: (1) the logout photo (34) is linked in "Start here" but is taken last; (2) Insights and Sales (19–22, tablet) are taken before the Admin customer pages (23–24, desktop), so the browser switches to desktop only once.

## Your tool (every step uses it)

```
node scripts/guide-test/gt.mjs walk-catering start tablet walker      (desktop pages: start desktop walker)
node scripts/guide-test/gt.mjs walk-catering look            (screen text + numbered controls)
node scripts/guide-test/gt.mjs walk-catering tap <number|label>
node scripts/guide-test/gt.mjs walk-catering type <number|label> <text>
node scripts/guide-test/gt.mjs walk-catering press Enter | scroll down | back
node scripts/guide-test/gt.mjs walk-catering goto </path>     (walkers only, when a goal names a page)
node scripts/guide-test/gt.mjs walk-catering shot catering/<file>.png [full]
node scripts/guide-test/gt.mjs walk-catering stop
```

How to drive it:
- Run `look` after every action. Control numbers change on every `look`; only use numbers from the latest one.
- `type` on a drop-down picks the option whose text you give.
- A browser pop-up (confirm box) is accepted for you. The next `look` prints it as `DIALOG (accepted) …`. Copy that text into the log.
- `shot` photographs what is on the screen now. Scroll so the thing the goal is about is in view first. Add `full` only where this script says full page.
- Move by tapping, like a person. Use `goto` only for a path this script names, and only after 3 honest tries to reach it by tapping; log that you used it.
- For a desktop-width shot: `stop`, then `start desktop walker`, and log in again (goal 9). The desktop browser is 1440×900.

## Rules

1. Fake names only. You are Marcus Webb. Never type anything except the test PIN `9999` and the fake data this script names for that step.
2. Never photograph an error toast or a half-loaded screen. If `look` shows "Loading", a spinner word, or an error message: wait, `look` again, and retake. If the error stays, log it under `Bug?` and do not photograph it.
3. Check every photo. After each `shot`, open the saved PNG and look at it. Retake it if it shows an error, a spinner, a chart still drawing, a bar or menu drawn across the middle, or if the thing the step names is cut off.
4. If a goal is blocked, write `BLOCKED <goal>: <why>` in the steplog (see below) and move on to the next goal. Make 3 honest tries before calling it blocked.
5. Never tap anything that sends email or a text, takes a payment, downloads a file or reveals contact details: no **Send quote**, **Resend**, **Mark accepted**, **Mark declined**, mark-paid, **Download**, or reveal buttons. Never save a new company. Setup pages are look-only: change nothing there.
6. Work at P Street. Do not switch the language. Do not delete any old photo.

## The steplog

Replace the old content of `docs/guides/walks/catering.steplog.md`. First line: `# Catering walk — step log (Marcus Webb, <today's date>)`.
Then one block per shot, as `docs/guides/walks/_steplog-schema.md` says (URL, Persona / viewport `Marcus Webb, General Manager / 1024x768` or `/ 1440x900` for desktop shots, Action, Saw, Shot, Confused, Bug?), with ONE change to its numbering rule:
- **Use the exact file names this script gives. Never renumber.** The guide already links these names, and the new shots use an inserted letter (`06b-…`, `10b-…`, `18b-…`) to keep their place. Head each block `## Step <number part> — <slug>`, for example `## Step 10b — lead-edit-details`, and write `- Shot: img/catering/10b-lead-edit-details.png`.
- Take the shots in the order this script lists them, so the numbers are not always in a row. That is expected.
- A shot you could not take gets its own block with no picture: `## SKIPPED — <file>` then `- SKIPPED <file>: <why>`. A blocked goal: `## BLOCKED — <goal>` then `- BLOCKED <goal>: <why>`.
- `Saw` quotes the screen: headings and button labels in their exact words.
- Record every note or comment field you meet: where it was and what its placeholder said.

## Fake data for this walk (type only these)

- Company: `Hill Staffers LLC`
- Contact name: `Jordan Sample`
- Client email (on the quote only): `orders@hillstaffers.example`
- Headcount: `25`
- Event date: the Friday of NEXT week (not this week's Friday). Follow-up date: the Thursday of next week. Type dates in the format the date box shows.
- Lead note: `Sim walk: wants a mix of hot and cold subs. Call Thursday to confirm.`
- If a box asks for a shop, pick P Street. If any other box is required and not listed here, log its label and leave it empty if you can; if you cannot, write BLOCKED.

## What Marcus can and cannot do (facts.md)

Marcus is a GM (level 7). He can view, add, edit and move leads, build quotes, and open Catering Insights, Customers, Catering accounts and Sales for his shops. He can NOT open **Pricing**, **Rate rules** or **ezCater item review**, and he can NOT **Move to other shop**. Do not try them; log only whether they are listed.

## The day you will meet

The sim was reset before your walk. The pipeline has no Hill Staffers LLC lead, there are no quotes, and the practice board has no ezCater orders.
What changed in the app since the last walk (so the old photos are stale): the round user button sits in the page instead of floating over it; the app opens on the shop you picked at login (P Street); an opened lead has **Edit details** and no amber "Order comparison is currently unavailable." line; picking a lead on a new quote fills in the quote; a saved quote shows **Client** and **Lead**; a customer's page lists their **Quotes** and leads; Prep Demand no longer shows the "Sub — par comparison in W4b" text.

---

## Goals (guide order)

### 1. LOG IN (tablet) — guide "Start here › Log in / Get to catering"
Run `start tablet walker`, then `look`.
- On "Where are you?": shot **01-where-are-you**. Tap the P Street tile.
- On "What's your role?": shot **02-whats-your-role**. Tap the General Manager tile.
- On "Who are you?": shot **03-who-are-you**. Tap Marcus Webb.
- On "Enter your 4-digit PIN": shot **04-pin-keypad**. Tap `9` four times.
- Shot **05-dashboard** with the shop switcher and the **Explore** chips (including **Catering**) in view. Log which shop the dashboard opened on (it should be P Street now; if it is Capitol Hill, log it under `Bug?`, switch to P Street, then take the shot).

### 2. CATERING HUB AND THE PULSE — guide "The hub"
Tap path: Dashboard → **Explore** → **Catering**.
- Shot **06-catering-hub** (the six cards). Log every card in exact words.
- **NEW.** Dashboard → **Explore** → **Mid-Shift Pulse**. Scroll to the **Catering** section. Shot **06b-pulse-catering** with the whole Catering section in view. Look only: do not write or post a handoff note. Log its exact text (for example "Every ezCater order is in Toast.") and whether money shows.

### 3. PIPELINE — guide "The pipeline"
Tap path: Dashboard → **Catering** → **Catering Pipeline**.
- Shot **07-pipeline** (search box, filters and the stage columns).
- Tap **+ Add lead**. Fill it with the fake data: **Contact name** Jordan Sample, **Company** Hill Staffers LLC, **Event date** next week's Friday, **Headcount** 25, **Location** P Street, **Notes** the lead note. Leave **Lead source** on **Staff entered** and **Order lead** as it starts. Shot **08-add-lead-form** with the filled form in view. Tap **Add**.
- Shot **09-lead-created** showing the Hill Staffers LLC card in **Inquiry**.
- Tap the card to open it. Shot **10-lead-detail** with **Edit details**, "No caps set" and the **Move to** buttons in view. (Photo-check retake: the old shot had the amber "Order comparison is currently unavailable." line and no **Edit details**. If the amber line still shows, log it under `Bug?`.)
- **NEW.** Tap **Edit details**. Set **Follow-up date** to next week's Thursday. Shot **10b-lead-edit-details** with the edit form (Contact name, Company, Event date, Headcount, Follow-up date, Notes, **Save**, **Cancel**) and the new date in view. Tap **Save**. Log what the card shows after.
- Open the card again. Under **Move to**, tap **Quote sent** (do NOT move it to Confirmed). Shot **11-lead-moved** showing the card in the **Quote sent** column.
Log every field on the add-lead form and its placeholder, the stage names in order, the search box placeholder, and whether **Move to other shop** shows for you (it should not).

### 4. A QUOTE for Hill Staffers LLC — guide "Quotes"
Tap path: Dashboard → **Catering** → **Catering Quotes**.
- Shot **12-quotes-list** (**New quote** and "No quotes yet.").
- Tap **New quote**. Under **Pipeline lead**, pick the Hill Staffers LLC lead. `look`: **Client name**, **Company**, **Event date** and **Headcount** should fill in by themselves and **Location** should be P Street. Type `orders@hillstaffers.example` in **Client email**. Shot **13-quote-builder** with the top of the form, the picked lead and the filled boxes in view. Log what filled itself, and how the lead option reads (contact · company · date · shop).
- In **Add package** pick the first package; if it is priced per head (it brings in **Qty** 1), set its **Qty** to `25`. In **Add à la carte** pick the first item and leave its **Qty** at 1. Log whether an empty first line was there before you added anything.
- Scroll to the totals. Shot **14-quote-totals** with **Subtotal** and **Total** (and **Tax** / **Deposit due** if they show) in view.
- Tap **Save draft**. Shot **15-quote-saved**: status **draft**, the total, **Client** (name, company, email), **Lead** (contact, company, date), **Expires**, the lines and the buttons. (Photo-check retake: the old shot had no **Client** and **Lead** lines.)
Log every button on the quote (read them, do not tap **Send quote**, **Mark accepted** or **Mark declined**) and how the totals are split.

### 5. ezCATER ORDERS — guide "ezCater orders"
Go back to **Catering Pipeline**. Set **Source** to **EZCater**.
- Take no shot. Log what each column says (expected **None**) and whether a **Not in Toast yet** panel shows (expected: it does not). If an ezCater lead IS there, log its card text and do not open anything else.

### 6. CUSTOMERS AND COMPANIES — guide "Customers and companies"
- Dashboard → **Catering** → **Catering Customers**. Shot **16-catering-customers** (grouped by company, **+ Add customer** in view; Jordan Sample should now be listed under Hill Staffers LLC).
- Open Jordan Sample (else the first person). Shot **17-customer-detail** with **Pipeline** (the Hill Staffers LLC lead), **Quotes** (your draft quote with its total, status and date), **Orders**, **Edit** and **Deactivate** in view. (Photo-check retake: the old shot had no **Quotes** list.) Edit nothing. If **Pipeline** or **Quotes** says "None yet", log it under `Bug?`.
- Dashboard → **Catering** → **Catering Companies**. Shot **18-catering-companies** (**New company** and "No company accounts yet.").
- **NEW.** Tap **New company**. Shot **18b-new-company-form** with the empty form and its buttons in view. Type nothing. Close it with **Cancel** (or `back`) without saving. Log every field and its placeholder.

### 7. INSIGHTS — guide "Insights and sales › Catering Insights"
Dashboard → **Catering** → **Catering Insights**.
- Shot **19-insights** (top: the range buttons and the number tiles).
- Shot **20-insights-full** `full` (with the booked catering calendar and customer feedback).
Log the headings, what **OPEN PIPELINE** shows now that a draft quote exists, and what the money split says, in the screen's words.

### 8. SALES (tablet; for both guides) — guide "Insights and sales › Sales and catering sales"
Tap path: Dashboard → **Explore** → **Reports Hub** → the **Sales** family → **Sales**.
- Shot **21-sales** (tabs, views, date range and the sales tiles, your shop).
- Tap the **Catering** tab. Shot **22-catering-sales** (ezCater orders and catering rung in Toast).
Log the tabs and views listed. All-shops sales needs level 8; do not look for it. Do not tap any download.

### 9. SWITCH TO DESKTOP WIDTH
Run `stop`, then `start desktop walker`. Log in again exactly as in goal 1 (P Street → General Manager → Marcus Webb → `9999`), with no shots. Check the shop is P Street.

### 10. CUSTOMERS AND CATERING ACCOUNTS (desktop) — guide "Customers and companies › Customers (GM and up) / Catering accounts (GM and up)"
Tap path: Dashboard → **Explore** → **Admin** → **Customers**.
- Shot **23-customers** (counts, groups, filters and the profile list). Do not tap any reveal or download button.
- Tap **Catering accounts**. If there is no link after 3 tries, `goto /admin/customers/catering` and log that. Shot **24-catering-accounts** (counts, sort and the **Gone quiet only (over 90 days)** filter).
Log what each page shows and which contact fields are hidden.

### 11. SETUP (desktop; look only) — guide "Setup"
Tap path: Dashboard → **Explore** → **Catering** → **Admin & setup**.
- Shot **25-catering-setup** (the setup page and its tiles).
- Open each of these, one shot each, then come back to the setup page. Change nothing.
  - **26-setup-packages** — Packages
  - **27-setup-menu** — Catering Menu
  - **28-setup-capacity** — Capacity & Blackouts
  - **29-setup-zones** — Delivery zones
  - **30-setup-fulfillment** — Fulfillment Zones (the map, pin and delivery radius)
  - **31-setup-faq** — FAQ
  - **32-setup-prep-demand** — Prep Demand. The "Sub — par comparison in W4b" text must be gone (log it under `Bug?` if not).
  - **33-setup-lto** — LTO & discounts
Log the exact tile names, the page's sub-line, and whether **Pricing**, **Rate rules** and **ezCater item review** are listed; do not open them.

### 12. LOG OUT — guide "Start here › Log out"
Dashboard → scroll to the bottom → **Log out**. `look`.
- Shot **34-logged-out** (the "Where are you?" screen).
Then run `stop`.

---

Planned: 12 goals, 37 shots — 34 retakes of the guide's linked photos (01–34) and 3 new: 06b-pulse-catering, 10b-lead-edit-details, 18b-new-company-form.
