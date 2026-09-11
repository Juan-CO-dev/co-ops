# CO-OPS guides

Three guides, one per job. They are written for people who know sandwiches, not software.

Content updated as of 2026-09-11: ordering edits and add-ons, SKU data readiness, customer deposit wording, sign-out behavior and catering updates. Existing screenshots are retained; some show earlier screens.

| Guide | Who reads it |
|---|---|
| [Staff guide](staff-guide.md) | Anyone on the line (employee). Login, checklists, prep, notes, maintenance, feedback. |
| [Manager guide](manager-guide.md) | Key holders, shift leads, AGMs, the GM. Confirming, receiving, counts, ordering, reports, admin. |
| [Catering guide](catering-guide.md) | Whoever runs catering (AGM and up, or the catering manager). Pipeline, quotes, customers, the order funnel, setup. |

## Voice sheet (writers: follow exactly)

- The reader knows sandwiches, not software. Second person, present tense, short sentences.
- No internal jargon. No code names, table names, migration numbers, PR numbers, or agent talk.
- Every task section opens with one line of context ("You do this once a day, before the doors open."), then numbered steps.
- Every step uses the same block, in this order:
  - **What you see** — the screenshot.
  - **What to do** — the action, one or two sentences.
  - **Worth knowing** — why the app asks, what happens next, the common mistake, and when to stop and tell a manager. Skip a bullet if there is nothing to say; never pad.
- Stub pages (tips, training, announcements, comms) get one line: "Coming soon."
- Never describe behavior you did not verify in the code or on screen. If a step could not be photographed, say "not shown" and describe it in words.

## Screenshot conventions

- Staff guide: phone viewport 390×844. Manager and catering guides: desktop 1280×800.
- PNG, CSS scale. Path: `docs/guides/img/<guide>/<NN>-<slug>.png`, NN two digits in path order.
- Source: the sim sandbox (fake staff, fake data, fake names). Never production.

## Re-shoot procedure (the UI changed, or the Spanish edition)

1. Bring the sim database up to the current migration lineage (see the sim notes below). Boot the sim: `node scripts/sim/dev-sim.mjs` (port 3100).
2. Run the lane's walk script in `walks/<guide>.walk.md`, as a walker agent or a human, following `walks/_steplog-schema.md` for the log.
3. Replace the PNGs in place and keep the numbers. Update guide text only where the screen changed.
4. For the Spanish edition: switch the persona's language in their profile first, walk the same script, and save under `img/<guide>-es/`.

## Sim notes

- Personas, PINs, and locations live in `scripts/sim/personas.md`. Location codes are crossed in sim data: code EM is "P Street", code MEP is "Capitol Hill".
- The sim database is caught up to prod's lineage except migration 0193, which is a production-only data purge and is never applied to sim.

## Future home

The in-app `/training` page is a stub today. These guides are its planned content.
