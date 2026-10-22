# Crew-first scheduling — design

Status: design approved by Juan in chat 2026-10-22 (approach #1, auto-apply improvements); spec awaiting his read.
Extends `2026-10-15-smart-scheduling-design.md` §5.7 (every rule is tunable) and §6 (the scheduler).

## 1. Why

Juan compared a real P Street week from 7shifts (Sun 10-18 – Sat 10-24) with the CO-OPS draft for the same days. They're built in opposite ways.

**How the real week is built**
- **Shift types:** every shift is one of three:
  - Opener: 7–8 AM → 4 PM
  - Mid: 10–11 AM → 8:30 PM
  - PM closer: 4 → 8:30 PM
- **Crew size:** 7–8 people a day, almost all on whole 8–9.5 h shifts. Only the PM closer is short.
- **Stations are loose:** most people are tagged "3rd Party" and cover what's busy. The shop doesn't have enough people to staff every station, and works around it.

**What the CO-OPS generator does today** (station-first: `templates-shared.ts` → `fillRun` in `assign-shared.ts`)
- **It fragments shifts:** it tries to fill every station for every hour, and when people run out it cuts the remaining runs into 4 h pieces:
  - Henry 9:30–2 instead of 7:30–4
  - Islam 11:30–3:30
  - two people 5–9 PM on the same Friday
- **Crew size swings from 5 to 11 a day:** each station reacts on its own; nothing sizes the crew as a whole.
- **Leftover budget sits next to gaps:** the budget isn't what blocks coverage. The station runs simply never become whole shifts.

Tuning the existing settings can't fix this, because the unit of work is wrong. Real scheduling starts from **people and shift types**, then puts people on stations inside their shifts.

## 2. Goals and non-goals

**Goals**
1. **Regenerate looks like the real week:** a crew of whole shifts drawn from a few shift types, sized per day.
2. **Every regenerate improves on people's usual week**, in a stated order of priorities (§5.3), and lists what it changed.
3. **Nothing is hard-coded (Juan, 2026-10-22):** every number, time, count, priority and limit below is a per-shop setting. P Street's values are seed data only. Capitol Hill must be configurable without code changes.
4. **No fragments:** when people are short, the board shows a **short** station or an **open** shift. It never cuts shifts into scraps.

**Non-goals (for now)**
- Writing schedules to 7shifts (still the §8 loop of the 10-15 spec).
- Sales forecasting changes. The scheduler keeps using today's demand-by-hour data (`demand-shared.ts`).
- Employee-side shift swaps or requests.

## 3. Principles

- **Crew first, stations second:** decide who works which whole shift, then assign stations inside shifts.
- **Usual is the baseline:** a person's usual shift on their usual days is the default answer. Deviations need a reason, and that reason is shown.
- **Settings, not code:** every tunable lives in the shop's Schedule structure or the person's settings, has a default, is validated on save, and shows "Settings changed — regenerate?" when edited (10-15 §5.7).
- **Existing rules still hold:**
  - Days they work (0281)
  - positions and works-as (0280)
  - MoD rules (incl. `keyHolderModAfterQ`)
  - salaried minimums
  - budget ceiling
  - pins, manual edits and past days kept
  - the schedule rules validator (§6.5 of the 10-15 spec)

## 4. Settings (data model)

### 4.1 Shift types — per shop, in the Schedule structure

These live in a new `shiftTypes` array in the structure jsonb, saved via `save_schedule_structure` and validated in `structureProblem`. The structure is jsonb, so no table change is needed.

| Field | Meaning | P Street seed |
|---|---|---|
| `id`, `name` | e.g. `opener` / "Opener" | Opener · Mid · PM closer |
| `fromQ`, `toQ` | normal times (quarter-hours) | 30–64 · 40–82 · 64–82 |
| `startFlexQ` | how far a person's own start may differ (earlier or later) without counting as a change | 4 (1 h) · 4 · 0 |
| `minLengthQ` | shortest this shift may be trimmed to | 24 (6 h) · 20 (5 h) · 16 (4 h) |
| `headcount` | per day type (`slow` / `normal` / `busy` / `weekend`, the existing `CrewType`) | Opener 3/3/3/3 · Mid 3/3/4/4 · PM closer 1/1/1/1 |
| `stations` | ordered position ids this shift usually covers | Opener: Prep, Crunchy Boi, Prep/Dishwasher · Mid: Register & Delivery, Expeditor, 3rd Party, Walk-ins/Online · PM closer: Prep/Dishwasher, Prep |
| `countsTowardMod` | whether people on this shift can carry MoD (still subject to role rules) | yes · yes · no |

Day type is still decided the way it is today (forecast thresholds plus the manager's per-day override). Friday and Saturday get the bigger crew by being `busy` / `weekend` days. There is no separate per-weekday table.

### 4.2 Usual shift — per person, per shop

New nullable column `schedule_person_settings.usual_shift jsonb`, migration **0282** in the 0280/0281 house style:
- an immutable validator plus a CHECK
- the save RPC gains `p_usual_shift jsonb default null`
- merge carries it forward
- service_role-only grants
- ROLLOUT/ROLLBACK header

Shape: `{ "typeId": "opener", "fromQ"?: 30, "toQ"?: 64 }`.
- `fromQ`/`toQ` are the person's own times (both or neither). They must stay inside the shift type's `startFlexQ` window, or the editor warns.
- **Days come from "Days they work"** (0281 availability), not from `usual_shift`. Works = usual day; if needed = fill-in day; off = never.
- **null = guess from Toast punches (§6).** A guessed usual shift is shown as a hint, and the manager can confirm or change it.

### 4.3 Improve-pass settings — per shop, in the Schedule structure

New `improve` object in the structure jsonb:

| Field | Meaning | Default |
|---|---|---|
| `enabled` | run step 3 at all | true |
| `priorities` | ordered list of the score terms in §5.3; the manager can reorder | `["coverage", "paid_hours", "demand_fit", "budget", "stability"]` |
| `maxStartMoveQ` | most a start or end may move from usual in one week | 4 (1 h) |
| `allowDropShift` / `allowAddShift` | may drop a usual shift on a slow day / add one on a busy day | true / true |
| `maxChangesPerPerson` | changes from usual per person per week before a further change must clearly beat the cost of reshuffling them | 2 |

### 4.4 Engine switch — per shop

`engine: "stations" | "crew"` in the structure. Default `"stations"` (today's engine) until Juan flips P Street to `"crew"` after seeing it on sim. Removing the old engine is a later decision.

## 5. What Regenerate does (crew engine)

It runs per built day (today and later; past days are inherited as now). Pins and manual edits are fixed inputs.

### 5.1 Step 1: lay down usual shifts
For each person with a usual shift (set or guessed) whose Days they work say **works** on that date, and who has no time off: place their usual shift at their own times, clipped to their availability window.

### 5.2 Step 2: fill to headcount
For each shift type, compare the placed count with `headcount[dayType]`. When short, pick candidates in this order:
1. People whose usual type matches, on their **if needed** days.
2. Anyone whose positions fit the shift type's `stations`, who is available and under their soft max, ranked by today's rank key (position rank, then under-minimum, then skill).
3. Manager cover, last, with the reason stated (existing `coverWithManager` rules).

When still short, the board shows an **open shift**: type, times and the reason nobody fit. It is never split into pieces.

When a type is over headcount (too many usual shifts on a slow day), the improve pass (5.3) may drop one if `allowDropShift`. Step 2 never drops anyone.

**Salaried people** keep their existing MoD block placement (40 h target and flex), now snapped to their usual shift type's times.

### 5.3 Step 3: make it better (auto-apply, Juan chose "A")
This is a local search over small moves, each kept only if the week's score improves:
- move a start or end by 15–60 min (within `maxStartMoveQ`)
- trim a shift toward `minLengthQ` on a slow stretch
- extend a shift to cover a gap or reach a person's hours target
- swap two people's shifts on a day
- drop a shift (`allowDropShift`) or add one (`allowAddShift`)

The score compares weeks term by term in `improve.priorities` order. A better value on an earlier term always wins (lexicographic), so the order is fully tunable.

| Term | What it measures |
|---|---|
| `coverage` | every hour has an MoD (existing MoD rules) and the shift types' minimum crew; fewer short stations at the shop's priority stations |
| `paid_hours` | salaried at their target (40 h + flex), full-timers at `full_time_min_h`, everyone else at or above soft min — before anyone else gets extra hours |
| `demand_fit` | crew on the floor per hour vs the existing demand curve (more at rush, fewer when slow) |
| `budget` | under the week's budget ceiling. Leftover budget is never a reason to leave a gap |
| `stability` | number of changes from usual, weighted by `maxChangesPerPerson` |

It must be deterministic: the same inputs give the same week (fixed move order; ties break by user id, as the generator does today).

### 5.4 Stations inside shifts
After the crew is final, for each quarter-hour: assign people on the floor to the open stations in each person's position order (primary → secondary → works-as → cover), following the existing one-person-per-position and primary/secondary pair rules. A station that's open and has nobody is marked **short** for that stretch. Shifts are never changed to fix a short station; that is step 3's job, through the score.

### 5.5 Output
- shifts with segments (as today, so the board and the 7shifts export keep working)
- open shifts and short stretches
- a **Changed from usual** list, one line per change with its reason, e.g. "Olivia ends 3 PM Tue — slow afternoon (demand fit)"

## 6. Guessing usual shifts from Toast
This reuses `punchPatterns` / `assumedAvailability` (`people-input-shared.ts`): for each person, take their typical punch-in and punch-out over the history window, and match them to the nearest shift type (by overlap). Their own times are the median punch times rounded to 15 min.
- **Not enough history:** no guess. The person shows "Set usual shift" and is only used in step 2.
- **Manager-set values always win** over the guess.

## 7. Screens

- **Schedule settings → Shift types:** a list of cards. Each card holds:
  - name
  - times
  - start flex
  - minimum length
  - headcount per day type (4 small number fields)
  - stations (ordered picker)
  - MoD toggle

  Add, remove and reorder. Mobile-first: 44 px targets, no horizontal scroll at 375 px. i18n en + es.
- **Schedule settings → Improve:** the on/off switch, the priorities as a reorderable list, and the three limits.
- **People → Usual shift:** sits next to Days they work. Pick a shift type, with optional own times, a "Guessed from Toast" hint, and "Use the guess" to clear it.
- **Board:**
  - **open shifts** at the top of each day
  - **short** stretches on the station rows
  - a **Changed from usual** panel, where Undo pins that person's usual shift for that day and regenerates the day

## 8. Phases

**Phase 1: crew without the improve pass**
- migration 0282 (`usual_shift`) — sim, then prod on Juan's word
- `shiftTypes` and `engine` in the structure, with validators and the settings screen
- People → Usual shift, plus the Toast guess
- crew engine steps 1, 2 and 5.4 (stations inside shifts, short, open shifts)
- P Street seed values (§4.1) saved through `save_schedule_structure` with an audit row, on Juan's word

**Phase 2: improve pass**
- `improve` settings and their screen
- step 3 (5.3) with the score
- the Changed from usual panel with Undo

### Acceptance (P Street, sim with prod-shaped data, week of 10-19)
Phase 1 is accepted when Regenerate gives:
- 7–8 people per day
- no shift shorter than its type's `minLengthQ`
- Henry 7:30–4 Tue–Sat
- Daniela 4–8:30 Thu–Mon and never Tue/Wed
- Josselin on Tue/Wed PM
- Santos/Veronica only Sat/Sun (Fri only if short)
- Tio Mon–Fri
- an MoD every hour from open to close
- J within salaried target + flex
- nobody on an Off day
- no shift for anyone no longer employed

Phase 2 is additionally accepted when:
- each change in the list has a reason that matches a score term
- reordering priorities changes the result in the expected direction (test fixtures)
- the same inputs give the same week

### Tests
- unit tests per step (fixtures, no DB)
- a pglite harness for 0282 like 0281's
- a P Street fixture test reproducing the acceptance list above
- determinism test (generate twice, diff empty)

## 9. Rollout and safety
- **Build process:** Astra builds; an independent Opus review on every build; CC gates.
- **Migrations:** sim first, prod only on Juan's word.
- **Engine switch** defaults to the old engine, so merging Phase 1 changes nothing until P Street is flipped.
- **Seed values** (shift types for P Street) are a prod write and need Juan's OK.
- **Data cleanup before acceptance** (separate from the build): end Quinn's employment (no longer with us); Miguel is gone too (he was never in CO-OPS).
- Close-out time: today's structure ends shifts at 9 PM; the real close is 8:30. The PM closer and Mid seed times use 8:30, and the shop's `outLatestQ` needs to match. This is a structure change on Juan's word.

## 10. Open items
- Is Lucas Standridge still working at P Street? (He has no shifts in the real week.)
- Catering prep days: should catering add an extra shift on top of headcount (today's `catering` need source), or count toward an existing type? Proposed default: it adds an Opener-type shift on catering days, as a setting.
- Overtime threshold interplay with `paid_hours` when someone's usual week already exceeds 40 h.
