# Report — haiku — catering guide
Model I am: claude-haiku-5-5 (Haiku 5.5)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in and open catering | done | 8 |
| 2 | Add Hill Staffers Haiku R2 LLC as a lead (25 people, next Friday, vegetarian note) | done | 9 |
| 3 | Make a quote from a package and tie it to the lead | done (no client email, see notes) | 14 |
| 4 | Mark the client yes and move the lead forward so the kitchen plans | done | 9 |
| 5 | Find the catering orders that came in from ezCater | done (the list is empty; I confirmed none exist) | 7 |
| 6 | Find the catering customers list and open one | stuck | 7 |
| 7 | Check this month's catering numbers | done | 3 |
| 8 | Find where catering is set up (look only) | done | 3 |

Notes on the counts: a tap that reported a timeout but still changed the page is counted once. I did not use a 15-action run on any goal.

## Where I got stuck

**Goal 6: Find the catering customers list and open one.** Stuck.
- Screen: URL `/catering/customers`, heading "Catering Customers" ("Customer directory grouped by company, with lead and order history"). It said "No customers yet."
- What I tried: from the catering hub, opened **Catering Customers** (the guide's hub section, "The hub"). The list was empty. I opened **+ Add customer** to see its form (Name, Company, Contact person, Email, Phone, Location, Notes), then cancelled. I did not invent a customer with a made-up email.
- Why it was empty: I saved and sent the quote from goal 3 with no **Client email**, because the brief gave me only the company name. The guide says so only in the "Start a quote" section: "When you save a quote with a Client email, that person shows up in **Catering Customers**." That is the only clue, and it is easy to miss. The "Catering Customers" section says the list "lists the people who order" and says nothing about an empty list or what to do when there is no email.
- What the guide was missing: a sentence in "Customers and companies" (or in "Start a quote") saying that the customer list fills only from quotes with a client email, and what to do when you have no email yet.

## Notes for the team

- **What would make the guide better:**
  - In "Start a quote", step 5 says "Type the **Client email**" with no hint that it is needed for the client to show up in Catering Customers, or that sending without it marks the quote sent but emails nobody. Say that plainly, and say what a GM does when the client has no email yet.
  - In "Add a lead", "Fix a lead", and the Spanish equivalents, the guide says the form has no phone or email box. The app's form has both **Phone** and **Email** boxes (labelled "Phone" and "Email", above Event date). Fix or remove those sentences.
  - In "Add packages and items", the guide says a per-head package "come[s] in at **Qty** 1" and that "**Qty** never follows the headcount." In my run, Light Lunch came in at Qty 25 because I had already typed headcount 25 on the quote. The "Choose your sub" line also came in at 25. Say which is true, or say "Qty follows the headcount only if you typed it first."
  - In "Catering sales", the guide's path is Reports Hub → Sales → Sales → **Catering** tab. On the Reports Hub page there is a direct **Catering sales** link under the Sales heading. Both work. Give the short path.
  - In "Start a quote", step 3 says to pick the lead under **Pipeline lead**. The dropdown option text is long ("Hill Staffers Haiku R2 LLC · Hill Staffers Haiku R2 LLC · Fri, Oct 23 · P Street"). Say that you pick the line that matches the company and date.
  - The "Move a lead" section says the card closes after the move. It did close, but the column counts took a few seconds to update, so a note that the card can look stuck for a moment would help.

- **What is hard in the app for no reason:**
  - The quote's **Send quote** button first shows as disabled, then a password popup appears on the next screen state. I had to look twice. The guide does say "enter your password if it asks", but the popup is easy to miss.
  - A sent quote with no client shows the status **SENT** and the note "No customer is attached to this quote, so nothing was emailed". The status word says "sent" to the team, which is a trap if the client never got the price. The wording is good, but the status could say "not emailed" instead.
  - The catering hub cards are slow to open, and some taps reported a timeout while the page had in fact changed. I had to look again more than once before I trusted the screen. (This may be my test harness, but a GM on a tablet would see the same delay.)
  - Two places show catering sales (Reports Hub → Catering sales, and Sales → Catering tab). Pick one.

- **Steps that confused me even when the guide was right:**
  - Confirming a lead. The guide says the lead goes to Confirmed only if it has a quote with an event date under **Pipeline lead**. That worked, but the step is easy to skip, so the guide's warning in "Move a lead" is worth putting first.
  - The "Mark accepted" step only shows after the quote is sent. The guide says this. It is the right order, but I first looked for it on the draft.
  - Catering Insights: the page opens on a range, and I could not tell which range button was active from the text. The guide says the dark button is the range you see; I could not confirm which one was dark from text alone.

- **Anything that looked broken:**
  - Nothing crashed. The empty **Catering Customers** list after a sent quote looked broken to me, but it follows from having no client email (see Goal 6).
  - The Light Lunch Qty followed headcount, which the guide says it does not do (see above).
  - Nothing else looked broken.

## The 5 best things CO-OPS does for a restaurant
1. **Pipeline board with one-tap stage moves.** Each catering job is a card in columns (Inquiry → Quote sent → Confirmed …). One tap on **Move to Confirmed** put the job on the kitchen's plan. Why it matters: the whole team sees every job and what it needs without a phone call or a sticky note.
2. **Quote builder that prices the job as you type.** Adding Light Lunch at 25 people filled $300.00, then tax $30.00, total $330.00 and deposit due $82.50 without a calculator. Why it matters: a manager can price a job in minutes and quote it straight from the lead.
3. **Catering Insights money and calendar.** The page showed new leads, booked events, confirmed money ($330.00), win rate and a booked-day calendar. Why it matters: the manager knows what is booked and what money is coming, without a spreadsheet.
4. **Quick tablet login by shop, role, name and 4-digit PIN.** Four taps on the PIN logged me in with no button to press. Why it matters: a shared tablet can be picked up by whoever is on shift, and it is quick.
5. **Catering sales with ezCater reconciliation.** The Catering sales page counts ezCater orders as Matched in Toast, Not in Toast and Amount does not match, and shows the range. Why it matters: it catches ezCater orders that never reached the register, which is money lost if nobody checks.
