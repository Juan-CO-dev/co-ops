# CO-OPS User Guides v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three role-based CO-OPS guides (staff · manager · catering) with sim-sandbox screenshots and per-step "worth knowing" callouts, as a docs-only PR on branch `docs/user-guides-v1`.

**Architecture:** CC does preflight (sim DB catch-up, sim boot, screenshot plumbing) and authors the shared contract (README voice sheet, step-log schema, three walk scripts). Then three lanes run, each = sonnet walker (drives the sim in the Playwright MCP browser, saves shots, returns a step log) → opus writer (turns step log + code verification into the guide). Walkers are serial (one shared browser); writers overlap the next walker. CC fact-checks every guide against code and opens the PR; Juan merges.

**Tech Stack:** Next.js app on sim Supabase (`jepgzucrvklhqpthowsc`, port 3100 via `scripts/sim/dev-sim.mjs`) · Playwright MCP (`mcp__plugin_playwright_playwright__*`) · Supabase MCP for migrations · markdown + PNG.

Spec: `docs/superpowers/specs/2026-09-08-user-guides-design.md`.

---

## File structure

| Path | Responsibility | Author |
|---|---|---|
| `docs/guides/README.md` | audience map · voice sheet · step block · screenshot conventions · re-shoot procedure · `/training` pointer | CC |
| `docs/guides/walks/_steplog-schema.md` | the exact step-log block every walker emits | CC |
| `docs/guides/walks/staff.walk.md` · `manager.walk.md` · `catering.walk.md` | ordered goals per lane (persona, viewport, what to photograph) | CC |
| `docs/guides/walks/staff.steplog.md` · `manager.steplog.md` · `catering.steplog.md` | walker output | walkers |
| `docs/guides/img/staff/NN-slug.png` etc. | screenshots | walkers |
| `docs/guides/staff-guide.md` · `manager-guide.md` · `catering-guide.md` | the guides | writers |

Sim personas (from `scripts/sim/personas.md`; PINs are sim-only): **Maya Torres** employee, P Street, PIN 1111 · **Rosa Delgado** key holder, P Street, PIN 4444, pw `sim-rosa-pw` · **Marcus Webb** GM both shops, PIN 9999, pw `sim-marcus-pw`. Location codes are crossed in sim data: code EM = "P Street", MEP = "Capitol Hill".

---

### Task 0: Sim DB catch-up to lineage 0195 (CC)

**Files:** none in repo. Sim project `jepgzucrvklhqpthowsc`.

- [ ] **Step 1: Confirm the gap.** `list_migrations` on the sim project. Expected: last entries `sim_catchup_0177_0184`, `0189_..._SIM_REHEARSAL`, `0194_..._SIM_REHEARSAL`.
- [ ] **Step 2: Diff the rehearsed 0189 and 0194 against the final files.** `git log --oneline -- supabase/migrations/0189_*.sql supabase/migrations/0194_*.sql`. If either changed after its rehearsal date (2026-09-01 / 2026-09-05) and the diff is schema-affecting, apply the delta by hand as a `_SIM_FIXUP` migration.
- [ ] **Step 3: Apply, in order, with `apply_migration` named `<nnnn>_<slug>_SIM`:** 0185, 0186, 0187, 0188, 0190, 0191, 0192, 0195. Read each file first; if any references prod-only objects (cron jobs, vault secrets), strip that block and suffix the name `_SIM_TRIMMED`. **Skip 0193** (prod-manifest purge; its asserts refuse on sim).
- [ ] **Step 4: Verify.** `list_migrations` shows the eight new entries. `execute_sql`: columns of `catering_insights_v2` / `toast_catering_orders` exist.

### Task 1: Boot sim + plumbing smoke (CC)

