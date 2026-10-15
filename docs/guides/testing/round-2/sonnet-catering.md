# Report — sonnet — catering guide
Model I am: Sonnet 5.5 (claude-sonnet-5-5)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in and open catering | done | 8 (shop, role, name, 4 PIN taps, Catering tile) |
| 2 | Add Hill Staffers Sonnet R2 LLC as a lead with a vegetarian note | done | 9 (open Pipeline, + Add lead, 5 field entries, Add, plus 1 tap to open the card and confirm the note saved) |
| 3 | Make a quote from a package and tie it to the lead | done | 7 (hub, Quotes, New quote, pick lead, pick Light Lunch, notes, Save draft) |
| 4 | Lead said yes: move it so the kitchen plans | done | 10 (Send quote, type password, Confirm, Mark accepted, back to hub, Pipeline, open card, Confirmed; 2 of these were retries after a timeout) |
| 5 | Find ezCater orders | done (none exist in this copy) | 1 (Source filter set to EZCater) |
| 6 | Find the catering customer list and open one | partly: found the list, but it is empty, so there was nothing to open | 3 |
| 7 | Check this month's catering numbers | done | 3 |
| 8 | Find where catering setup is (look only) | done | 2 (plus 1 extra tap into Prep Demand to check the kitchen got the job) |

## Where I got stuck
- Goal 6, Catering Customers (/catering/customers, heading "Catering Customers"): the page says "No customers yet." so I could not open anyone. I did not add one, because the goal said to open one, not make one. The guide explains this. "Catering Customers", Worth knowing: "A person joins this list in one of three ways. You save a quote with their Client email. You add a lead with their Email. Or you add them with + Add customer." So the guide was right. The brief gave me no email for the client, so I left the email blank and no customer was created. The guide does not say what to do when you are told to open a customer and the list is empty.
- Goal 4 (small): the app only said "nothing was emailed" after Send quote, because the quote had no client email. The guide covers this ("With no Client email, the quote is still marked sent, but no one gets an email"). Not stuck, but a new manager may panic when they see it.

## Notes for the team
- What would make the guide better:
  - Say clearly that the email is the thing that creates a customer. "Add a lead" puts "Email" late in the list of optional boxes. A one-line warning in "Add a lead" would help: if you want this client to show up in Catering Customers, type their email now.
  - In "Add a lead", step 2 says to put the company name in Contact name if you only know the company. That worked, but the card then shows the same name twice. The guide could show that picture so it doesn't look like a bug.
  - "next Friday" has no help in the guide. I picked Fri Oct 23 (the Friday of the following week). Nothing in the app confirms which date is right, but that is outside the guide.
  - The guide never tells you to expect a slow screen change. See below.
  - In "When the client says yes" the order is Send quote, Mark accepted, then Move. This worked exactly. Good.
  - The sub mix goes in Notes. The Light Lunch package adds a "Choose your sub × 25" line. The guide covers this well.
- What is hard in the app for no reason:
  - After tapping Back (to Catering) and then tapping a tile right away, the tap often timed out ("locator.click: Timeout 5000ms"). The screen had not finished changing. I had to run look and tap again. I hit this 4 times. On a real tablet this would feel like the app ignoring a tap.
  - The tap result says "Now at /catering" while the page is still showing the old screen, so the address it reports is unreliable until a look is done.
  - On the quote form, Client email is empty even after you pick the lead, so the quote cannot be emailed. The guide says this is on purpose, but a manager will hit it on their first quote.
  - Case: the lead card in the pipeline shows the company name twice (contact and company), because I used the company as the contact.
- Steps that confused me even when the guide was right:
  - The password check on Send quote. The guide mentions it ("Enter your password if it asks") and it appeared as a box. Fine.
  - After "Mark accepted" the green message still says "Quote marked sent. ... nothing was emailed" with no sign that the accept worked, other than the ACCEPTED label at the top. The change from SENT to ACCEPTED is easy to miss.
  - Moving to Confirmed gives no message. The lead just changes column. The guide warns about this.
- Anything that looked broken:
  - Nothing that lost data. The slow-screen taps above are the only issue.
  - The Insights page showed "Open pipeline $0.00" and "Confirmed (upcoming) $330.00 / 1 events", which matches the guide after Mark accepted.
  - Calendar on Insights opens on today (Wed Oct 14), not the month's booked day, so "No booked catering this day." shows at first. You have to find Oct 23 yourself (it is marked "1 booked").

## The 5 best things CO-OPS does for a restaurant
1. The lead board (Catering Pipeline): every catering job sits as a card in a stage column, from Inquiry to Completed. It matters because nothing gets lost in someone's inbox or head, and anyone on the team can see where a job stands and who owns it.
2. Package quotes with automatic totals: pick a package like Light Lunch, type the headcount, and the app fills the quantity (25), subtotal $300, tax $30, total $330 and deposit due $82.50. It matters because quotes are fast and priced the same way every time, with the deposit worked out for you.
3. Confirming a lead puts the food on the kitchen's plan: after Mark accepted and Move to Confirmed, Prep Demand showed Fri Oct 23 with "25 × Choose your sub" and the client's name. It matters because the kitchen knows what to make and for whom without a separate phone call or note.
4. Catering Insights with money by event date: it showed this month's booked events, Confirmed (upcoming) $330, win rate, open pipeline and a booked-day calendar, once the quote was accepted. It matters because the manager can see what catering is worth and what is coming, in one screen, with a CSV or PDF to take away.
5. Role-based access and a password check on sensitive actions: a GM saw the setup tiles meant for GMs, and Send quote asked me for my password before it went. It matters because the people who run the floor can do their job, and money-touching actions have a second check.
