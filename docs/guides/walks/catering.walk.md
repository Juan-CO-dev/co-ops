# Catering walk — Marcus Webb (general manager, logs in at P Street, PIN 9999), tablet 1024×768; setup/admin pages at desktop

Guides v2 photo walk for the **catering guide**: login → hub → pipeline → quotes → ezCater orders → customers and companies → insights → setup.
Shots go to `docs/guides/img/catering/NN-slug.png`; the log goes to `docs/guides/walks/catering.steplog.md`.
Source of truth for every label and rule: `docs/guides/testing/facts.md`. Outline: `docs/superpowers/specs/2026-10-13-guides-v2-design.md`.

## Your tool (every step uses it)

```
node scripts/guide-test/gt.mjs walk-catering start tablet walker      (desktop pages: start desktop walker)
node scripts/guide-test/gt.mjs walk-catering look            (screen text + numbered controls)
node scripts/guide-test/gt.mjs walk-catering tap <number|label>
node scripts/guide-test/gt.mjs walk-catering type <number|label> <text>
node scripts/guide-test/gt.mjs walk-catering press Enter | scroll down | back
node scripts/guide-test/gt.mjs walk-catering goto </path>     (walkers only, when a goal names a page)
node scripts/guide-test/gt.mjs walk-catering shot catering/NN-slug.png [full]
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
3. If a goal is blocked, write `BLOCKED <goal>: <why>` in the steplog (see below) and move on to the next goal. Make 3 honest tries before calling it blocked.
4. Never tap anything that sends email or a text, takes a payment, downloads a file or reveals contact details: no **Send quote**, **Mark accepted**, **Mark declined**, mark-paid, **Download**, or reveal buttons. Setup pages are look-only: change nothing there.
5. Work at P Street. Do not switch the language. Do not delete any old photo.

## The steplog

Replace the old content of `docs/guides/walks/catering.steplog.md`. First line: `# Catering walk — step log (Marcus Webb, <today's date>)`.
Then one block per shot, exactly as `docs/guides/walks/_steplog-schema.md` says (Step NN — slug, URL, Persona / viewport `Marcus Webb, General Manager / 1024x768` or `/ 1440x900` for desktop shots, Action, Saw, Shot `img/catering/NN-slug.png`, Confused, Bug?).
- `Saw` quotes the screen: headings and button labels in their exact words.
- The shot numbers below are the plan. Number shots in the order you really take them, two digits, contiguous from 01. If a shot is skipped, the next one takes the free number and keeps its slug.
- A blocked goal gets its own block with no number and no shot: `## BLOCKED — <goal>` then `- BLOCKED <goal>: <why>`.
- Record every note or comment field you meet: where it was and what its placeholder said.

## Fake data for this walk (type only these)

