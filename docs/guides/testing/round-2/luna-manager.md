<!-- tester codex/gpt-5.6-luna · session luna-manager-r2 -->
# Report — luna — manager guide
Model I am: GPT-5

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in | done | 8 |
| 2 | Take morning report | done | 3 |
| 3 | Open shop and complete morning work | partly | ~68 |
| 4 | Check in produce delivery | partly | 10 |
| 5 | Restore line to par | stuck | 0 |
| 6 | Check stations, delays, leave note | partly | 2 |
| 7 | Closing count | stuck | 0 |
| 8 | Night report | stuck | 0 |
| 9 | Cash report | stuck | 0 |
| 10 | Finish closing | stuck | 0 |
| 11 | Start full shelf count | stuck | 5 |
| 12 | Start vendor order | done | 4 |
| 13 | Find delivery in reports | stuck | 5 |

## Where I got stuck

- Goal 3 — `/operations/opening`, “Opening Report”: Phase 1 was completed, but Phase 2 required 38 separate prep entries. The guide says: “Part 2 has one row for every prep item, and every row needs a number.” This was accurate but did not explain that the report could require dozens of individual entries or how to finish efficiently.

- Goal 4 — `/operations/receiving`, “Receiving”: I selected PFG, entered Iceberg quantity/unit, marked it short, added a note, and attempted delivery confirmation. The form reset without recording a delivery. The guide says: “Tap one to see its lines, flags and credits,” but did not explain the required invoice fields or whether every delivery line must be counted before confirmation.

- Goal 5 — Dashboard, “Today’s Operations”: I did not reach Mid-day prep because the opening report remained unfinished.

- Goal 6 — `/mid-shift`, “Mid-shift Pulse”: several sections displayed “This section took too long. It will retry on the next refresh.” No handoff-note control was visible. The guide says: “A note on the Pulse for the next shift,” but did not say where to create one when the Handoff section has no edit control.

- Goals 7–10 — Dashboard, “Today’s Operations”: not reached because the opening report remained unfinished.

- Goal 11 — `/operations/counts`, loading screen: the Inventory Audit link opened the correct URL, but repeated looks continued to show “Loading…” indefinitely. The guide says: “In the dashboard, tap Inventory Audit,” but does not address this loading failure.

- Goal 13 — `/operations/receiving`, “Receiving”: no delivery was recorded, so Recent Deliveries was empty. The guide’s reports instruction depends on a completed delivery.

## Notes for the team
- What would make the guide better: Add required-field details and expected completion counts for receiving, opening prep, and inventory count. Explain where Handoff note editing appears.
- What is hard in the app for no reason: Long forms require many individual actions, and several pages take a long time to load.
- Steps that confused me even when the guide was right: The opening report’s station verification and prep-entry phases are separate, and “Take” is implicit when opening an unassigned task.
- Anything that looked broken: Mid-shift Pulse sections timed out; Inventory Audit stayed on “Loading…”; receiving reset without showing a successful-save message.

## The 5 best things CO-OPS does for a restaurant
1. The dashboard gathers assignments, reports, ordering, and closing in one place, helping managers see the day’s operational status immediately.
2. Opening verification records station checks and fridge temperatures, which supports food-safety accountability.
3. The ordering walk converts shelf quantities into a vendor draft purchase order, reducing manual ordering work.
4. Mid-Shift Pulse shows fridge temperatures, low-par items, vendor cutoffs, and operational risks in one live view.
5. Receiving provides vendor-specific SKUs with quantity, unit, and shortage flags, giving managers a structured way to record delivery problems.
