# Catering guide — review round 1 (2026-10-13)

Reviewers: Opus 5.5 (code fact-check, ~265 claims) and Fable 5.1 (fact-check + plain-language, ~470 claims). Both: FIX FIRST.

## Fixes to apply

1. **Manager login is AGM and up, not shift leads** (L78, L167). `lib/roles.ts:55` shift_lead `hasEmailAuth: false`; `app/api/auth/password/route.ts:103-106`. → "AGM, Catering Manager and up…" / "Subgerente General, Gerente de Catering y arriba…".
2. **Who sees email/phone** (L53, L153, L721, L779). The level-9 (Owner, Chief Growth Strategist) rule is only the Admin → **Customers** profile page (`lib/customers/access-shared.ts:4-15`). Catering Customers shows email and phone on every row to Shift Lead and up (`components/catering/customers/CustomersClient.tsx:73-76`, `lib/catering/customers.ts:19,84`). → limit the sentence to "on the **Customers** page in Admin"; L689 → "name, email and phone"; add "Contacts you add in Catering Customers show their email to anyone who can open that list."
3. **Deactivate does not hide** (L691, L757). Inactive rows stay with "(inactive)" and the button becomes **Reactivate** / **Reactivar** (`CustomersClient.tsx:71,210`; `lib/catering/customers.ts:103-114`). → "**Deactivate** marks the person inactive. They stay on the list; **Reactivate** brings them back."
4. **"Qty starts at 1" is wrong for package lines** (L482, L556). Package lines take the package's count (`components/catering/quotes/QuotesClient.tsx:300`; platters 8/16/32/48). Only à la carte, blank and package-price lines start at 1 (`:185,281,309,317`). → "À la carte lines start at Qty 1. A platter's pick line comes in at its piece count. Qty never follows the headcount."
5. **"Not in Toast yet" search box only at 10+ orders** (L611, ES L653). `components/catering/pipeline/NotInToast.tsx:30`. → "When the list has 10 or more orders, a search box lets you find one by code, shop or date."
6. **Confirmed plans food only with a linked quote that has an event date** (L346, L998, ES L426, L1098). `lib/catering/prep-demand.ts:118-142`. → add "…and the lead has a quote with an event date, picked under **Pipeline lead**." Give the quote step (L462) that reason.
7. **Password prompts missing**: **Confirm move** (Move to other shop, L352-358 / L432-438; `components/catering/pipeline/TransferLead.tsx:32`) and **Send quote** (L517/L583; `QuotesClient.tsx:723-725,834`). → "Enter your password if it asks."
8. **Send quote does not promise an email** (L517/L583). The send marks the quote sent; email is best-effort and the app shows an outcome message (`lib/catering/quotes.ts:944-1011`; `en.json:4179-4183`). → "**Send quote** marks the quote as sent and tries to email the client. Read the message that appears: it tells you if the email went out. If it says the email could not be delivered, send the price yourself and tell your GM."
9. **Insights money tiles count only accepted quotes** (L820, ES L864). `lib/catering/insights.ts:11-13`. → "Only an accepted quote counts in the money tiles. A draft or sent quote does not. ezCater orders count at their own total."
10. **The lead card also shows the notes typed on Add lead** (L325, ES L409). `components/catering/pipeline/PipelineClient.tsx:427-446`. → add "and the notes you typed".
11. **"No pricing rule for this location" is a message, not a button** (L506, ES L574). Full text `en.json:4151`. → quote as a message starting *No pricing rule for this location*; "tax and the other charges show $0 until a Manager of Operations sets them in **Pricing & Tax**".
12. **Spanish**: bold **Coincidencia sugerida** (ES L666; `es.json:64`).
13. **Quote status list** (L516): code also has `submitted` (portal quotes, `lib/catering/quotes.ts:36`) with no label — leave the list as is (low priority).

## Plain-language fixes (Fable)

- **The marketing list** (L734-742): say where the button lives — Admin → **Customers**, Owner and Chief Growth Strategist only (`app/admin/customers/page.tsx:66`); a GM never sees it.
- **Amber "Order comparison is currently unavailable."** (L327): "This line is about ezCater orders. On a lead you typed in, it always shows. Ignore it." (`EzcaterReconciliationPanel.tsx:27-30`).
- **Customer page "None yet."** (L692): "**Pipeline** lists only leads tied to this customer record; a lead you typed on the board will not show here." (`lib/catering/customers.ts:159-165`).
- **Start a quote** (L466): add "Type a **Client email** the app already knows and it fills in **Client name** and **Company**; the box suggests known emails as you type." (`QuotesClient.tsx:406-414`).
- **Log in step 2** (L63): the tile reads "CTR Catering Manager" → "AGM, CTR (Catering Manager) or GM".
- **Pipeline search by phone** (L279 vs L310): add "Phone numbers come in with ezCater and online leads."