- [ ] **Step 1: Boot.** `cd ~/co-ops && node scripts/sim/dev-sim.mjs` in the background. Expected stdout: `Local: http://localhost:3100`.
- [ ] **Step 2: Data check.** `execute_sql` on sim: counts of active users, catering pipeline leads, quotes, vendors, SKUs. Need ≥1 lead in a non-terminal stage and ≥1 quote; if zero, the catering walker's first goal creates them.
- [ ] **Step 3: Screenshot plumbing.** Playwright MCP: resize 390×844 → navigate `http://localhost:3100` → screenshot with `filename` = `C:/Users/conta/co-ops/docs/guides/img/_smoke.png`, `scale: css`. Confirm the file exists. If absolute paths are refused, find the MCP output dir from the tool result and record a copy step in README §Conventions. Delete `_smoke.png` after.
- [ ] **Step 4: Login smoke.** Tile login as Maya (PIN 1111) → dashboard renders; snapshot shows the nav chips. Note the exact chip labels for the walk scripts. Log out.

### Task 2: Shared contract — README, step-log schema, walk scripts (CC)

**Files:** Create `docs/guides/README.md`, `docs/guides/walks/_steplog-schema.md`, `docs/guides/walks/{staff,manager,catering}.walk.md`.

- [ ] **Step 1: README.md** — sections: Who reads what · Voice sheet · Screenshot conventions · Re-shoot procedure · Future home. Voice sheet rules: reader knows sandwiches not software; second person, present tense, short sentences; no code names / table names / migration or PR numbers / agent talk; each task section opens with one context line then numbered steps; fixed step block **What you see** (screenshot) · **What to do** · **Worth knowing** (why the app asks · what happens next · common mistake · when to stop and tell a manager); stub pages one line "coming soon"; never describe unverified behavior. Conventions: staff 390×844, manager + catering 1280×800, CSS scale, PNG, `docs/guides/img/<guide>/<NN>-<slug>.png`, sim only. Re-shoot: catch sim DB up → boot sim → run the lane's walk script → replace PNGs in place, keep numbers → update text only where the screen changed. Future home: the `/training` stub.

- [ ] **Step 2: `_steplog-schema.md`:**

```markdown
# Step-log schema (walkers emit exactly this, one block per screenshot)

## Step NN — <slug>
- URL: <path after the host>
- Persona / viewport: <name, role> / <WxH>
- Action: <what you clicked or typed, one line>
- Saw: <what the screen showed after the action — headline text, buttons, any message>
- Shot: img/<guide>/NN-<slug>.png
- Confused: <optional — anything you re-read, guessed at, or could not find>
- Bug?: <optional — error text, dead control, wrong data>

Rules: number in walk order; one shot per step; a goal with several screens = several steps.
Never skip a goal silently — write `BLOCKED <goal>: <why>` as a step with no shot.
```

- [ ] **Step 3: `staff.walk.md`** (Maya Torres · employee · P Street · PIN 1111 · 390×844):

```markdown
# Staff walk — Maya Torres (employee, P Street, PIN 1111), phone 390×844
Goals in order. Photograph every distinct screen, and the state AFTER each meaningful action.
1. LOGIN: open http://localhost:3100 → tile login (your name) → PIN. Shots: tiles, PIN pad, dashboard.
2. DASHBOARD TOUR: the home screen top to bottom (fullPage shot too). Identify the nav chips and today's tiles.
3. PROFILE + LANGUAGE: open your profile/settings; show where language is switched (do NOT switch). Shot.
4. OPENING CHECKLIST: open today's opening for P Street; work 3–4 items (a temp, a yes/no, one you mark
   not-done with a reason). Shots: list, an item open, the not-done reason, the list after.
5. AM PREP: open AM prep; enter plausible amounts for 3 items; submit. Shots: sheet, filled row, after submit.
6. MID-DAY PREP: open mid-day prep; fill phase 1 for 2 items. Shots: before, after.
7. CLOSING CHECKLIST: open closing; tick 2 items; leave one with a note. Shots.
8. DEEP CLEANING: open the deep-cleaning page; show a task and how it is marked. Shot.
9. MAINTENANCE LOG: open maintenance; log one issue ("slicer guard loose"). Shots: form, after.
10. FEEDBACK + MY PERFORMANCE: open /feedback (submit one line) and /my-feedback; open the profile
    performance view if present. Shots.
11. NOTES: wherever the app offered a note/comment field in goals 4–9, record in the step log WHERE
    it appeared and what the placeholder said. (The writer builds "when to write a note" from this.)
12. STUBS: open /tips, /training, /announcements, /comms — one shot each.
13. LOG OUT. Shot of the tiles again.
```

