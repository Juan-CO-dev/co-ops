# Closing/Opening question input types — design (PR-2 of the checklist full-edit arc)

> Council-derived (report `.claude/council/2026-07-30-checklist-fulledit/report.md`,
> D2 adjudication + locked guardrail). Brings yes/no and free-text QUESTION lines to
> the closing/opening template builder — "Walk-in temp OK?", "Any incidents to
> note?" — authored in the builder, answered on the operator form, rendered in
> reports. Numeric already exists (the expects_count path) and is untouched.

## The honest-storage ruling (D2, final)

The council locked: **the line records its input type explicitly — rendering and
validation never infer meaning from column overloading.** Storage:

| Input type | Authoring | Answer storage | Answered = |
|---|---|---|---|
| tick (legacy NULL) | default | completion row presence | row exists |
| numeric | expects_count (existing, unchanged) | count_value | non-null count |
| **yes_no** | `input_type='yes_no'` | **count_value 1/0** | count_value ∈ {0,1} — NO is a recorded answer, distinct from unanswered |
| **free_text** | `input_type='free_text'` | **notes** | non-empty trimmed notes |

Why count_value 1/0 is honest and not a silent overload: closing/opening templates
VERSION on publish (new item rows per version, verified `select("*")` copy at
template-builder.ts:794), so a completion's `template_item_id` immutably pins the
`input_type` it was answered under. The type is recorded adjacent to the value,
forever. No new completion columns; opus's lean option, adopted.

## Migration 0165 (`0165_line_input_type.sql`, drafted; apply-first to prod)

`checklist_template_items.input_type text null` + three named CHECKs:
valid values ('yes_no'|'free_text') · NOT with expects_count (a line is a count
line or a question line, never both) · NOT with prep_meta (prep speaks
prep_meta.columns — two vocabularies never coexist on one line).

## Cuts

### 1. Column plumbing
`TEMPLATE_ITEM_COLUMNS` + `TemplateItemRow` + `rowToTemplateItem` +
`ChecklistTemplateItem.inputType: "yes_no" | "free_text" | null`. The publish COPY
is `select("*")` + spread → inherits the column automatically; the enumerated
quick-ADD insert (template-builder.ts:1099) gains `input_type`. Server add guard:
inputType + expectsCount together → 400 `input_type_conflicts_count` (mirrors the
DB CHECK).

### 2. Answer validation (`completeItem`, lib/checklists.ts)
The write path is already permissive (count_value/notes accepted on any line);
add per-type REQUIRED-ness: `input_type='yes_no'` → countValue must be exactly 0
or 1 (else new `ChecklistInvalidAnswerError` → 400 `invalid_answer`);
`input_type='free_text'` → notes must be non-empty trimmed (else same error).
Existing expects_count/expects_photo validation unchanged. Photo composes with
any type (council: additive, never an input type).

### 3. Builder authoring
- QuickAdd: an input-type selector — Tick (default) · Count · Yes/No · Free text.
  Count keeps the spine-link law exactly as today; choosing Yes/No or Free text
  disables the count toggle + spine link (client mirror of the CHECK).
- Drawer: a new `input_type` edit op in the TemplateItemEdit union +
  `applyEditToRow` branch (tick/yes_no/free_text; switching TO count is NOT an
  edit op — count needs a spine link, so it stays add-time-only in v1, matching
  today's drawer which cannot toggle expects_count either).
- Publish diff labels the change; mirror rows stay sealed (copy verbatim).
- Doctor: no new checks v1.

### 4. Operator rendering (shared answer semantics in one pure helper)
New pure client-safe `lib/checklist-answers.ts`:
`interpretAnswer(item, completion) → { kind: "tick"|"count"|"yes"|"no"|"text", display }`
— the ONE place answer semantics live; UI + reports both consume it; test-pinned.
- ChecklistItem: yes_no lines render Yes / No buttons (both record a completion —
  countValue 1/0; the answered state shows the answer, NO in the danger tone);
  free_text lines render a text entry + save (notes; reuses the count-save flow
  shape). The meta stack renders "Yes"/"No"/the text instead of the count+° form.
- Opening: verify at build time which component opening phase 1 renders; if it
  does not share ChecklistItem, the same interpretAnswer rendering lands there
  too — the builder authors BOTH list types, so both must render (no
  half-rendered trap).

### 5. Reports rendering
Closing/opening report rows keyed on the item's inputType via interpretAnswer:
yes_no → ✓ Yes / ✗ No (danger tone on No) · free_text → the notes text.
Signals/done-skipped logic unchanged (live-completion presence; hard_gate
satisfaction = answered, either way — a recorded NO satisfies the gate and
surfaces red in the report, which is exactly the point).

## Explicitly OUT (deferred per council)
Temp as a distinct type (numeric + unit hint covers) · min/max bounds on numeric ·
a bool_value completions column (revisit only if count_value 1/0 proves a lie in
practice) · conditional logic · prep input types (already exist via columns).

## Tests
interpretAnswer pins (every kind, incl. count_value 0 ≠ unanswered) · completeItem
validation paths (yes_no rejects null/2; free_text rejects empty) via the
extracted pure validator · row-mapping pin for inputType.
