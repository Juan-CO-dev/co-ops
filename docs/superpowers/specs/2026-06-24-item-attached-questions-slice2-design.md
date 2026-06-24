# Item-attached questions + item Opening-verify toggle — Slice 2 Design

**Date:** 2026-06-24
**Arc:** Item/Inventory Spine — per-line input types + non-inventory Q&A (Slice 2 of 3)
**Depends on:** Slice 1 shipped (#89 render foundation + #90 section questions). Branches off updated main.
**Status:** draft, pending review

---

## The arc

1. ✅ **Slice 1** — per-line input type + mixed render (#89) + section questions (#90).
2. **Slice 2 (this doc):** item-attached questions + the item "include in Opening verification" toggle.
3. **Slice 3:** questions as searchable report tags.

## Ships as TWO PRs (Juan-locked)

- **PR A — item-attached questions.** A non-inventory question defined *on an item*, propagating to every list where that item appears.
- **PR B — item Opening-verify toggle.** `items.opening_verify` makes today's hard-wired item→Opening mirror a controllable per-item setting.

Each is its own brainstorm-is-done → plan → build → PR. PR A first; PR B branches off updated main after A merges.

---

## PR A — item-attached questions

### Concept
An **item question** is a non-inventory prompt (Y/N / free-text / numeric) attached to a specific **item**, mirroring the section-question model (#90) but keyed to the item instead of the section. Defined once on the item (MoO+, tap-to-expand on the item's Global-tab row), it propagates to **every list where the item has an active line**, rendering in that item's section. Answers surface on reports via normal completions — so the question "rides the item onto its reports" for free. MoO+ only; the inventory `items` registry stays pure (a question is never an item).

### Storage (mirror section_questions)
- New `item_questions` table: `id, item_id (FK→items), label, label_es, input_type (CHECK in the 5 LineInputTypes), include_note, min_role_level (null), required, active, audit`. RLS deny-all.
- New `checklist_template_items.item_question_id` (nullable FK→item_questions). The propagated artifact is a normal line: `item_id` NULL (it's not the item's count line) + `item_question_id` set. (Distinct from `section_question_id` — a line carries at most one of the two question FKs, or neither.)
- **Migration 0088.**

### Propagation (mirror addSectionQuestion, keyed on the item's lines)
`addItemQuestion(actor, { itemId, label, labelEs, inputType, includeNote?, minRoleLevel, required })`:
- Validate item exists (active) + input type + label + min-role (optional, null OK).
- Insert the `item_questions` row.
- Propagate: find every active `checklist_template_items` line linking the item (`item_id = itemId`, active) on a **prep** template (am_prep + mid_day) — these are "where the item appears." For each such line's template, insert a question line (`item_id` NULL, `item_question_id` stamped, columns from input type, station = the item's line's section, `parValue/parUnit` NULL). Idempotent on `(template_id, item_question_id, active)`. **No Opening mirror** (questions aren't opening-verified this arc — Juan-locked; consistent with section questions).
- Display order: append (max+1) on the template, in the item's section. (Strict insert-after-the-item adjacency is deferred — same-section grouping is what matters; see Open Decisions.)
- Audit `item_question.create` with propagated line ids.

`disableItemQuestion(actor, { questionId })`: deactivate the question + all its propagated lines (append-only). Audit `item_question.disable`.

`loadItemQuestions(sb)` (or fold into `loadChecklistAdminView`): active item questions keyed by item_id for the Global-tab item rows.

### Routes
`POST /api/admin/checklist-templates/item-questions` (add) + `DELETE …/item-questions/[id]` (disable). MoO+ + Tier B step-up; mirror the section-questions routes exactly.

### UI
On the Global-tab item row (`RegistryRow`), a **tap-to-expand "Add a question"** affordance (same pattern as section questions / Add-global-item) + a list of the item's active questions with disable-confirm. EN+ES i18n.

### Render
No render change — item question lines are normal lines in the item's section, so Slice 1's per-line/mixed render already handles them.

---

## PR B — item Opening-verify toggle

### Concept
Today every am_prep item line gets an Opening Phase-2 mirror (createOpeningMirror, hard-wired). PR B makes it a per-item setting: `items.opening_verify` (boolean, **default true**). When false, the item's am_prep line gets no Opening mirror (not verified next morning); when flipped, mirrors are created/deactivated. **Default true + backfill all existing items true → zero behavior change on ship** (a true no-op until someone flips it).

### Storage
- `items.opening_verify boolean not null default true`; backfill existing rows true. **Migration 0089.**

### Wiring
- `createOpeningMirror` callsites (in `addPrepItem` + `ensureItemLineOnTemplate`) gate on the item's `opening_verify` — only create the mirror when true.
- `setItemOpeningVerify(actor, { itemId, openingVerify })` (MoO+): updates the flag; **propagates** — for every location where the item has an active am_prep line, create the Opening mirror (when turning on, if absent) or deactivate it (when turning off). Reuse `createOpeningMirror` / the mirror-deactivation path (`deactivateOpeningMirror` exists). Audit `item.set_opening_verify` (or reuse `item.update`).
- Route `PATCH …/registry/[itemId]/opening-verify` (MoO+ + Tier B). UI: a toggle on the item's Global-tab row (`RegistryRow`), like the `is_default` toggle.

### Safety
Default true + backfill true = current behavior preserved exactly. A parity check: every active am_prep item still has its Opening mirror after the migration (no mirror lost). Toggling is the only behavior change, and it's explicit.

---

## Authority
All of Slice 2 is **MoO+ (≥8)** — item questions are item-definition content; the Opening-verify toggle is an item-definition setting.

## Testing
`npx tsc --noEmit` + `npm run build` + throwaway tsx smokes (deleted before commit):
- **PR A:** `addItemQuestion` → a question line appears on every prep list where the item has a line (item_id NULL + item_question_id, correct columns, item's section), answerable; disable removes all. Opening mirror NOT created for the question.
- **PR B:** migration default-true backfill → every active am_prep item keeps its mirror (parity); toggling off deactivates the item's mirror, on re-creates it.

## Open decisions (your review)
- **D1 — Question adjacency.** *Recommend:* item question lines append to the item's section (end), not strictly inserted right after the item's line (display_order renumbering is fiddly). Same-section grouping is preserved. Flag if you want strict adjacency.
- **D2 — Item question on the Opening mirror?** *Recommend: no* — item questions propagate to the item's PREP lines only (not the Opening mirror), consistent with the locked "questions aren't opening-verified this arc." (When PR B's toggle is on, only the item's *count* mirrors, not its questions.)
- **D3 — One line, one question FK.** A line carries `section_question_id` XOR `item_question_id` XOR neither (a normal item/inventory line). No line is both. Confirm.

## Out of scope
- Questions verified in Opening (future — door left open).
- Searchable questions (Slice 3).
- Re-propagating an item's questions when the item is later enabled on a new list (future; the question propagates at create time to current lists).