- [ ] **Step 4: `manager.walk.md`** (Marcus Webb · GM · PIN 9999 · pw `sim-marcus-pw` · 1280×800):

```markdown
# Manager walk — Marcus Webb (GM, PIN 9999, pw sim-marcus-pw), desktop 1280×800
Work P Street unless a goal says otherwise. Photograph every distinct screen + the state after each action.
1. LOGIN as Marcus; dashboard tour as a manager (what extra tiles/chips appear vs staff). Shots.
2. CONFIRM OPENING: open today's opening; finish any open items; run the confirm ceremony (PIN/password
   when asked). Shots: pre-confirm, the ceremony prompt, post-confirm state. If the GM path skips the
   ceremony, log out and repeat as Rosa Delgado (key holder, PIN 4444).
3. RECEIVING: operations → receiving → log a delivery from any produce vendor; receive most expected
   items, leave ONE short; at completion read the options for the short item and pick one. Shots:
   vendor pick, line entry, the short-item prompt, the finished receipt.
4. COUNTS: operations → counts; start a count; enter 3–4 on-hand values; submit. Shots.
5. ORDERING WALK: /ordering; walk the guide; adjust 2 quantities; create the draft order. Shots: walk
   list, an adjusted line, the draft/PO summary.
6. PRODUCTION CAPTURE: operations → production; record one batch. Shots.
7. MID-SHIFT PULSE: /mid-shift; read it; do whatever action it offers (note or check). Shots.
8. PM REPORT: /pm-report; write the wrap-up; grade two crew members. Shots: form, evals, submitted.
9. CASH DEPOSIT: /cash; enter a plausible deposit; submit. Shots.
10. REPORTS: /reports hub; open today's opening report; /reports/trends and /reports/trends/team. Shots.
11. ADMIN CONSOLE: /admin home, then /admin/users, /admin/checklist-templates/opening (open one item),
    /admin/pars, /admin/vendors (open one), /admin/skus, /admin/items, /admin/weights. One shot each,
    no edits except: add ONE user (fake name, employee role) and show the result.
12. SETTINGS + LOG OUT. Shots.
```

- [ ] **Step 5: `catering.walk.md`** (Marcus · GM · 1280×800; the customer funnel is logged-out):

```markdown
# Catering walk — Marcus Webb (GM, PIN 9999), desktop 1280×800
1. LOGIN as Marcus → /catering. Shot of the hub.
2. PIPELINE: /catering/pipeline; shot the board; open one lead; move it one stage forward; add a note.
   Shots: board, lead detail, stage change, note. If the board is EMPTY, create a lead first
   (fake company "Hill Staffers LLC", 25 people, next Friday).
3. QUOTES: /catering/quotes; open or create a quote for that lead (2 packages + 1 à-la-carte); mark
   sent if offered; open the /catering/quotes/<id>/label page. Shots: list, builder, totals, label.
4. CUSTOMERS + COMPANIES: /catering/customers and /catering/companies; open one of each. Shots.
5. INSIGHTS: /catering/insights — full-page shot; note what the money split says.
6. CUSTOMER FUNNEL (log out first, new tab): /order → /order/start → /order/build → /order/review →
   /order/verify (STOP at the verification step; do NOT submit anything that sends an email) →
   /order/account. Shots of each. Then log back in as Marcus and check whether the funnel lead
   appeared on the pipeline. Shot.
7. ADMIN CATERING: /admin/catering, then menu, packages, pricing, rate-rules, zones, fulfillment,
   capacity, faq, lto, prep-demand. One shot each, no edits.
8. AUTOMATIC ARRIVALS: on /catering/pipeline, look for any lead marked as coming from ezCater or Toast
   (source badge). Shot if present; if absent, write ABSENT in the step log.
9. LOG OUT.
```

- [ ] **Step 6: Commit.** `git add docs/guides && git commit -m "docs(guides): README, step-log schema, walk scripts"`.

### Task 3: Lane 1 walker — staff (sonnet, foreground)

- [ ] **Step 1: Dispatch** `Agent` (model `sonnet`) with this context packet:

