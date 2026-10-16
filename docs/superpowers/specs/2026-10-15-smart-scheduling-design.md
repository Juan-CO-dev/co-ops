# Smart scheduling + the people layer — design

**Status:** design approved by Juan in conversation, 2026-10-15 (one question at a time). This is the lead's INITIAL PLAN. Builders (CO CC / Astra) write the build plans per phase; CC gates.
**Mockup:** https://claude.ai/artifact/C4hnVLkQCzVSjDxhSpnCmd (sample data; Capitol Hill's real stations and positions).
**API research:** 7shifts public API, checked 2026-10-15 (developers.7shifts.com). Facts used here are summarised in §2.

## 1. What we are building and why

Managers build schedules by hand in 7shifts today. CO-OPS already knows the inputs a good schedule needs:
- when each shop is busy (Toast, hourly);
- how much prep and production the day needs;
- which stations are open and when they close or trim;
- who did what work, and how well.

**This project makes CO-OPS the staffing brain while 7shifts stays the employee-facing schedule.** CO-OPS proposes the week. The manager adjusts it on a visual board where every number and every reason is in view. CO-OPS then sends the result to 7shifts as a draft, and the manager publishes it there.

It also unifies everything people- and labor-related into ONE people layer (§4). Performance, PM reports, station work and scheduling all read and write the same facts. There is never a second way to judge a person.

### Goals
- **Easy for managers.** A finished proposal is waiting each week, with plain reasons for every choice.
- **Keep labor down without losing sales or good people.** Spend the hours budget where the house needs it, balance overtime, and give newer people slots beside strong ones.
- **Respect how people plan their lives.** Preferred days, an untouchable day off, a flex day, start and end times, and leader open/close settings.
- **Every scheduling decision explains itself to the manager.** (Juan: "all scheduling reasoning should surface to managers.")

### Non-goals (for now)
- Replacing 7shifts' employee app, swaps, time-off approval or notifications.
- Publishing schedules from CO-OPS. 7shifts has no public publish endpoint, so the manager taps Publish in 7shifts.
- Payroll.

## 2. 7shifts: what the API allows

Company access token from Developer Tools; no partner approval needed. Rate limits: 10 req/s and 600/min.

**Read:**
- shifts, including `station_id`, role, department and draft/published state;
- users, assignments and wages;
- availabilities (recurring and week-specific);
- time off;
- time punches;
- labor settings (overtime rules);
- the daily sales and labor report.

**Write:**
- DRAFT shifts: create, update and delete, with `draft=true`, person, role, `station_id` and notes;
- availability and time off on an employee's behalf;
- sales forecast overrides, daily or by 15-min / 1-h interval.

**Not available:**
- **Publishing.** The manager does it in 7shifts.
- **Validation.** 7shifts does not check overtime, availability or eligibility through the API, so CO-OPS validates everything before it writes.
- **Idempotency keys.** CO-OPS reconciles by stable ids and never blindly re-sends.
- **A sandbox.** Live reads are real data.

**Webhooks:** `schedule.published` needs the Premium plan. We believe CO is on Pro, so CO-OPS polls instead.

## 3. Who owns what

| Area | Owner |
|---|---|
| Demand forecast (Toast + catering + prep), staffing need per position and hour | CO-OPS |
| Skills, team strength, performance (the people layer) | CO-OPS |
| Proposed assignments, hours budget, overtime balancing, reasons, staffing recommendations | CO-OPS |
| Employee identity, availability capture, time off, swaps | 7shifts (CO-OPS reads it, and also writes availability from its own picker) |
| Published schedule + notifications to staff | 7shifts |

## 4. The people layer (one source of truth)

