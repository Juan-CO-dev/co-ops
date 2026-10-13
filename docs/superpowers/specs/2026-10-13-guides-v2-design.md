# Guides v2: one guide per audience, in shift order, tested by agents

Date: 2026-10-13. Owner: Juan (approval), CC (build lead). Status: design approved in chat, spec under review.

## Why

The current guides (docs/guides/staff-guide.md, manager-guide.md, catering-guide.md plus the dated
launch-<role>.<en|es>.md files) have four problems Juan called out:

1. The photos are from Sep 8 and no longer match the app.
2. They are too hard to read. Target: a 6th-grade reading level.
3. They use app words (par, AM prep, station, Pulse, ...) without ever explaining them.
4. The order of the day is wrong. The manager guide tells people to do AM prep in the morning, but AM prep
   is the closing count the opener reads the next morning (lib/opening.ts reads the prior-day AM-Prep
   submission as the baseline).

The rule over all of it: be true to what the app is and does.

## The real day (what the guides must follow)

- **Morning:** the **Opening Report**. Phase 1 (**Phase 1 · Verify**) is the *opening verification*:
  check each station against last night's count. Phase 2 (**Phase 2 — Prep Entry**) is the
  *opening prep*: make food up to par. On the shift board the task is called **Opening prep**.
  Submitting is a key holder's job. Opening is late after 10:30.
- **All day:** the closing checklist runs station by station all day (stations close as their sections
  finish). Deliveries get checked in. The Mid-Shift Pulse shows what is happening. **Mid-day prep** is
  done after the rush to get back to par (due from 2:00 PM, late after 3:30 PM).
- **Night:** most reports are closing reports, in this order: **AM prep** (count what is left so the
  morning crew knows what is there), the **PM report**, the **cash deposit**, then **confirm the
  closing**. Closing is late after 9:00 PM.

Every time and role named above gets re-checked against the code when the guides are written.

## Approach (option A, chosen)

Rewrite the three base guides in place. Each one is a single guide in shift order. The October 8 and
October 12 launch text is folded into the right place in the day, and the six launch-*.md files are
deleted. lib/guides/content.ts stops appending them and its tests are updated to match. This is the only
app code the project touches. The /training page keeps its current level gates: staff guide at trainee (2) and up, manager
guide at key holder (4) and up, catering guide at level 6 and up.

### Guide outlines

