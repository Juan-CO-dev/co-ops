# C.43 — Mid-day Prep module · design spec

**Date:** 2026-06-13 · **Status:** design approved (Juan), pending spec review → implementation plan
**Amendment:** SPEC_AMENDMENTS.md C.43 (multi-instance numbered prep) · depends on C.18 (trigger paths), C.21 (L3+ trigger), C.44 (denormalized snapshot for prep completions)

---

## 1. Purpose & operational model

Mid-day prep is the **after-rush top-up**. The daily flow:

- Closing sheet → feeds the **morning** opening verification + prep.
- **Morning prep brings quantities *up to par*.**
- **Mid-day prep brings them *back up to par* after the lunch rush** depletes stock.
- It is **operationally emergent**: any L3+ cook triggers a fresh instance when they see depletion. **Multiple per day is normal** (#1, #2, #3…), numbered by `triggered_at`.

### Two-phase structure (mirrors the Opening Report)

Mid-day prep is a **two-phase mini opening-report** on the perishable subset:

- **Phase 1 — ground truth (single person):** one cook walks and counts what's on hand, establishing how much needs prepping to get **back to par**. A **lite AM-prep-style count form**, single-author, single-submit. Output = the per-item prep need (the "bring-back-to-par" deltas).
- **Phase 2 — the prep (anyone claims):** cooks prep the items; **anyone clocked-in claims items**. This is the **Opening Phase 2 engine** (`OpeningPrepEntry`, C.50/C.52) verbatim: per-item save, `saved_by`/`saved_at` attribution, multi-author, realtime-lite (reconcile on load), append-only revoke.

---

## 2. Reuse map (NOT greenfield)

| Concern | Reuse | Net-new |
|---|---|---|
| Phase 1 count form | AM Prep form pattern (`AmPrepForm`, `PrepRow`, `PrepSection`, section components, `lib/prep.ts` bring-to-par compute) — **lite** version (smaller item set) | A mid-day-specific lite form variant |
| Phase 2 collaborative prep | `OpeningPrepEntry` engine: per-item save route pattern, `saved_by` attribution, multi-author hydration, append-only revoke | Wiring it to mid-day instances |
| Multi-instance numbering | — | Schema: conditional UNIQUE + `triggered_at` disambiguation; numbered-label UI |
| Template discriminator | `checklist_templates` | `prep_subtype` column |
| Dashboard surface | dashboard tile pattern | Mid-day Prep tile (numbered list + "New" trigger) |

---

## 3. Architecture decisions (locked)

1. **Discriminator → `prep_subtype` column** on `checklist_templates` (`'am_prep' | 'mid_day_prep'`, nullable — only set when `type='prep'`). Keeps `type='prep'`; backfill existing prep rows → `'am_prep'`. (SPEC C.43 option 2, "cleanest"; lowest blast radius in an append-only DB.) `loadAmPrepState` filter becomes `type='prep' AND prep_subtype='am_prep'`. Live `type` CHECK is `('opening','prep','closing')` — unchanged; template UNIQUE `(location_id, type, name)` keeps AM vs Mid-day distinct by name.
2. **Multi-instance → conditional UNIQUE via denormalized instance flag** (SPEC C.43 option b, **refined after live-schema check**): the blanket constraint `checklist_instances_template_id_location_id_date_key` is a plain `UNIQUE (template_id, location_id, date)`. A partial index **cannot** key off the template's `prep_subtype` (cross-table; Postgres index predicates can't subquery). So: add `checklist_instances.allows_multiple_per_day boolean NOT NULL DEFAULT false`, set `true` at create for mid-day instances (derived from the template's `prep_subtype`); **drop** the blanket UNIQUE and replace with `CREATE UNIQUE INDEX … (template_id, location_id, date) WHERE NOT allows_multiple_per_day`. Single-per-day stays DB-enforced for everything except mid-day. `triggered_at` / `triggered_by_user_id` **already exist** (migration 0038) — disambiguate mid-day instances by `triggered_at`; no schema work for those.
3. **Phase split reuses the opening pattern:** Phase 1 single-author count (lite prep form) → Phase 2 collaborative per-item (`OpeningPrepEntry` model). Phase 1 output (per-item prep need) is the ground truth Phase 2 preps against — same as opening's Phase 1 → Phase 2 handoff. **The status lifecycle `open → phase1_complete → phase2_complete` already exists** (verified in the live `checklist_instances_status_check`) — mid-day reuses it verbatim: `phase1_complete` after the count, `phase2_complete` after prepping. **Next migration = 0059.**
4. **Bring-back-to-par computation** reuses the prep module's par-minus-on-hand logic (cook counts on-hand in Phase 1 → system shows top-up need).
5. **Denormalized snapshot (C.44):** prep completions carry `item_name_at_submission` / `par_at_submission` / `unit_at_submission` / `section_at_submission` so historical mid-day reports stay accurate when GM edits the template later.

---

## 4. Data flow

```
L3+ cook taps "New Mid-day Prep"
  → create mid-day instance (triggered_at = now, triggered_by_user_id = actor)
     [partial-unique index allows multiple/day]
  → Phase 1: one cook counts on-hand per item → submit → per-item prep-need ground truth frozen
  → Phase 2: any clocked-in cook claims + preps items → per-item save (saved_by/at) → multi-author
     → finalize when all items prepped (or instance closed)
  → Dashboard tile lists today's instances: "Mid-day Prep #2 (3:15 PM) — Phase 2, 4/9 prepped"
```

---

## 5. UI

- **Dashboard "Mid-day Prep" tile:** today's instances as a numbered list with time + phase/status; tap → open; **"+ New mid-day prep"** (L3+) triggers a fresh instance.
- **Phase 1 view:** lite count form (perishable items only).
- **Phase 2 view:** the `OpeningPrepEntry`-style collaborative grid with per-item save + attribution.
- i18n: new `mid_day_prep.*` namespace, en + es from day one (C.37). Section/item labels follow system-key-vs-display discipline (English match key + es translation).

---

## 6. Item list — CONFIRMED (mid-day-specific set, "added on")

These items are **counted + prepped only during mid-day prep** — a mid-day-specific template set, added on (not shared with the AM prep template). Confirmed complete by Juan:

- **Perishables:** pickles · sweet peppers · hot peppers · mozzarella (shredded) · mozzarella (fresh) · basil
- **Sauces (the 8 existing AM-prep sauces):** Aioli · HC Aioli · HP Mayo · Mustard Aioli · Horsey Mayo · Salsa Verde · Dukes · Vin

**Cranberry sauce — SEASONAL, deferred.** Add when in season; not part of v1. (The earlier "aioli → cranberry" range = these 8 sauces + the seasonal cranberry add.)

**Seed-time detail (not a design blocker):** par values + units for the net-new perishables (pickles, sweet/hot peppers, both mozzarellas are not in any existing template) + section grouping. Provide at build; the rest of the design doesn't depend on them.

---

## 7. Error handling & edge cases

- Phase 2 reuses opening's append-only revoke + per-item-save error/retry (already built).
- Save-on-connection-loss: per SPEC C.43 open-Q, **fail-fast with retry CTA** is acceptable for v1 (matches opening Phase 2).
- C.46 chain-edit vs multi-author: a post-submit correction creates a **new** completion row (`edit_count > 0`); the original `saved_by` row stays as audit trail (per SPEC C.43 Q7).
- Multiple concurrent "New mid-day prep" taps: partial-unique allows them; numbering by `triggered_at` keeps them distinct (no collision).

---

## 8. Out of scope (v1)

- GM+ admin editing UI for prep templates (C.44 — separate follow-up; data model accommodates it via the snapshot fields).
- Offline-save-queue (separate cross-cutting amendment).
- Mid-Shift *Report* (read surface) — distinct Wave 2 item; mid-day prep is the capture artifact it later reads.

---

## 9. Testing

- Lib: `loadMidDayPrepState` discriminator filter; conditional-unique allows N/day; bring-back-to-par compute.
- RLS: mid-day instance create gated L3+; Phase 2 per-item save by any clocked-in actor.
- Integration smoke: trigger #1 + #2 same day/location; Phase 1 single submit; Phase 2 two cooks claim different items; numbered labels render; denormalized snapshot persists.
- CI `next build` green; preview-URL smoke (not prod).

---

## 10. Open items to resolve before/at implementation

1. ✅ **Item list CONFIRMED** (§6). Remaining seed-time data: par values + units for the net-new perishables (provide at build, non-blocking). Cranberry = seasonal, deferred.
2. ✅ **Live schema verified (2026-06-14):** `triggered_at` + `triggered_by_user_id` exist (0038); two-phase statuses exist; blanket UNIQUE is `checklist_instances_template_id_location_id_date_key`; `type` CHECK = `('opening','prep','closing')`; next migration = 0059. Conditional-unique approach corrected to the denormalized `allows_multiple_per_day` flag (§3.2).
3. **Confirm** Phase 1 lite-form reuses `AmPrepForm` (adapted) vs a new thin form.
4. **Confirm** Phase 2 reuses `OpeningPrepEntry` directly vs a mid-day variant (item universe differs).
5. **Decide** Phase 1 author gate (any clocked-in cook counts, vs L3+) — instance *trigger* is L3+ (C.21); the Phase 1 counter may be anyone.
