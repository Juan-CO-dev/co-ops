# Report — fable — catering guide
Model I am: Fable 5.1 (claude-fable-5-1)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in and open catering | done | 9 |
| 2 | Add Hill Staffers Fable R1 LLC as a new lead (25 ppl, next Friday, vegetarian note) | done | 11 |
| 3 | Make them a quote from a package and tie it to their lead | done | 16 |
| 4 | Move the lead forward so the kitchen plans the food | done | 4 |
| 5 | Find the catering orders that came in from ezCater | partly | 13 |
| 6 | Find the list of catering customers and open one | done | 4 |
| 7 | Check this month's catering numbers | done | 5 |
| 8 | Find where catering is set up (look only) | done | 6 |

What I left behind: lead "Fable R1 Contact · Hill Staffers Fable R1 LLC", P Street, Fri Oct 23, 25 ppl, assigned to Marcus Webb, notes "Lunch for 25 next Friday. They want vegetarian options.", now in **Confirmed**. One draft quote, $330.00 (Light Lunch × 25 at $12 = $300, tax $30, deposit due $82.50), tied to that lead under **Pipeline lead**, client email fable.r1@hillstaffers-fable.example.com. That email also created the customer "Fable R1 Contact" under HILL STAFFERS FABLE R1 LLC in Catering Customers. I changed nothing in setup.

## Where I got stuck

### Goal 5 — ezCater orders (partly)
- **Screen 1:** `/catering/pipeline`, heading **Catering Pipeline**. I set **Source** to **EZCater** as the guide says. Every column read **None** (0/0/0/0/0/0). I also tried **Toast catering** and **Online portal** (all 0), and typed "ezcater" in the search box and tapped **Search** (the board did not change at all, no "no results" message). There was no **Not in Toast yet** panel anywhere on the page.
- **Screen 2:** `/reports/sales/catering?...`, heading **Catering sales** (Reports Hub → Catering sales). Capitol Hill, last 7 days: "0 ezCater orders · $0.00". P Street, Last 12 months: still "0 ezCater orders · $0.00", "ezCater orders in this range — Nothing in this range."
- **What the guide says:** under **Find an ezCater order**: "Set **Source** to **EZCater**." and then "This is not shown in photos. Our practice board had no ezCater orders." Under **Ring ezCater orders into Toast**: "The panel shows only when there is an order to list."
- **Verdict:** the guide was honest and the steps are right, but the practice copy simply has no ezCater orders, so the goal cannot be finished here. I found both places where they would appear. Two things would have saved me actions: (a) a sentence under **Find an ezCater order** saying "If every column says None with Source on EZCater, no ezCater order has come in — there is nothing else to look for", and (b) one real ezCater order in the practice data so the **ezCater order** box and the **Not in Toast yet** panel can actually be seen. The guide also sends the GM to **Catering sales** to "check the match later", which is the second place I looked; it should say that page only covers finished business days, so an order for a future event date will not be there either.

## Notes for the team

- What would make the guide better:
  - **Move a lead** says Confirmed works "only if the lead has a quote with an event date, picked under **Pipeline lead**." True, and it worked with a *draft* quote — Prep Demand showed the job. But the money side does not: Insights showed my Confirmed Fable job on Oct 23 at **$0.00**, and **Open pipeline $0.00**, because the quote is a draft. That rule lives only in **Catering Insights** ("Only an accepted quote counts in the money tiles"). Put a one-liner in **Move a lead**: "When they say yes, also **Send quote** and **Mark accepted**, or the job shows as $0 in Insights."
  - **Add packages and items** says "The **Light Lunch** package also added a 'Choose your sub' line with no price." It does not say what to do with that line. Later, **Prep Demand** shows the kitchen "Choose your sub — NEEDS PICK". Tell the reader what picks the sub (edit the description? add the sub à la carte? the kitchen picks?). Right now the line is a mystery on both pages.
  - Light Lunch is sold **Per head** (Packages page: "Per head · $12.00 · Serves 1") but drops into the quote at **Qty 1**. The guide's warning "**Qty** never follows the headcount" is correct but buried in Worth knowing. Move it up to step 1 with the example: "Light Lunch for 25 people = Qty 25. If you leave it at 1 you quote $12 for the whole lunch."
  - "The app may open on the other shop" is listed only under **Get to catering**. It happened to me on the dashboard, **Reports Hub**, **Catering sales** and **Prep Demand**, even after I had tapped P Street on the dashboard. Say it once, globally: "Every page with a shop picker may open on Capitol Hill. Check the shop on every page."
  - **Start a quote** step 6 ("Don't skip it") is the most important sentence in the guide. Good. Add "The saved quote page does not show the lead, so check the **Pipeline lead** box before you save" — because once saved there is no way to see the tie.
  - **Read the board**: "Type, then tap **Search**." I typed "ezcater" and tapped Search; nothing happened. Either say what an empty result looks like, or check whether Search needs Enter.
  - **Catering Insights**: say which range is on when the page opens (I could not tell which of the four buttons was active) and that the calendar day list is where you see the job-by-job money.
  - **Read the saved quote** mentions **Expires** but not where the date comes from (mine showed Tue, Oct 27, two weeks out) or whether it can be changed.
  - The **Who can do what** table told me correctly that as GM I would not see **Pricing & Tax**, **Catering Rates** or **ezCater item review**. That table is good — refer to it from goal-type sections ("As GM you will not see the ezCater item review tile").