```
TASK: You are a CO-OPS documentation walker. Play Maya Torres (employee, P Street, PIN 1111) on the
sim app at http://localhost:3100 using the Playwright MCP tools. Follow docs/guides/walks/staff.walk.md
goal by goal. For every distinct screen take a screenshot (browser_take_screenshot, scale css, png,
filename = C:/Users/conta/co-ops/docs/guides/img/staff/NN-slug.png) and append a step block to
docs/guides/walks/staff.steplog.md following docs/guides/walks/_steplog-schema.md EXACTLY.
Viewport: browser_resize 390 844 FIRST. Good = every goal has shots + a step block, confusion recorded.
CONSTRAINTS: stay in character (you know sandwiches, not software). Do not read app source. Never
visit /admin. Never navigate off localhost:3100. Invent plausible sub-shop values when asked (temps,
counts). 3-try rule: after three honest attempts, write BLOCKED and move on. Do not edit any file
other than the steplog. Do not commit.
INLINE CONTEXT: sim location "P Street" (code EM). Tile login = tap your name, enter PIN. Nav chips
on the dashboard route you to opening/closing/prep pages; operations pages are under their tiles.
DEEPER CONTEXT: docs/guides/walks/staff.walk.md · docs/guides/walks/_steplog-schema.md ·
scripts/sim/handbook.md (ground rules).
Report back: the count of steps, list of BLOCKED goals, and the three most confusing moments.
```

- [ ] **Step 2: Review** `docs/guides/walks/staff.steplog.md` and `ls docs/guides/img/staff`. Every walk goal has ≥1 shot; numbering contiguous; no shot is a blank/error page unless the step says so. Spot-open 3 PNGs with Read. If a goal is BLOCKED for app reasons, note it for the guide ("not shown") and for a CHIEF bugs capture.
- [ ] **Step 3: Commit** `git add docs/guides/img/staff docs/guides/walks/staff.steplog.md && git commit -m "docs(guides): staff walk shots + step log"`.

### Task 4: Lane 1 writer — staff (opus, background) ∥ Lane 2 walker — manager (sonnet, foreground)

- [ ] **Step 1: Dispatch writer** `Agent` (model `opus`, `run_in_background: true`):

```
TASK: Write docs/guides/staff-guide.md for CO-OPS from docs/guides/walks/staff.steplog.md and the
screenshots in docs/guides/img/staff/. Follow docs/guides/README.md voice sheet and step block
EXACTLY. Structure: "Your day at a glance" (≤200 words) → sections in day order: Logging in ·
Your dashboard · Opening checklist · AM prep · Mid-day prep · Closing checklist · Deep cleaning ·
Maintenance log · Feedback & your performance · When to write a note · Profile & language ·
Coming soon. Each step = image (relative path img/staff/NN-slug.png) + What to do + Worth knowing.
Good = a second-month employee can do a full shift from this alone.
CONSTRAINTS: every behavioral claim in "Worth knowing" (what happens after submit, who sees it,
whether it can be edited later, what marking not-done does) MUST be verified by reading the code:
lib/checklists.ts, lib/checklist-answers.ts, app/(authed)/operations/*, lib/prep*.ts,
lib/maintenance*.ts, lib/feedback*.ts. If you cannot verify a claim, do not make it.
No jargon, no code names, no PR/migration numbers. Do not edit other files. Do not commit.
DEEPER CONTEXT: AGENTS.md (product overview only) · docs/ROADMAP.md (stub pages list).
Report back: section list, any claims you could NOT verify (list them), any screenshot you judged
unusable and why.
```

- [ ] **Step 2: Dispatch manager walker** `Agent` (model `sonnet`, foreground) — same packet shape as Task 3 with: persona Marcus Webb (GM, PIN 9999, pw sim-marcus-pw), walk `docs/guides/walks/manager.walk.md`, steplog `manager.steplog.md`, images `docs/guides/img/manager/`, viewport 1280×800, `/admin` ALLOWED for goal 11 only.
- [ ] **Step 3: Review** both outputs: walker as Task 3 Step 2; writer: guide has all 12 sections, every image path resolves (`grep -o 'img/staff/[^)]*' docs/guides/staff-guide.md | sort -u | while read p; do test -f docs/guides/$p || echo MISSING $p; done` prints nothing), no forbidden words (`grep -niE "migration|PR #|supabase|lib/|\.ts\b" docs/guides/staff-guide.md` prints nothing).
- [ ] **Step 4: Commit** `git add docs/guides/staff-guide.md docs/guides/img/manager docs/guides/walks/manager.steplog.md && git commit -m "docs(guides): staff guide draft + manager walk"`.

