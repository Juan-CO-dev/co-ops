/**
 * Destructive action registry — Foundation Spec v1.2 Section 7.3.
 *
 * Modules cannot mark their own actions as destructive — additions go through
 * this list and a coordinated review.
 *
 * ── WHAT MEMBERSHIP ACTUALLY DOES (corrected 2026-08-21) ────────────────────
 *
 * This header used to say these actions "require step-up auth (password
 * re-entry) for level 5+ users before they can be executed." That is NOT what
 * the registry does, and the stale claim is load-bearing enough to have already
 * caused one wrong decision (see below).
 *
 * `isDestructive` has exactly ONE consumer in the entire codebase:
 * lib/audit.ts's `destructive:` column on the audit row. Step-up is enforced
 * somewhere else entirely — lib/admin/step-up.ts, gated by ROUTE/PATH via
 * `isAdminPath`, with no reference to this list. So adding a name here changes
 * one thing and nothing else: whether the forensic filter can find the row.
 *
 * That distinction resolved a genuine contradiction between two in-repo
 * documents. docs/superpowers/plans/2026-08-20-product-identity.md ruled "None
 * are destructive — do not add them to DESTRUCTIVE_ACTIONS" for the product.*
 * family, while docs/sim/2026-08-21-product-identity-simday.md filed their
 * absence as a gap ("forensic-filter gap only — step-up is enforced at the
 * routes"). Both are right about their own subject: the plan was protecting a
 * step-up behaviour this list does not control, and the sim was describing the
 * forensic filter it does. The sim's reading is the operative one, so the family
 * is registered below — with zero behavioural change to who can do what.
 *
 * THE CRITERION, as the entries below have applied it consistently: an action is
 * destructive when a HUMAN act alters shared operational config or the
 * accountability record — the things you would want to filter the audit log down
 * to when asking "who changed the kitchen?". A system OBSERVATION is not
 * destructive no matter how consequential (see product.resolution_flip in
 * lib/audit-actions.ts's non-destructive list).
 */