**Staff guide** (photos at phone size, 390×844)
1. Start here: what CO-OPS is, the app words list, logging in (location → role → name → PIN), the dashboard.
2. Morning: opening verification, then opening prep (submitting is a key holder's job).
3. All day: your board (**Tasks** / **Stations**), the closing checklist by station, the Mid-Shift Pulse,
   fridge temps and broken equipment, **End my shift**.
4. Night: finishing the closing checklist, plus only the closing jobs crew can actually open (checked in code).
5. Your stuff: profile, notes, log out.

**Manager guide** (photos at tablet size, 1024 wide)
1. Start here (same words and login).
2. Morning: opening verification, opening prep, submit.
3. All day: the Pulse (a GM or higher sees both shops), checking in deliveries, mid-day prep back to par,
   keeping the closing checklist moving.
4. Night: AM prep count → PM report → cash deposit → confirm the closing.
5. Manager tools: counts, ordering, production, the Reports Hub, sales and customers, basic admin.

**Catering guide** (photos at tablet size; setup/admin pages at desktop size)
1. Start here.
2. The catering hub, pipeline, quotes, ezCater orders that arrive on their own, customers and companies,
   insights, setup.

### App words (the "Start here" list)

Shop · Dashboard · Roles (key holder and the others) · PIN · Station · Position · My shift / board ·
Par · Opening verification · Opening prep · Prep · Mid-day prep · AM prep · Closing checklist ·
Walk-out · PM report · Cash deposit · Mid-Shift Pulse · Delivery / receiving · Count · Ordering walk ·
86 · Handoff note · Saved. Each word gets one plain line, in the order people meet them. Juan approved
the list on 2026-10-13, with "Opening verification" and "Opening prep" as the opening words.

## Writing rules

- 6th-grade reading level: short sentences, second person, one idea per step. Follow the existing voice
  sheet in docs/guides/README.md (no jargon, code names, PR numbers, env flags or agent talk).
- Every app word is defined in Start here before it is used. On-screen labels are **bold** and exact
  (en.json for English, es.json for Spanish).
- Spanish right after each English section, natural Latin-American restaurant Spanish.
- Never describe something switched off for users (the password vault, emailed digests or reports).
- No real names, emails or phone numbers. Sim personas only.

## Photos

- From the sim only (`node scripts/sim/dev-sim.mjs`, port 3100), never production. Fake names.
- Taken by scripted walks saved in docs/guides/walks/, so they can be retaken after app changes.
- Sizes: staff 390×844; manager and catering 1024 wide; catering setup/admin at desktop width.
- Old Sep 8 photos that are no longer used get deleted.

## Checks

1. **Code fact-check.** Every claim (label, role gate, time, behavior) is checked against the code by a
   reviewer agent that reports claim → file:line, the same method as the #456 review.
2. **Reading-level test.** A new test scores every English section with a standard readability
   formula (Flesch-Kincaid grade) and fails any section above grade 6. Headings, bold labels and
   lists of words are left out of the score. Spanish is read by a reviewer, not scored.
3. **Agent usability test.** See below.

## Agent usability test

The question: can someone use the app from the guide alone?

### Testers (12 models, each runs all 3 guides = 36 runs a round)

| Family | Models |
|---|---|
| Claude | Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1 |
| OpenAI (Codex) | Astra (gpt-6-astra), Sol (gpt-5.6), Terra (gpt-5.6-terra), Luna (gpt-5.6-luna) |
| GLM | GLM flash and the GLM flagship |
| DeepSeek | DeepSeek flash and the DeepSeek flagship |

Exact GLM and DeepSeek model IDs and the dispatch path for each family are pinned in the plan. If the
Haiku alias in a session still resolves to an older Haiku, the run waits for a session where it gives
Haiku 5.5, and the report names the model that actually ran.

### What a tester gets

- Only its guide (markdown) and the photos it links. No code, no other docs.
- A browser on the sim, opened at the login screen. It logs in through the normal tile screens as a sim
  persona at the guide's role, using test PINs from the sim persona files.
- A list of goals, said the way a person would say them, with no button names. Example: "You're opening
  P Street. Check last night's closing and get prep going."
- Rules: move around by tapping and typing in fields, like a person. No typing web addresses except the
  start page.
- Every model family uses the same small browser helper (look at the screen, tap a label, type, go back),
  so the comparison is fair and each run has its own browser. The plan builds this helper.

### What a tester reports

Per goal:
- done or stuck;
- where it got stuck (the screen and what it tried);
- the guide sentence that misled it or was missing.

Plus free notes:
- what could be better;
- what is hard for no reason;
- screens or steps that confused it even though the guide was right.

The notes split into two lists: **guide fixes** (we make them) and **app ideas** (they go to Juan; nothing
in the app changes in this project).

### Reading the results

- A goal that Opus 5.5, Fable 5.1 or Astra fails means the guide is wrong or missing something.
- A goal that only the smaller models fail means the wording is too hard.
- **Pass bar:** Haiku 5.5 and both flash models finish every core goal.

### Keeping runs apart

- Staff runs at P Street, manager runs at Capitol Hill, catering runs in catering.
- One model at a time (its three guide runs together), and the sim is reset to a fresh morning between
  models. The plan finds or builds the reset step.

### Rounds

Fix the guides, then rerun only the goals that failed. Up to 3 rounds. Anything still failing goes to Juan
with the tester notes.

## Build order

1. Write the three guides (en + es) and the app words list.
2. Take the photos with the walk scripts.
3. Code fact-check.
4. Reading-level test.
5. Agent usability rounds.
6. One PR: the guides, the photos, the walk scripts, the reading-level test, the tester helper, the
   removal of the launch files (plus the loader change), and the tester report (stored under
   docs/guides/testing/).

## Out of scope

- Any app change beyond the launch-file loader in lib/guides/content.ts, including tester ideas. Those go
  to Juan as a list.
- Turning on the vault or emailed reports.
- Changing who can open /training.