### 4.1 One profile per person, accumulated from real work
A person's profile is the accumulation of everything they do. It reads from facts that are already captured:
- **Station staffing intervals**, append-only (0217/0219): who was at which station, and when.
- **Task assignment + completion attribution** (0228), including higher-assigner overrides.
- **Prep batches** (0215 `made_by`, yield vs the recipe) and productions.
- **Checklist completions**, with timing: on-time against the station's close and trim.
- **Toast-linked clock-ins** (0233 Who's here) and Toast hourly sales during their shifts.
- **PM report evaluations** (§4.3).

From these it produces a **skill per position**, for every position the person has worked, with the evidence behind it ("made 18 batches this month, yield on target 94%"). The skills are LEARNED from data. A manager can apply an override per position, recorded and shown as a "manager adjustment". New hires start from the manager's rating until there is enough data.

### 4.2 Performance and scheduling share it
"My performance" and team scoring (`lib/team-scoring`, `lib/team-metrics`, `lib/people-narrative`) and the scheduler all read this one layer. Once people are scheduled, performance is also judged against the schedule: on time to THEIR shift, results at THEIR station.

### 4.3 PM reports v2
- **A copy per manager on shift.** Each manager fills in their own copy. Nobody sees another manager's copy until the closing manager SUBMITS the day's report at close.
- **Per-station evaluations.** For each person, the copy lists the stations they actually worked that day, from station events. Each station has dropdown criteria that are specific to that position (e.g. Expeditor: ticket accuracy, pace, communication; Prep: on time, yield, cleanliness), plus a free-text box.
- **After submit:**
  - The copies stay **side by side, attributed**.
  - Scores are **averaged** per person × station × criterion, weighted by how long each manager observed that station.
  - **Write-ins** that aren't in the dropdowns are surfaced, and recurring themes are pulled forward.
- The averaged scores feed §4.1, so they reach My Performance, station skills and team strength.

## 5. Inputs from staff and managers

### 5.1 Availability, picked in CO-OPS or in 7shifts (synced both ways)
- **Preferred days.**
- **Two days off:**
  - One is **UNTOUCHABLE**. It is never scheduled; an open shift may only be *offered*, and the person can take it or ignore it.
  - The other is the **FLEX day**, which the person chooses. The scheduler uses it only as a last resort or to save someone overtime: at most once every 2 weeks per person, rotated fairly, labelled "flex day", and it may be a SHORT shift (~4 h, e.g. just open or just close).
- **Personal timing**, e.g. "can't start before 10", "out by 3 on Tuesdays". These are valued constraints; a later-in or early-off shift is a tool the scheduler uses, and the reason says so.
- **Sync:** CO-OPS writes 7shifts availability, and CO-OPS polls 7shifts for changes made there. On a conflict the newest change wins and the manager sees a note.

### 5.2 Hours budget, set by the manager
- The manager sets the shop's weekly HOURLY labor-hours budget. It can be set per month and split into weeks.
- CO-OPS suggests a change each week, with reasons, from everything it knows: forecast sales, catering on the books, prep load, seasonality, events. Example: "next week looks 12% busier — suggest +18 h". The manager accepts or adjusts.
- The budget is the labor-vs-revenue lever. Per-person targets are not the main control.

### 5.3 Leader open / close settings
- Each leader has a setting: Opens only · Closes only · Mix.
- Leaders are Key Holder, Shift Lead, AGM, GM, Manager of Operations and Owner. Not CGS, the app admin.
- **Defaults:** AGM, GM and Shift Lead = Opens only; Key Holder = Closes only; MoO and Owner = Mix.
- It is a hard constraint for the scheduler. A manager edit that breaks it is flagged with the reason.

### 5.4 Presence of the MoO / Owner
A per-day toggle: "Cristian in today", "Pete in today". When present, they add coverage at $0 to the hourly budget.

### 5.5 Work types (per employee)
- **BOH (back of house):** two positions — **Prep** (pure prep: mostly slicing and portioning) and **Prep/Dishwasher** (prep plus dishes). Dishwashing is never a standalone position. Some people are BOH-only.
- **FOH (front of house):** the line stations, plus some prep.
- **Management** (GM, AGM, Shift Lead, MoO, Owner): can cover ANY station and/or prep, to save hourly hours or fill gaps (salaried cover first, §6.3).

The scheduler only places a person in positions their work type allows, and the manager can widen it per person. **Prep/Dishwasher** is needed through the day and especially at close.

### 5.6 The day's anchor times (set per shop by the manager)
- **Prep starts** at 7:00 AM.
- **The prep/dishwasher** arrives next. On slow days the morning may be ONLY prep/dish, unless demand says otherwise.
- **Service starts** at 10:30 AM. Line arrivals come in three waves:
  1. a **setup crew** before service, to set up the line;
  2. arrivals **at service start**;
  3. **rush reinforcements** right before the busy hours (from the demand curve).
- **Service closes** at a set time (8:00 PM at CO).
- **Everyone out** within a MIN–MAX window (e.g. 8:30–9:00 PM, never past the max). The closing checklist runs from service close and must finish inside the window. A close projected past the max is flagged.
- **BOH staffing by day type:**
  - **Slow days:** only ONE Prep/Dishwasher. A second is added only when expected demand needs it, and the reason says so.
  - **Weekends:** BOTH (Prep + Prep/Dishwasher) until about 5 PM, then only the Prep/Dishwasher through close.

### 5.7 Schedule structure settings — every rule is tunable (Juan, 2026-10-15)
"So the system can actually build schedules we want and fix the structure within those business constraints."

Nothing structural is hard-coded. Each shop has a **Schedule structure** settings area that the manager edits; the scheduler builds strictly within it.
- **Shop day** (§5.6): prep start, Prep/Dishwasher arrival, service start, service close, everyone-out window.
- **Day types:** what makes a day slow, normal or busy (forecast thresholds, with a per-day manager override), and which days are the weekend.
- **Crews per day type** (an editable table):
  - the opening crew;
  - BOH staffing (e.g. slow = 1 Prep/Dishwasher; weekend = both until ~5 PM);
  - the line arrival waves (setup / at service / rush: counts and times);
  - the closing crew (Register/Delivery count, Walk-ins count, Prep/Dishwasher).
- **Station hours and head counts:** each station position's open, trim and close times and how many people it needs (e.g. Register & Delivery 2 until the 4 PM trim, 1 after).
- **Leadership:**
  - manager on duty required every hour (on/off);
  - which roles can carry the Closing Manager role;
  - leader open/close defaults by role (§5.3).
- **Managers' time:**
  - Salaried GM/AGM have a **minimum on-the-clock per day**, tunable per position (default 8 h). This is a hard constraint, separate from the floor cap.
  - When a manager isn't needed at a station, their time is **"Manager on duty"**; two managers can both be on duty. Managers have manager work, but **service comes first**: they drop into a station only when coverage needs them.
  - **Preferred cover positions per manager** (Shift Lead and up, tunable per person): an ordered list, e.g. Expeditor → Register & Delivery → Prep. When coverage is short, the scheduler pulls a manager into their preferred positions in order. It uses other positions only as a last resort, and the reason says so.
  - **The board never double-covers a position:** no manager on a station another person already covers.
- **Positions:**
  - **One person per position** at a time (default head count 1, tunable). When a station closes or trims, that person moves to another open position or clocks out. Two people never fill the same position at the same time; e.g. two walk-in closers fill Walk-ins and Walk-ins / Online.
  - **Position priority per station** (a toggle):
    - Prep → **Prep/Dishwasher** is primary over Prep;
    - Expo → **Register & Delivery** is primary over Expeditor;
    - Walk-ins → **Walk-ins / Online** is primary over Walk-ins.

    When a station needs only one person, the primary is filled. The secondary is filled only when demand needs a second person. At a trim, the secondary goes first. This applies to build, regenerate, call-out fill and trims.
  - **Allowed roles per position** (tunable). E.g. Prep/Dishwasher = Employee (optionally Key Holder) and **never a manager** except as a call-out last resort, with the reason stated.
- **Limits:**
  - **minimum shift length** (default 4 h; the flex-day short shift is a separate tunable exception);
  - manager floor-time cap (station coverage, a subset of their time on the clock);
  - overtime threshold (defaults from 7shifts labor settings);
  - flex-day rules (frequency, max length);
  - closing checklist duration (measured from real completion timestamps, with a manager override).

Any change shows "Settings changed — regenerate?". The rebuilt week stays inside the new rules, and every reason cites the rule it followed ("Busy Thursday → 2 Walk-ins at close (Closing crew rule)").

### 5.8 Planning horizon (Juan, 2026-10-16)
- The manager can build **next week, the next two weeks, the next N weeks, or the rest of the month / a whole month** in one go. Partial weeks at a month's edge are handled: "rest of October" builds from tomorrow through the 31st.
- The automatic Wednesday proposal still covers next week. A longer horizon is built on request and shows a confidence note for the later weeks (forecast is weaker further out).
- Weeks already built are not overwritten silently: rebuilding a range that includes an edited week asks first and shows "What changed" per week.
- The hours budget (§5.2) is set per week or per month split into weeks, and the horizon uses each week's budget.

## 6. The scheduler

### 6.1 When it runs
- **Automatically:** the proposal for the next week is ready every Wednesday morning.
- **Regenerate:** the manager can rebuild whenever settings change. Changing a setting prompts "regenerate?"; it never regenerates silently. Each regenerate shows a "What changed" summary.

### 6.2 What it builds
- **Shift SHAPES from demand,** not fixed templates. It uses the busy curve, prep load, catering and closer needs, and respects people's timing. The manager approves or tweaks the shapes.
- **Station close-down and trim times dictate the build:**
  - At Capitol Hill (Juan, corrected 2026-10-16): Crunchy Boi closes 2 PM, **3rd Party trims around 4 PM**, Register & Delivery trims 4 PM, and **Walk-ins / Online runs ALL DAY** (open to close, it never trims). Every open / trim / close time is a per-shop SETTING, not a constant.
  - A position segment ends exactly there; the person then moves to the next needed position or clocks out.
  - Closers' shifts run to shop close PLUS the closing checklist's real duration.
- **MULTI-POSITION SHIFTS.** A shift is one block per person (clock-in → clock-out) split into ordered position segments. The proposal suggests the segments; the crew works out actual positions on the day. Coverage counts each segment toward its position, and also shows who else on shift could cover it.
- **Hours split inside the budget: skill-weighted with guardrails.**
  - The busiest and hardest slots go to the strongest person for that position; the rest is spread fairly.
  - Each person's soft range is respected, and full-timers keep their minimums.
  - Newer people get deliberate slots next to a strong person.
  - Overtime is avoided. If unavoidable, it is shown with its reason and cost.
- **Team strength** per day and per window (open / lunch rush / afternoon / close), computed from the skills of who is on the clock for what. The scheduler uses it to pair people; the board shows it ("Close: thin — both closers newer").
- **Salaried managers (GM, AGM) cover positions at no cost to the hourly budget,** within a floor-time limit per week. The board shows the hourly hours they save.
- **The closing crew:** slow days = 1 Register/Delivery + 1 Walk-ins + 1 Prep/Dishwasher; busy days = 1 Register/Delivery + 2 Walk-ins + 1 Prep/Dishwasher. **Closing Manager is a ROLE carried by one of the closers** (the Register/Delivery or a Walk-ins person, Key Holder or above), not an extra head. Register & Delivery keeps one person through close; its 4 PM trim drops the extra help.
- **Manager on duty:** at every hour someone Shift Lead or above is the manager on duty; the board highlights them and flags any hour without one.
- **Role rules:** e.g. Closing Manager requires Key Holder or above. Rules come from the role ladder (`lib/roles.ts`) and the station positions (`station_positions`).

### 6.3 Call-outs: "Out" (any reason)
- **Input:** "Out…" for today only or N days. It is "Out", never "Out sick" (Juan, 2026-10-16): a person can be out for any reason.
- **The confirm pop-up** asks for the reason from a dropdown (Sick · Family · Emergency · Personal · Transportation · No-show · Other) plus an optional write-in. "Other" requires the write-in. The reasons list is a setting. The reason is visible to managers only, and it feeds the call-out pressure in §6.4.
- The scheduler regenerates ONLY from today forward within the absence, and never touches days already passed.
- Everyone else's existing shifts (hours and shapes) stay as they are. It only FILLS the absent person's shifts:
  1. salaried management floor time FIRST (no added hourly cost; within the floor limit and the manager's open/close setting);
  2. then the best available hourly person (free in that window, no new overtime where avoidable, flex day as last resort and short).
- Anything that can't be filled is a named gap. Every fill has a reason. Undo is available.

### 6.4 Staffing recommendations, with the math
- **Hiring law:** the company HIRES only Employees, or an AGM/GM. Every middle rung (Trainer, Key Holder, Shift Lead) is filled by PROMOTION.
- So the panel recommends:
  1. **promote** a named person, with the reason from the people layer, e.g. "Promote Tess to Key Holder — closed alongside Dani 9 times, Walk-ins on time 94%, 6 h under her soft max";
  2. then **hire an Employee to backfill** her hours where needed;
  3. an AGM/GM hire ONLY when the managers' floor load is the problem.
- It **always shows the math:** hours/week, sample cost, what it removes (gaps, overtime, flex uses, manager floor hours). Call-out pressure is included, e.g. "3 sick calls this month covered by managers for 11 floor h; one more Employee at 20 h/week ≈ $380/week would free them".
- It reacts live as the manager edits.

### 6.6 The labor-target card (Juan, 2026-10-16)
An info card on the board, per day and per shift window, showing **the optimal number of people and hours that keeps great service without going over the labor target (default 28% of forecast sales; a per-shop setting).** The math, shown on the card:
- **Max hourly labor $ = forecast sales × target %** (minus salaried cost when the target is total labor %).
- **Max hours = max labor $ ÷ blended average wage** (from the people layer).
- **Optimal heads per window** = those hours spread across the demand curve with the minimum crew per open position (§5.7) as the floor.
- It shows the current draft against it ("Lunch: 5 on, optimal 4–5 · Close: 3 on, optimal 3") and turns amber when a window is over target or under its minimum crew.

### 6.5 Schedule rules validator (non-negotiable)
One pure `checkScheduleRules(schedule, structure)` validator runs on every generated, regenerated, call-out-filled and manager-edited schedule, and in the test suite. It checks:
- no person is double-booked;
- no position is over its head count in any 15-minute slot;
- every shift is at least the minimum length (or meets the flex exception);
- each position is filled only by its allowed roles (managers on BOH only as a call-out last resort);
- segments sit inside each position's open–trim–close window;
- the Closing Manager role is carried by an allowed role;
- a manager is on duty every hour when required;
- salaried minimums are met.

A generated schedule that fails is a bug: the generator must not emit it. A manager edit that fails is shown on the board with the rule it breaks.

## 7. The board (manager surface)

A fast 2D interactive board, not three.js; three.js only if a moment truly needs it. It works on a phone first. Per shop, per week:
- **Live strip:**
  - hourly hours used vs budget;
  - hourly labor $ and % of forecast;
  - salaried (fixed) cost;
  - TOTAL labor %;
  - OT risk;
  - flex days used;
  - manager floor hours.
- **The budget suggestion** with Accept / Keep.
- **Day tabs.** Past days are locked.
- **The day timeline:**
  - the demand curve, with labor % BY HOUR under each column;
  - team strength per window;
  - per-position coverage (red gap / amber extra / green covered / grey closed);
  - person rows with multi-segment shift bars: drag the bar, its edges, or the dividers between segments, in 15-min snaps.
- **Leader shifts settings**, the MoO/Owner presence toggles, and **Add to schedule** (add anyone, MoO/Owner included, to a day with a block and the positions they can flex across).
- **Manager on duty** lane and markers.
- **Reason panel:** why this person, this shape, this segment, this budget, this flex use; their skill profile; who else could cover.
- **The staffing recommendation panel** (§6.4).
- **Out…** (reason dropdown + write-in, §6.3). *Out (§6.3) is Phase 3* (§9; CC ruling 2026-10-16): Phase 2 ships no Out control.
- **Send to 7shifts as draft.**

Every string is in English and Spanish, per house law.

## 8. The 7shifts loop

### 8.0 Real people before 7shifts access: Toast first, then three-way verification (Juan, 2026-10-16)
- **Until the 7shifts token exists,** Toast is the source of who really works: Toast time entries (0224, nightly) give who clocked in, when, and at which job; Toast employees are already linked to CO-OPS users (the employee-links review list). The scheduler's people and their real hours/patterns come from there.
- **Once 7shifts is connected,** every person is checked THREE ways: the CO-OPS user account (the anchor), the Toast employee link, and the 7shifts user link. Both external links hang off the CO-OPS user; nothing links by name alone.
- **A reconciliation view** shows each person with three ticks (CO-OPS · Toast · 7shifts) and flags any mismatch: someone clocking in on Toast with no CO-OPS user, a 7shifts user not linked, a scheduled shift with no matching punch, a punch with no shift. Toast stays the BACKUP source of actual hours if 7shifts punches are missing or disagree.


- **Read sync (poll):** users and assignments, roles and stations, availability, time off, published shifts (after the manager publishes, CO-OPS pulls the final version), time punches, wages, labor settings.
- **Write:** the reviewed proposal is sent as DRAFT shifts with `station_id` and notes (the position segments go in notes when 7shifts can only hold one station per shift). Writes are reconciled by stable ids; a shift the manager changed in 7shifts is never overwritten without resolving the conflict.
- **Forecast:** CO-OPS sends its hourly sales forecast as 7shifts interval overrides, which also improves 7shifts' own labor tools.
- **Mapping:** CO-OPS stations ↔ 7shifts roles/stations, per shop. Setup is a one-time mapping screen.

## 9. Phases (Juan approved this order, 2026-10-15)

1. **Foundation:**
   - the 7shifts read sync (§8 read);
   - the unified people layer (§4.1–4.2) with skills learned from data + manager adjustment;
   - PM reports v2 (§4.3).
   - Useful on day one: better performance views, and real data accumulating.
2. **Scheduler + board:**
   - hours budget + weekly suggestion (§5.2);
   - shapes from demand and trims, multi-position shifts, team strength, leader settings, presence (§5.3–5.4, §6.1–6.2);
   - the Wednesday draft + Regenerate, and the multi-week / month planning horizon (§5.8);
   - the labor-target card (§6.6);
   - Toast as the interim people source + the three-way reconciliation view (§8.0);
   - the live board (§7).
3. **The loop:**
   - the push to 7shifts (§8 write) + forecast overrides;
   - two-way availability sync with the CO-OPS picker (§5.1);
   - "Out" call-outs with reasons (§6.3);
   - promote-first staffing recommendations with the math (§6.4).

Each phase gets its own build plan, written by the builder, reviewed by the other model family, and gated by CC.

## 10. Open items to settle in the build plans
- Exact criteria per position for PM reports v2 (draft a list; Juan or the managers confirm).
- Manager floor-time limit per week (sample 32 h).
- The closing checklist duration per shop (measure it from completion timestamps).
- How the 7shifts role/station mapping handles our multi-segment shifts (notes vs splitting into consecutive draft shifts). Decide after a read-only look at CO's 7shifts setup.
- Confirm the 7shifts plan tier (Pro assumed).

## 11. Later phases (Juan, 2026-10-16) — recorded, not yet scheduled
- **Demand anticipation hub:** a manager page that gathers the outside signals (weather, Toast sales velocity, known holidays / events / shutdowns, the Congress calendar, road closures and races like 5Ks from DC permits, traffic, news), with AI insights over it. It feeds ordering pars, prep pars and labor "pars" on top of the shop and catering depletion already used. Rule: each signal must show, on past data, that it improves the forecast before it gets a vote. First step: write up exactly how depletion and dynamic pars are computed today so Juan can examine and refine it.
- **True menu-item cost:** labor and packaging become part of each menu item's cost — the sub wrapper, side containers, catering boxes as recipe lines; the carry-out bag allocated per order (average items per order); labor allocated per item.