export const DESTRUCTIVE_ACTIONS = [
  // User lifecycle
  "user.create",
  "user.activate",
  "user.deactivate",
  "user.promote",
  "user.demote",
  "user.change_locations",
  "user.reset_pin",
  "user.reset_password",
  "user.set_pin",
  "user.change_email",

  // Location lifecycle
  "location.create",
  "location.activate",
  "location.deactivate",
  "location.change_type",

  // Configuration
  "pars.update",
  "system.config_update",

  // Role-model renumber (Phase 3 — C.41 collision fix, migration 0058).
  // One-shot 0-10 scale renumber of current_user_role_level() + the
  // users.role CHECK + every role-level RLS threshold. Destructive because it
  // alters the authorization semantics of every gated table at once; the
  // migration-emitted audit row sets destructive=true directly (SQL-side, not
  // via isDestructive()).
  "role_model.renumber",

  // Vendor lifecycle
  "vendor.create",
  "vendor.activate",
  "vendor.deactivate",
  "vendor.full_profile_edit",
  // Vendor sub-resource changes (Vendor Directory v2, Slice A).
  // — vendor.contact_change covers add/update/remove of a vendor_contacts row
  //   (op carried in metadata.op = add|update|remove); vendor.ordering_change
  //   covers the same for vendor_ordering_details. Auto-derive destructive=true
  //   via isDestructive(). Append-only (remove = active=false; last-row removal
  //   blocked at the lib).
  "vendor.contact_change",
  "vendor.ordering_change",
  // — vendor.cutoff_change covers add/deactivate of a vendor_cutoffs row (VO-7;
  //   migration 0174). op carried in metadata.op = add|deactivate. Parallels
  //   vendor.contact_change; add = AGM+, deactivate = GM+ (contact floors).
  //   Append-only (deactivate = active=false). Auto-derive destructive=true.
  "vendor.cutoff_change",

  // SKU catalog lifecycle (Item/Inventory Spine — vendor mini-arc, Slice C1).
  // — vendor_items are the purchasable units. create/update/deactivate/activate
  //   on the catalog (GM+); vendor_id is nullable (manual/vendor-less SKUs) and
  //   update may reassign it (incl. → null). Append-only (deactivate = active=false).
  //   Auto-derive destructive=true via isDestructive().
  "vendor_item.create",
  "vendor_item.update",
  "vendor_item.activate",
  "vendor_item.deactivate",
  "item_component.add",
  "item_component.remove",

  // Recipe stage (Derivation Spine sub-project 1). Two-tier recipe entity
  // (production→items / consumer→menu_items) + polymorphic input/output edges +
  // menu_items leaf. Config mutations analogous to item_component.* / vendor_item.* —
  // auto-derive destructive=true via isDestructive() so the audit record is
  // consistently flagged. Writes are service-role + app-gated in lib/recipes.ts
  // (GM+ create/edit; MoO+ for menu_price). Append-only for recipes/menu_items
  // (deactivate via active=false); recipe_input/output are hard-deleted edges with
  // before-state in the audit row (mirrors item_component.remove).
  "recipe.create",
  "recipe.update",
  "recipe.deactivate",
  "recipe_input.add",
  "recipe_input.remove",
  "recipe_output.add",
  "recipe_output.remove",
  "menu_item.create",

  // Category registry (Vendor Directory v2, Slice A).
  // — category.create adds a category to the shared `categories` registry (MoO+,
  //   global). Same "enumerate categorical free-text via registries" principle
  //   as unit.create. Auto-derive destructive=true via isDestructive().
  "category.create",
  // — order_type.create adds an order type to the shared `order_types` registry
  //   (MoO+, global). Mirrors category.create — the traditional supply view
  //   (Produce / Dry Goods / Paper / …). Auto-derive destructive=true.
  "order_type.create",

  // Checklist template lifecycle
  "checklist_template.create",
  "checklist_template.delete_or_deactivate",
  "checklist_template_item.delete",
  // In-place config edit of a prep template item (C.44 Module 3 slice 1).
  // — destructive because it alters operational config (par targets, who can
  // complete a step). Auto-derives destructive=true on the audit row via
  // isDestructive(). Edits are id-preserving; history stays frozen via C.44
  // snapshots. before_state/after_state carry the changed fields.
  "checklist_template_item.update",
  // In-place create of a prep template item (C.44 Module 3 slice 2).
  // — destructive because it alters operational config. Auto-derives
  // destructive=true via isDestructive(). Append-only INSERT (new active row).
  "checklist_template_item.create",

  // Item / inventory registry (Item/Inventory Spine, sub-project 1).
  // — item lifecycle on the new registry. Auto-derive destructive via isDestructive().
  "item.create",
  "item.update",
  "item.backfill",

  // Par layer (Item/Inventory Spine, sub-project 2B).
  // — item_par.update alters operational par config; item.promote_to_global flips
  //   a location item to global (all-locations blast radius). Auto-derive
  //   destructive=true via isDestructive(); append-only / reversible config writes.
  "item_par.update",
  "item.promote_to_global",
  // — item.set_default toggles default-template membership (MoO+); turning it on
  //   propagates enabled lines to every location. Auto-derive destructive.
  "item.set_default",
  // — item.set_opening_verify toggles whether the item is included in Opening
  //   Phase-2 verification (migration 0089); the toggle propagates Opening mirror
  //   create/deactivate across every location's am_prep template. Auto-derive
  //   destructive=true via isDestructive().
  "item.set_opening_verify",
  // — item.set_sold_directly flags a production item as sold-directly + sets sell portion/unit
  //   (Recipe Stage refinement, migration 0105). GM+ (menu_price MoO+). Auto-derive destructive.
  "item.set_sold_directly",
  // — prep_section.update renames a section's display label (MoO+, all-locations).
  "prep_section.update",
  // — prep_section.create adds a section to the registry (MoO+, all-locations).
  "prep_section.create",
  // — prep_section.disable deactivates a section + cascades its active lines to Misc (MoO+).
  "prep_section.disable",
  // — prep_section.reorder swaps a section's display_order with a neighbor (MoO+).
  "prep_section.reorder",
  // — unit.create adds a unit to the standardized registry (MoO+).
  "unit.create",
  // — section_question.create adds a non-inventory section question (MoO+) +
  //   propagates a line onto every prep list with that section.
  "section_question.create",
  // — section_question.disable deactivates a section question + its propagated lines (MoO+).
  "section_question.disable",
  // — item_question.create adds a non-inventory question to an item (MoO+) +
  //   propagates a line onto every prep list where the item appears.
  "item_question.create",
  // — item_question.disable deactivates an item question + its propagated lines (MoO+).
  "item_question.disable",
  // — the two EDIT actions for the same questions (2026-08-21 sweep). Their own
  //   create/ and disable/ siblings four lines up were already registered, so
  //   until now a forensic filter asking "who changed the prep questions?"
  //   returned every ADD and every REMOVAL and silently missed every EDIT — the
  //   one that changes what a question ASKS without changing that it exists.
  //   Both are grep-invisible at the call site (routed through
  //   lib/admin/templates.ts's `args.auditAction` variable), which is why the
  //   pair was missed when the siblings were registered.
  "section_question.update",
  "item_question.update",

  // Checklist completion correction (per SPEC_AMENDMENTS.md C.28)
  // — destructive because they alter operational/accountability record.
  // Auto-derived destructive=true on the audit row via isDestructive().
  "checklist_completion.revoke",
  "checklist_completion.tag_actual_completer",

  // Cross-user mark-not-done by authority (per SPEC_AMENDMENTS.md C.55)
  // — a KH+ actor reopening a false completion on someone else's row,
  // bounded by actor.level >= completer current level (at-or-below,
  // peers included). Distinct action from checklist_completion.revoke
  // (C.28's self-only post-60s revoke) so the audit trail separates
  // self-correction from authority-correction. Auto-derived
  // destructive=true on the audit row via isDestructive().
  "checklist_completion.revoke_by_authority",

  // Opening Phase 2 per-item prep revoke (C.53 §8.4 Lane D).
  // — destructive because it withdraws a saved prep completion from the
  // operational/accountability record. Distinct from closing's
  // "checklist_completion.revoke": Phase 2 owns its own thin revoke lib
  // (revokePhase2Completion) with a hierarchical permission gate and a
  // prep-specific reason vocabulary (quick_reenter / re_enter_count / other,
  // per migration 0057). The SILENT quick-window self-revert writes NO audit
  // row — only the STRUCTURED path emits this action.
  "opening.phase2.revoke",

  // Report post-submission update (per SPEC_AMENDMENTS.md C.46 A7)
  // — destructive because it's an additive correction to a submitted
  // report. Audit row is emitted from inside submit_am_prep_atomic RPC
  // (atomic with chain write); RPC-side INSERT into audit_log explicitly
  // sets destructive=true rather than relying on JS-side audit() helper's
  // auto-derive. The action name lives here so future generalization to
  // other report types (Cash Report, Opening Report, Mid-day Prep — per
  // C.46 A9) reuses the same destructive registration. isDestructive()
  // returns true for "report.update" via the registry membership check.
  "report.update",

  // Closing auto-finalize without manual confirmation (Build #3 PR 1).
  // — destructive because the operational record transitions to
  // 'auto_finalized' without the closer's PIN-attestation. Three release
  // sources distinguished via metadata.release_source:
  //   'opener'           — opener tapped Release UI (PR 4)
  //   'system_auto'      — pg_cron / lazy-eval picked up an overdue closing
  //   'migration_backfill' — one-shot backfill of pre-PR-1 stranded v1
  //                        instances (migration 0046; CHECK constraint on
  //                        finalized_at_actor_type does NOT include this
  //                        — it lives in audit metadata only).
  "closing.released_unfinalized",

  // Report drop / un-claim (Build #3 PR 1).
  // — destructive because it releases an in-progress instance back to
  // unclaimed; assignment_locked instances cannot be self-dropped. Audit
  // metadata captures prior_assigned_to, prior_assignment_locked, and
  // dropped_reason for forensic chain. Pattern over time: someone
  // dropping reports they self-initiated often = capacity/attention
  // signal (per design doc §4.5).
  "report.drop",

  // Audit forensic recovery (Build #3 PR 2 — added during C.49 seed remediation).
  // Distinct from audit.metadata_correction:
  //   audit.metadata_correction = correcting wrong/incomplete metadata on an
  //                               existing audit row (entries already exist
  //                               but carry stale or incorrect context)
  //   audit.gap_recovery        = backfilling forensic record for changes that
  //                               landed WITHOUT any audit row (mid-run failure,
  //                               race condition, etc.); the supplemental row
  //                               documents the orphaned changes after the fact
  // Schema convention: metadata.recovery_type, metadata.failed_run_error,
  // metadata.orphaned_changes (op-by-op array), metadata.resolving_audit_row_id
  // (forward link to the row that completed the work in the recovery run).
  "audit.gap_recovery",

  // ── Product identity (0179–0181; sim P2 sweep, 2026-08-21) ────────────────
  // The registry gap the product-identity sim filed. Every one of these is a
  // GM+ human act that re-points shared operational config — and this family is
  // load-bearing in a way the SKU catalog is not, because one pointer decides
  // which vendor's ounces and dollars every recipe, count and order walk means.
  // Forensic-filter only: step-up on /admin/products is already enforced by
  // path, so nothing about who may do these changes.
  // — product.create adds a raw identity above the SKU catalog (GM+). The
  //   registry analog of item.create / vendor_item.create, both already here.
  "product.create",
  // — member_attach / member_detach move a SKU under or out from a product,
  //   which changes what a recipe pinned to that product will resolve to.
  //   Same blast radius as item_component.add/remove, already here.
  "product.member_attach",
  "product.member_detach",
  // — primary_set re-points which member a product means at a location. This is
  //   THE pointer the whole layer exists to control; a wrong one silently
  //   re-costs the menu. Location-bound at both layers since the T0 tenancy fix.
  "product.primary_set",
  // — unit_oz_set owns the count-denominated basis (AGENTS.md: "A PRODUCT OWNS
  //   unit_oz, NOT A PACK"). Editing it re-denominates every count-based recipe
  //   line for that identity at once. Mirrors item_par.update's rationale.
  "product.unit_oz_set",
  // — set_active is retirement: Juan declaring "we stop buying this identity".
  //   It refuses at resolution rung 0, suppresses par'd member SKUs from the
  //   order walk and turns pinned recipe lines red. Deliberately deferred by the
  //   retirement PR (#283) to this sweep; the exact analog of
  //   vendor_item.deactivate, already here.
  "product.set_active",

  // ── Weight provenance (0179 quartet; same sweep) ──────────────────────────
  // A weight fill writes the oz basis that every cost, depletion and variance
  // number divides by — the most numerically consequential edit in the admin
  // console, and the one the costing board's `unweighed` status exists to
  // refuse until a human does it. Both are human acts on shared config, so both
  // belong here by the same criterion as vendor_item.update.
  // (sku.weight_fill predates the product arc — PR #163 — so it is NOT one of
  // the seven the sim filed; it is an older instance of the identical gap,
  // swept here because splitting the pair would leave the weight board half
  // filterable.)
  "sku.weight_fill",
  "item.weight_fill",

  // ── Basis-altering edits (lead ruling on the 2026-08-21 sweep) ────────────
  // Both alter a BASIS other data silently depends on — the registry's own
  // criterion — and since membership is forensic-only (see the header), there is
  // no behavioural risk in flagging them.
  // — sku.pack_chain_update replaces a SKU's whole active pack chain, which IS
  //   the oz denominator every cost, depletion and variance number divides by.
  //   `vendor_item.update` has been registered since the catalog shipped; a
  //   chain edit moves the same arithmetic harder, and it is the write whose
  //   flat-field mirror going stale silently splits the cost board from the
  //   catalog screens (the defect this PR's second commit fixes).
  "sku.pack_chain_update",
  // — item.set_type changes an item's semantic CLASS, which re-routes how every
  //   downstream reader treats it (what it can be counted in, whether it is a
  //   production output, which surfaces list it). Same shape as the registered
  //   item.set_sold_directly / item.set_default, which flip narrower flags.
  "item.set_type",

  // ── Dynamic Pars (2026-08-22) ─────────────────────────────────────────────
  // The criterion (this file's header): destructive = a HUMAN act altering shared
  // operational config or the accountability record. Both of these are a human moving a
  // par — the same edit vendor_item.update has covered since the catalog shipped, reached
  // by a different affordance. Forensic-filter only: membership changes what is FINDABLE,
  // never what is PERMITTED (step-up is route-gated, and these routes take none — plan D2).
  // Placed after the 2026-08-21 sweep blocks rather than mid-sweep so the product-identity
  // quartet and its weight/basis riders stay one contiguous narrative.
  // — par.suggestion_accept: a manager taking the machine's number. Writes
  //   location_sku_settings' HUMAN par lane at (sku, location, day-class) and clears the pin.
  "par.suggestion_accept",
  // — par.auto_tune_revert: a manager undoing an applied auto-move. Writes the human lane,
  //   nulls the auto column, and SETS the pin. Consumes the weekly budget (r2-8 final).
  "par.auto_tune_revert",

  // Bulk / sensitive
  "reports.bulk_export",
  "reports.bulk_correct",
  "audit.retention_change",

  // v2 placeholder — scoped permission grants are not in foundation
  "permissions.grant",
  "permissions.revoke",
] as const;

export type DestructiveAction = (typeof DESTRUCTIVE_ACTIONS)[number];

export function isDestructive(action: string): action is DestructiveAction {
  return (DESTRUCTIVE_ACTIONS as readonly string[]).includes(action);
}
