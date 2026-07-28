# Checklist/Reports Template Builder — design (council-ratified 2026-07-28)

Canonical output of the two-round council at `.claude/council/2026-07-28-template-builder/`
(reports `report.md` + `report-r2.md`). Owner's bar (verbatim anchors): the builder is
**GROUND TRUTH** — "if a report is to be edited it must reconcile perfectly"; "all
checklists or reports that point to a SKU or item must directly point to that SKU or
item"; "fully editable… reorder… edit/add/disable/enable… make a must complete";
"it cannot break or silently fail because everything operationally depends on these
counts"; and the hard gate is a **per-line capability the backend can enable or disable
across any line** (owner ruling 2026-07-28, superseding the council's open question).

## 0. The two lies this arc deletes
1. Opening / closing / deep-cleaning show dead "editor pending" cards while prep (the
   hardest type) has a full editor. The most-edited lists get editors.
2. The "report definitions" hub card implies an entity that does not exist — the
   checklist template IS the report template (`lib/reports-hub.ts` renders instances
   against `checklist_template_items`; `lib/report-signals.ts` derives on read). The
   card dies; report knobs live inside the template editor.

## 1. THE RECONCILIATION CONTRACT (the law of this arc)
**Every publish mints a new template version — a new `checklist_templates` row with
fresh item rows — and takes effect NEXT OPERATIONAL DAY.** No in-place mutation of a
version that has ever served an instance. History is immutable by construction:
instances bind `template_id` at creation and their version's rows are never touched.

Evidence that killed every same-day in-place carve-out (round 2):
- reports loader live-reads `active=true ORDER BY display_order` (reports-hub.ts:387-393)
  → in-place disable/reorder rewrite how PAST reports render;
- reports-search.ts:141 filters `active=true` → in-place disable silently erases the
  item from historical report search (the owner's named failure, live);
- relabel in place renders yesterday's report with today's wording; even ADD in place
  makes prior same-version instances render a phantom "skipped" row;
- role-floor raised in place can block a closer from confirming their own completed
  work (checklists.ts:1139).

Rules:
- **Same-day exceptions (data-completeness fills only, in place, immediate):**
  spine-link fills (item_id/vendor_item_id) and Spanish-translation fills. They fix
  missing data; they change no behavior and no capture.
- **Next-day effect mechanism:** an active flip alone is UNSAFE mid-shift —
  `getOrCreateInstance` keys on (template_id, location, date), so a mid-shift flip
  mints a DUPLICATE day-instance (the stranding vector). Resolution must be
  date-aware (`effective_from`-style: resolveActive* picks the newest active version
  whose effective date ≤ the operational date). Exact column/mechanism = PR-3 detail.
- **Emergency "Apply now":** Tier-A step-up; still versions; plain-language warning
  ("closers mid-checklist keep today's list").
- **Manager language:** "Publish — live tomorrow morning." Never "v2/v3", never
  "clone/flip". The publish confirm shows a diff summary ("3 added · 1 removed ·
  2 renamed") + open-instance note.

## 2. THE FLOOR (PR-0 — ships before any editor)
1. **One server write/publish lib** for ALL template mutations (rowcount-checked,
   typed errors, publish = one transaction). The UI only previews; the lib enforces.
   No other write path may exist.
2. **Historical report reads become active-AGNOSTIC** — read items by template_id
   without the active filter (reports-search fix + audit of every historical read
   path). Defense-in-depth: even a future in-place flip cannot erase history.
3. **Mirror-edit rejection server-side:** opening Phase-2 rows (auto-derived by
   `createOpeningMirror` from AM-prep) reject direct edits with a typed error.
4. **Ghost-card delete** (§0 lie 2).

## 3. GATE TIERS (owner-ruled)
Per item, three tiers, one selector in the drawer:
- **Optional** — no gate.
- **Must complete — or explain why not** = today's `required=true` (verified:
  incomplete required forces a written reason at confirm → 'incomplete_confirmed').
  Exposed honestly with this label; semantics unchanged.
- **Hard gate** = the cash-deposit pattern (checklists.ts:1116-1129 — no reason
  path, submission blocked until done) generalized to a per-item flag settable on
  ANY line of ANY list (owner: "the backend should be able to enable or disable
  across any line"). New column (e.g. `hard_gate boolean NOT NULL DEFAULT false`);
  confirmInstance gains one branch mirroring the cash-ref check; the existing
  cash_report special case is folded into the general mechanism (seeded true).
  Guardrails: setting it = Tier-A step-up + plain warning ("staff cannot submit
  this checklist at all until this is done — use rarely"); the Doctor lists all
  hard-gated items. Gate-tier changes are STRUCTURAL → they version (§1).

## 4. THE SPINE-LINK LAW
- Count-bearing items (`expects_count=true`, or par-bearing prep meta) REQUIRE
  item_id or vendor_item_id **at write time**, server-enforced in the one lib.
  The picker appears only when the count toggle flips ON (dismiss → toggle reverts);
  plain ticks never see it — the 60-second add-flow is untouched.
- Legacy unlinked backlog: a Doctor campaign (the needs-link queue moves INSIDE the
  builder), never a hard block.
- DB floor: `NOT VALID` CHECK `(NOT expects_count) OR (item_id IS NOT NULL OR
  vendor_item_id IS NOT NULL)` (validates new rows, tolerates legacy). Verify/add the
  physical FK `checklist_template_items.item_id → items.id ON DELETE SET NULL`.

## 5. CROSS-LIST REFERENCES & GATES (mostly already built)
- `report_reference_type` (7-value enum) + `reconcileClosingReportRefs` ALREADY
  auto-tick closing items when opening/AM-prep/mid-day/cash/PM artifacts complete —
  expose the picker in the drawer ("Connections" section), build nothing.
- Template-level gate: `submission_gate_predicate` / `edit_gate_predicate`
  (migration 0047 + evaluateGatePredicate, currently NULL everywhere) — expose
  "this list requires <other artifact> submitted" as a template setting. Config
  write into an existing evaluator.
- ONE new mechanism: `ref_track_item_completion` — auto-tick when the specific
  referenced item (references_template_item_id) completes on ITS instance.
- The AM-prep→opening mirror is a DERIVATION, not a reference: read-only in the
  builder ("managed by AM Prep"), rejection enforced in PR-0.
- No graph engine. cash/pm/maintenance report families out of scope.

## 6. THE TEMPLATE DOCTOR (fail-loud, standing)
Derive-on-read integrity panel in the builder header (D2/D3: compact chip, green ✓ /
amber count; expands inline; amber lines deep-link to the fixing drawer). REPORTS,
never gates — only the open-instances check blocks a publish. Invariants:
- every count-bearing item linked (needsLink classifier);
- every reference/gate target exists AND is active;
- location drift, NAMED per item ("P St has 1 item Cap Hill doesn't");
- orphaned mirrors (prep source deactivated, mirror still active);
- Spanish fill-counts ("Spanish 14/61");
- role-floor sanity (incl. the never-confirmable trap: a required item whose
  min_role_level exceeds the confirming floor);
- hard-gated items listed (§3);
- open instances against this template (pre-publish signal).
CI owns: the diff classifier truth-table, the publish transaction, the needsLink
classifier. DB owns: append-only RLS, the NOT VALID CHECK, FKs.

## 7. THE BUILDER UX (D1-D10 bind)
- Hub → list card → builder page. IDENTITY row (44px): en label · station/section
  chip · gate-tier badge · role chip (ROLE NAMES, never numbers) · count/photo
  flags · alert badges. DRAWER: description, Spanish (visible with fill-count
  header, never behind a toggle), flags, Connections (references/spine link),
  type extras, danger zone.
- **Quick-add:** sticky "+ Add item" → label → Enter → repeat; defaults carried
  from last item (section, role); es optional-but-visible; five closing items in
  under a minute on a phone.
- **Phone preview (REQUIRED, PR-1):** renders the DRAFT through the real operator
  renderer, en/es toggle — the manager sees exactly what staff sees tonight
  before publishing.
- The builder is an EDITOR, not a creator — default view is the item list; no
  multi-step wizard, ever.
- Type panels: prep = existing ParGrid/Sections machinery (NOT rebuilt, NOT
  absorbed this arc); opening = Phase-1 editable + Phase-2 read-only; closing =
  Connections; deep-clean = common only (pending §9 mystery).

## 8. LOCATION TRUTH (PR-5; visible from PR-1 via the Doctor)
- Adding an item applies to BOTH locations by default (explicit, shown), with a
  per-item "this location only" mark — intentional drift is legitimate; SILENT
  drift is the bug (the live mid-day 15-vs-16 proves it).
- "Make <B> match <A>" reconcile action (additive inserts only, append-only law).
- No schema unification this arc (per-location rows are load-bearing across
  instances/reports/RLS).

## 9. OPEN ITEM (resolve at PR-2 spec time)
`deep_cleaning` has NO rows in `checklist_templates` prod — identify what actually
drives `/deep-cleaning` before promising its card an editor.

## 10. BUILD SHAPE (each PR: CI-green → hold → Juan merges)
- **PR-0 — the floor + the ghost** (§2). No editor UI.
- **PR-1 — the builder on CLOSING** + Doctor v1 (drift + needs-link inside) +
  phone preview. Closing's "editor pending" dies.
- **PR-2 — OPENING** (Phase-2 read-only) **+ deep-clean** (post-mystery).
- **PR-3 — the publish engine** (§1: draft → version-every-publish +
  next-day effect + open-instances messaging + emergency apply-now).
- **PR-4 — references & gates** (§3 hard_gate + §4 write-gate/CHECK/FK + §5
  pickers + gate-predicate setting + ref_track_item_completion).
- **PR-5 — location sync** (§8).

Laws binding throughout: i18n en+es same-PR (tú-form); disclosure doctrine D1-D10;
append-only; strict TS + noUncheckedIndexedAccess; batch loading; UPDATE rowcount
checks; system-key vs display-string; setPrepItemMeta stays the sole prep-meta path.