- What is hard in the app for no reason:
  - The shop resets to Capitol Hill on page after page after logging in at P Street. Reports Hub even rewrote the URL to the Capitol Hill location id.
  - A per-head package comes in at Qty 1 when the headcount (25) is already typed two fields above.
  - The saved quote page shows no client name, email, company, or linked lead. I cannot verify the thing goal 3 asked me to do.
  - The customer page for Fable R1 Contact says **Pipeline: None yet.** and **Orders: None yet.** while the lead is Confirmed and a quote exists. The guide warns about it, but to a manager this is the app saying the customer has nothing.
  - No way to add a note to a lead after it is created.
  - Add lead has no email or phone box; the quote does not pull the lead's name or company. I typed "Hill Staffers Fable R1 LLC" and "Fable R1 Contact" twice.
  - Two meanings of "booked": the kitchen plans a Confirmed job with a draft quote, but Insights counts it as $0 until the quote is marked accepted.
  - The quote form starts with an empty line that stays after a package is added; I had to delete it myself.

- Steps that confused me even when the guide was right:
  - After tapping **Confirmed** the first look still showed the card in Inquiry (and newly showed **No caps set**); a second look showed it in Confirmed. No spinner or message during the move.
  - **Save draft** showed a plain "Loading…" page before the quote page. The guide says the quote page opening is the sign, so I waited, but a new user may tap Save again.
  - Picking the **Pipeline lead** really does leave name, company and email blank. The guide said so; it still felt like I had picked the wrong thing.
  - **No caps set** did not appear on first open of my card, only after the move. The guide describes it as if it is always there.
  - Prep Demand lists "Choose your sub NEEDS PICK" twice on Oct 23 without naming which lead each belongs to, so I could not be sure one was mine.
  - On the Insights calendar, "Fri, Oct 23 · 8 booked" shows the Fable job at $0.00 next to others at $549.73 — reads like my quote failed until you remember the accepted-only rule.

- Anything that looked broken:
  - Pipeline search: "ezcater" + **Search** changed nothing and gave no message.
  - Prep Demand (P Street, Oct 23) shows the text "Sub — par comparison in W4b" on a line — looks like developer text leaking to the screen.
  - Reports Hub ignores the shop selected on the dashboard (URL came back with the Capitol Hill id).
  - Customer detail says **Pipeline: None yet.** for a customer whose lead is on the board and Confirmed.
  - The amber "Order comparison is currently unavailable." shows on a staff-entered lead. The guide says ignore it; it still reads as an error.
  - Prep Demand showed "No upcoming catering prep demand" on first look after I switched to P Street; a second look showed the list. Same silent-refresh pattern as the board move.

## The 5 best things CO-OPS does for a restaurant
1. **The pipeline board.** Every catering job is a card in a stage column (Inquiry → Quote sent → Confirmed → Out for delivery → Completed → Lost) with counts per column, and one tap under **Move to** moves it. A manager sees the whole catering book at a glance and never loses a lead in an inbox.
2. **Confirmed feeds the kitchen.** When I moved the lead to Confirmed, **Prep Demand** for P Street listed its food for Oct 23 in the 14-day view (alongside "2 × House Greek Salad" from other jobs). The kitchen plans from the same record the manager sold from — no re-typing, no forgotten orders.
3. **Quote builder with live totals.** Pick a package, fix Qty and price, and Subtotal, Tax, Total and Deposit due update as you type; the saved quote gets a status, an expiry date, Send, Revise and Print labels. Pricing a lunch for 25 took under a minute and the deposit math was done for me.
4. **Catering Insights for this month.** New leads (13), booked events (12), confirmed upcoming money ($1,112.66), win rate, average headcount, leads by source, and a calendar with dots — tap Oct 23 and see all 8 jobs with headcount and money. A GM can answer "how is catering doing" without a spreadsheet.
5. **Customers build themselves.** Saving the quote with a client email created "Fable R1 Contact" under HILL STAFFERS FABLE R1 LLC in Catering Customers, grouped with every other company. The customer list grows from real work instead of someone keeping a separate contact sheet.