### Task 5: Lane 2 writer — manager (opus, background) ∥ Lane 3 walker — catering (sonnet, foreground)

- [ ] **Step 1: Dispatch writer** as Task 4 Step 1 with: source `manager.steplog.md` + `img/manager/`; sections: Your day at a glance · Logging in as a manager · Confirming opening & closing · Receiving a delivery · Counts · Ordering & purchase orders · Production capture · Mid-shift pulse · PM report & evaluations · Cash deposit · Reports & trends · Admin console (users · templates · pars · vendors · SKUs · items · weights) · Settings. Verification files: lib/checklists.ts · lib/receiving*.ts · lib/counts*.ts · lib/ordering*.ts + lib/po*.ts · lib/production*.ts · lib/pm-report*.ts · lib/cash*.ts · lib/reports*.ts · app/admin/*. Add constraint: "Receiving short-item options and count submission consequences must quote the real option labels from code."
- [ ] **Step 2: Dispatch catering walker** as Task 3 with walk `catering.walk.md`, Marcus, 1280×800, `/admin/catering/*` allowed for goal 7, funnel goal 6 logged out in a fresh tab. Add: "At /order/verify STOP before any submit that would send an email."
- [ ] **Step 3: Review** both as before (image-resolve + forbidden-word greps on `manager-guide.md`).
- [ ] **Step 4: Commit** `git add docs/guides/manager-guide.md docs/guides/img/catering docs/guides/walks/catering.steplog.md && git commit -m "docs(guides): manager guide draft + catering walk"`.

### Task 6: Lane 3 writer — catering (opus, foreground)

- [ ] **Step 1: Dispatch writer** as Task 4 Step 1 with: source `catering.steplog.md` + `img/catering/`; sections: Catering at a glance · The pipeline (stages, what moves a lead) · Quotes & the label · Customers & companies · Insights (confirmed vs completed money) · What the customer sees (the order funnel) · Setting up catering (admin pages) · What arrives on its own (ezCater · Toast · the inbox) · Coming soon. Verification files: lib/catering/pipeline.ts · lib/catering/quotes*.ts · lib/catering/insights*.ts · lib/portal/* · lib/ezcater/* · lib/toast/* · app/admin/catering/*. Add: "The automatic-arrival section must state only what the code does today (ezCater → lead; Toast catering scan → lead; the inbox digest is NOT built — say 'coming soon')."
- [ ] **Step 2: Review** as before on `catering-guide.md`.
- [ ] **Step 3: Commit** `git add docs/guides/catering-guide.md && git commit -m "docs(guides): catering guide draft"`.

### Task 7: CC fact-check pass (all three)

- [ ] **Step 1:** For each guide, read every "Worth knowing" line; for each behavioral claim, open the cited code area and confirm. Keep an untracked scratch list `.scratch/guides-factcheck.md`: guide · step · claim · verdict · fix.
- [ ] **Step 2:** For any claim I doubt and cannot settle from code, re-click it in the sim browser myself.
- [ ] **Step 3:** Apply fixes; re-run the image-resolve + forbidden-word greps on all three.
- [ ] **Step 4:** Update `docs/ROADMAP.md`'s `/training` stub line: "(guides written 2026-09-08 in docs/guides/ — pending in-app surfacing)". Commit `docs(guides): fact-check fixes + roadmap pointer`.

### Task 8: PR and stop

- [ ] **Step 1:** `git push -u origin docs/user-guides-v1`.
- [ ] **Step 2:** `gh pr create` — title "docs: CO-OPS user guides v1 (staff · manager · catering)"; body: what, screenshot source = sim, spec + plan paths, BLOCKED goals / not-shown steps, Spanish edition = next pass; generated-with footer.
- [ ] **Step 3:** STOP. Merge is Juan's (auto-mode boundary). Stop the sim server.
- [ ] **Step 4:** Memory: write `project_coops_user_guides_arc.md` (state, PR #, next = Spanish pass + `/training` surfacing) and index it in MEMORY.md.
