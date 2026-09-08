# CO-OPS user guides v1 — design (approved by Juan 2026-09-08)

## Goal
Three role-based guides to using CO-OPS, written for people who know sandwiches rather than
software, with screenshots from the sim sandbox and a "worth knowing" callout on every step.
English first; Spanish edition after Juan signs off on the English. Markdown in the repo now;
the in-app `/training` page (currently a stub) is the later home.

## Deliverables (one docs-only PR)
- `docs/guides/README.md` — audience map, voice sheet, step block, re-shoot procedure,
  pointer to `/training` as the future home.
- `docs/guides/staff-guide.md` · `manager-guide.md` · `catering-guide.md`
- `docs/guides/img/<guide>/<nn>-<slug>.png` — every screenshot, numbered in path order.
- `docs/guides/walks/<guide>.walk.md` — the walk script per lane (durable asset; re-run for
  the Spanish edition and after UI changes).
- `docs/guides/walks/<guide>.steplog.md` — the walker's step log (URL · action · what it saw ·
  screenshot · confusion), kept as sim-day-style signal.

## Voice and shape
- Opener: "your day at a glance" (two minutes), then one section per task in day order.
- Step block (fixed): **What you see** (screenshot) → **What to do** → **Worth knowing**
  (why the app asks · what happens downstream · common mistakes · when to stop and tell a manager).
- Staff guide has a dedicated "When to write a note" section.
- No internal jargon, code names, migration numbers, or agent talk. Stub pages (tips, training,
  announcements, comms) get one line: "coming soon".
- Screenshot widths: staff = phone (390×844); manager + catering = desktop (1280×800).

## Path scope
**Staff (employee, level 3):** tile+PIN login · dashboard · profile + language · opening
checklist items · AM prep · mid-day prep · closing items · deep cleaning · maintenance log ·
feedback + my-performance · when to write a note.

**Manager (key holder → GM):** confirm ceremonies (PIN) · receiving a delivery incl. the
short-item choice · counts · ordering walk + purchase orders · production capture · mid-shift
pulse · PM report + evals · cash deposit · reports hub + trends · admin console pages a GM
touches (users · templates · pars · vendors · SKUs · items · weights).

**Catering:** pipeline stages · quotes + label · customers + companies · insights · the
customer-facing `/order` funnel as the customer sees it · admin catering pages · what arrives
automatically (ezCater, Toast catering scan, inbox).

## Orchestration
Three lanes, one per guide. Each lane = sonnet **walker** → opus **writer**.
- Walker: logs in as the sim persona for the role, follows the lane's walk script in the sim
  browser (Playwright MCP, http://localhost:3100), saves screenshots to the repo path, returns
  the step log. Walkers run ONE AT A TIME (single shared browser session).
- Writer: step log + screenshots + repo read access → the guide. Must verify every behavioral
  claim against code, never against the walker's impression. Writers overlap the next walker.
- CC (orchestrator): owns README/voice sheet, step-log schema, walk scripts, naming; fact-checks
  each guide against code; re-clicks any doubted step; opens the PR and STOPS (auto-mode
  boundary — Juan merges).

## Preflight (CC)
1. Sim DB → 0195 lineage: apply 0185–0188, 0190–0192, 0195. SKIP 0193 (prod-manifest purge;
   its asserts would refuse or wipe sim catering rows). 0189/0194 already rehearsed on sim —
   verify they match final.
2. Boot sim (`node scripts/sim/dev-sim.mjs`, port 3100); smoke the tile login.
3. Confirm catering rows exist to photograph; seed a few if not.
4. Confirm Playwright screenshot writes to the repo path at the chosen viewport.

## Review
R1: opus writer + CC fact-check per guide (code-verified claims; live re-click on doubt).
PR opens; merge is Juan's.

## Out of scope (this round)
In-app `/training` page · video · customer-facing portal help · Spanish edition (next pass).
