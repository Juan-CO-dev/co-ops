<!-- tester codex/gpt-6-sol · session sol-manager-r1 -->
# Report — sol — manager guide
Model I am: GPT-6 via Codex

## Goals

| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in | done | ~13 |
| 2 | Take the morning report | done | ~6 |
| 3 | Open the shop | done | ~140 |
| 4 | Check in the short produce delivery | done | ~26 |
| 5 | Get the line back to par | partly | ~70 |
| 6 | Check coverage and leave a handoff note | done | ~12 |
| 7 | Count what is left | done | ~57 |
| 8 | Grade a person and pick MVP | done | ~18 |
| 9 | Record cash | done | ~12 |
| 10 | Finish closing | done | ~180 |
| 11 | Start a full shelf count | done | ~17 |
| 12 | Start an order for one vendor | done | ~15 |
| 13 | Find today’s delivery in reports | done | ~7 |

Actions are approximate and include screen looks. The shelf count was **started with one recorded line**, not completed across every shelf.

## Where I got stuck

**Goal 5 — Mid-day Prep, `/operations/mid-day?instance=55360b4f-724e-44f2-a8d8-340a14615e75`, “Phase 2 — prep.”** I counted all 17 rows, entered prep, and tapped Save on each. The last Chicken Cutlet save returned **“This instance isn't in the Phase 2 window”** while finalization was processing. Reopening showed a finalized report with static template text, so I could not verify that last row. The guide’s **“Mid-day prep”** section says, “In Phase 2, type what you made in **Prepped**. Tap **Finalize prep**.” It does not explain this save and finalize collision.

## Notes for the team

- What would make the guide better: Explain that a zero Inventory Audit quantity is rejected, and show how to find an item’s valid unit before submitting. Explain what to do if Mid-day Prep finalizes while a row is still saving.
- What is hard in the app for no reason: The audit accepted `each` for a shelf item, then rejected it only on submission. Reports Hub’s **Receiving** link opened the operational Receiving page rather than a distinct report.
- Steps that confused me even when the guide was right: Opening required 38 recounts because there was no prior closing data. Mid-day Prep needed a separate Save on every Phase 2 row.
- Anything that looked broken: Mid-day Prep’s last save failed while the report became finalized. The dashboard still said Boar’s Head ordering was “not started” after its draft appeared. The Pulse summary briefly said there were no handoff notes after my note was posted. This was a practice app with no physical stock, thermometer, drawer, or Toast figures to inspect; quantities, temperatures, and cash figures entered here were test values.

## The 5 best things CO-OPS does for a restaurant

1. **Closing checklist:** Tracked 61 jobs and required a final PIN; the next opener can see whether the shop was fully closed.
2. **Opening Report:** Joined station checks, fridge readings, recounts, and prep needs; the opener had one place to get service ready.
3. **Receiving:** Recorded a short delivery line and opened a vendor credit; managers have a record for resolving shortages.
4. **Mid-Shift Pulse and handoff:** Showed uncovered stations, low stock, and reports due, then posted a note for managers; the next shift can act on what needs attention.
5. **Ordering walk:** Turned a marked item into a Boar’s Head draft order; managers can review what to buy before contacting the vendor.