- Company: `Hill Staffers LLC`
- Contact name: `Jordan Sample`
- Phone: `202-555-0147`
- Email: `orders@hillstaffers.example`
- Headcount: `25`
- Event date: the Friday of NEXT week (not this week's Friday). Type it in the format the date box shows.
- Lead note: `Sim walk: wants a mix of hot and cold subs. Call Thursday to confirm.`
- If a box asks for a shop, pick P Street. If any other box is required and not listed here, log its label and leave it empty if you can; if you cannot, write BLOCKED.

## What Marcus can and cannot do (facts.md)

Marcus is a GM (level 7). He can view, add, edit and move leads, build quotes, and open Catering Insights, Customers, Catering accounts and Sales for his shops. He can NOT open these setup pages, which need level 8: **Pricing**, **Rate rules**; and **ezCater item review** needs a Catering Manager or level 8. Do not try them; log only whether the setup hub lists them.

---

## Goals

### 1. LOGIN (tablet)
Run `start tablet walker`, then `look`.
- On "Where are you?": shot **01-where-are-you**. Tap the P Street tile.
- On "What's your role?": shot **02-whats-your-role**. Tap the General Manager tile.
- On "Who are you?": shot **03-who-are-you**. Tap Marcus Webb.
- On "Enter your 4-digit PIN": shot **04-pin-keypad**. Tap `9` four times.
- On the dashboard: Marcus belongs to both shops, so the header has a shop switcher. If it shows Capitol Hill, switch it to P Street. Shot **05-dashboard** with the switcher and the **Explore** chips (including **Catering**) in view.

### 2. CATERING HUB
Tap path: Dashboard → **Explore** → **Catering**.
- Shot **06-catering-hub**.
Log every card in exact words (expect **Catering Insights**, **Catering Pipeline**, **Catering Quotes**, **Catering Customers**, **Catering Companies**, and **Admin & setup**).

### 3. PIPELINE — create a lead, open it, move it one stage, add a note
Tap path: hub → **Catering Pipeline**.
- Shot **07-pipeline** (the board with its stage columns).
- Tap **Add lead**. Fill it with the fake data above (company, contact, phone, email, headcount 25, next week's Friday). Shot **08-add-lead-form** with the filled form in view. Save it.
- Shot **09-lead-created** showing Hill Staffers LLC in the **Inquiry** stage.
- Open the Hill Staffers LLC lead. Shot **10-lead-detail**.
- Use **Move to** to move it one stage forward, to **Quote sent**. (Do not move it to Confirmed: that reserves prep.) Shot **11-lead-moved** showing the new stage.
- On the lead, add the lead note from the fake data list and save. Shot **12-lead-note** with the saved note in view.
Log every field on the add-lead form and its placeholder, the stage names in order, and the search box placeholder.

### 4. A QUOTE for Hill Staffers LLC
Tap path: hub → **Catering Quotes** (or a quote link on the lead).
- Shot **13-quotes-list**.
- Tap **New quote** and pick the Hill Staffers LLC lead. Add one package for 25 people. If the builder offers single items (à la carte), add one item with quantity `1`. Shot **14-quote-builder**.
- Scroll to the totals. Shot **15-quote-totals**.
- Save it as a draft (do NOT tap **Send quote**). Shot **16-quote-saved** showing the quote and its status (draft).
Log the quote statuses you see, every button on the quote (**Send quote**, **Revise**, **Mark accepted**, **Mark declined** — read them, do not tap them), and how the totals are split.

### 5. ezCATER ORDERS (arrive on their own)
ezCater orders show as leads in the Pipeline with an **ezCater order** box on the lead (facts.md). Go back to **Catering Pipeline**.
- Find a lead that came from ezCater. Open it. Shot **17-ezcater-order** with the **ezCater order** box in view.
- Find the **Not in Toast yet** panel on the Pipeline. Shot **18-not-in-toast**.
If the sim has no ezCater lead or no panel, write `ABSENT: <which one>` in the log and skip that shot. Do not create one.

### 6. CUSTOMERS AND COMPANIES
- Hub → **Catering Customers**. Shot **19-catering-customers**. Open one customer (Jordan Sample if listed, else the first). Shot **20-customer-detail**.
- Hub → **Catering Companies**. Shot **21-catering-companies**. Open Hill Staffers LLC if listed, else the first. Shot **22-company-detail**.
Look only; edit nothing.

### 7. INSIGHTS
Hub → **Catering Insights**.
- Shot **23-insights** (top).
- Shot **24-insights-full** `full`.
Log the headings and what the money split says, in the screen's words.

### 8. SALES (for the manager guide; GM and up)
Facts.md: the Sales report needs a GM (level 7), so the manager walk (an AGM) cannot take these. Tap path: Dashboard → **Explore** → **Reports Hub** → the **Sales** family.
- Shot **25-sales** (the sales page, your shop).
- Open **Catering sales**. Shot **26-catering-sales**.
Log the sub-pages listed (for example **Sales checks**, **Catering sales**). All-shops sales needs level 8; do not look for it.

### 9. SWITCH TO DESKTOP WIDTH
Run `stop`, then `start desktop walker`. Log in again exactly as in goal 1 (P Street → General Manager → Marcus Webb → `9999`), with no shots. Switch the shop to P Street if needed.

### 10. CUSTOMERS AND CATERING ACCOUNTS (desktop; admin pages)
Tap path: Dashboard → **Explore** → **Admin** → **Customers**.
- Shot **27-customers** (the "Customers" list). Do not tap any reveal or download button.
- Open **Catering accounts** from the Customers area. If there is no link after 3 tries, `goto /admin/customers/catering` and log that. Shot **28-catering-accounts**.
Log what each page shows and which contact fields are hidden.
CHANGED: the call list put catering accounts before insights. Insights and sales (goals 7–8) were moved ahead of it so the walk switches to desktop only once; the admin pages (catering accounts and setup) are then taken together at desktop width, as the spec asks.

### 11. SETUP (desktop; look only)
Tap path: Dashboard → **Explore** → **Catering** → **Admin & setup** (the Admin → Catering page).
- Shot **29-catering-setup** (the setup hub).
- Open each of these, one shot each, then come back to the setup hub. Change nothing.
  - **30-setup-packages** — Packages
  - **31-setup-menu** — Menu
  - **32-setup-capacity** — Capacity
  - **33-setup-zones** — Zones
  - **34-setup-fulfillment** — Fulfillment
  - **35-setup-faq** — FAQ
  - **36-setup-prep-demand** — Prep demand
  - **37-setup-lto** — LTO
Log the exact tile names. Log whether **Pricing**, **Rate rules** and **ezCater item review** are listed; do not open them (a GM cannot).

### 12. LOG OUT
Dashboard → scroll to the bottom → **Log out**. `look`.
- Shot **38-logged-out** (the "Where are you?" screen).
Then run `stop`.

---

Planned: 12 goals, 38 shots (01–38).
