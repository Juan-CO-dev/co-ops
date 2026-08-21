/**
 * THE AUDIT ACTION VOCABULARY — every action name this codebase emits.
 *
 * WHY THIS EXISTS. `AuditInput.action` used to be typed `string`, so any spelling
 * compiled and any new action defaulted silently to `destructive: false`. That is
 * how the product-identity family reached production unregistered (sim P2,
 * 2026-08-21) and how `section_question.update` / `item_question.update` sat
 * unregistered beside their own already-registered `create` and `disable`
 * siblings. Nothing failed. Nothing said anything. The forensic filter just
 * quietly stopped covering a family of edits.
 *
 * The registry could not catch that on its own: it is a list of what IS
 * destructive, with no notion of what EXISTS, so an unregistered action and a
 * deliberately-non-destructive one were indistinguishable. This module supplies
 * the missing half — the closed vocabulary — so every action must be
 * ADJUDICATED into exactly one of three lists and there is no silent third state.
 *
 * ENFORCED BY THE COMPILER, not by a scanner. `action` is typed as the union of
 * this vocabulary, so an unlisted spelling is a BUILD failure at the call site
 * rather than a test failure somewhere else, and a typo'd action name can no
 * longer reach the audit log at all. tests/audit-actions.test.ts pins the set
 * invariants the type system cannot express (disjointness, no duplicates, every
 * registry entry accounted for) — the same shape as tests/readiness.test.ts's
 * KNOWN_REASONS closed-vocabulary check.
 *
 * ADDING AN ACTION: put it in DESTRUCTIVE_ACTIONS (lib/destructive-actions.ts)
 * if a HUMAN act alters shared operational config or the accountability record;
 * otherwise put it in NON_DESTRUCTIVE_ACTIONS below. Either way it must be in
 * one of them, and the criterion lives in the registry's own header.
 */

import { DESTRUCTIVE_ACTIONS } from "@/lib/destructive-actions";

/**
 * Emitted actions that are deliberately NOT destructive.
 *
 * "Not destructive" never means unimportant — `auth_account_locked` and
 * `toast_sales.pull_failed` matter a great deal. It means the row does not
 * belong in the answer to "who changed the kitchen's configuration or its
 * accountability record", which is the one question the destructive flag exists
 * to filter for.
 */
export const NON_DESTRUCTIVE_ACTIONS = [

  // ── AUTH & SESSION ────────────────────────────────────────────────────
  // Sign-in, lockout, token and step-up events. Security-relevant and
  // forensically vital, but not config mutations — the actor is proving who they
  // are, not changing what the kitchen is.
  "auth_account_locked",
  "auth_email_verified",
  "auth_logout",
  "auth_password_reset_requested",
  "auth_password_reset_success",
  "auth_pin_confirm_failure",
  "auth_pin_confirm_success",
  "auth_signin_password_failure",
  "auth_signin_password_success",
  "auth_signin_pin_failure",
  "auth_signin_pin_success",
  "auth_step_up_failure",
  "auth_step_up_success",
  "auth_token_consumed_replay",
  "auth_token_expired",
  "auth_token_invalid",
  "session_token_mismatch",

  // ── CHECKLIST & REPORT SUBMISSION ─────────────────────────────────────
  // The operational record being WRITTEN in the normal course of a shift.
  // The corrections to it (revoke, tag_actual_completer, drop) ARE destructive and
  // live in the registry; the ordinary submissions are the baseline they correct.
  "cash_report.submit",
  "cash_report.supersede",
  "checklist.confirm",
  "checklist_completion.create",
  "checklist_completion.supersede_failure",
  "checklist_instance.create",
  "checklist_submission.create",
  "checklist_template.update",
  "opening.phase1_submit",
  "opening.phase2.item_saved",
  "opening.phase2.submit",
  "opening.snapshot_materialize",
  "pm_report.submit",
  "prep.mid_day.item_saved",
  "prep.snapshot_drift",
  "prep.submit",
  "written_report.submit",
  "written_report.update",

  // ── CATERING ──────────────────────────────────────────────────────────
  // The catering stack's own config + pipeline vocabulary. Several of these
  // (catering.kb.* create/update/deactivate) are shared-registry config edits that
  // look destructive by the same criterion as category.create, and are flagged for
  // a lead ruling rather than swept in unilaterally — see the PR body.
  "catering.company.add_domain",
  "catering.company.attach_contact",
  "catering.company.create",
  "catering.company.edit",
  "catering.company.remove_domain",
  "catering.customer.activate",
  "catering.customer.create",
  "catering.customer.deactivate",
  "catering.customer.edit",
  "catering.draft.create",
  "catering.draft.submit",
  "catering.fulfillment.node_upsert",
  "catering.kb.capacity.blackout_create",
  "catering.kb.capacity.blackout_deactivate",
  "catering.kb.capacity.create",
  "catering.kb.capacity.update",
  "catering.kb.faq.activate",
  "catering.kb.faq.create",
  "catering.kb.faq.deactivate",
  "catering.kb.faq.edit",
  "catering.kb.item_size.create",
  "catering.kb.item_size.deactivate",
  "catering.kb.item_size.update",
  "catering.kb.menu.set_flags",
  "catering.kb.packages.activate",
  "catering.kb.packages.create",
  "catering.kb.packages.deactivate",
  "catering.kb.packages.line_item_add",
  "catering.kb.packages.line_item_remove",
  "catering.kb.packages.line_item_update",
  "catering.kb.packages.slot_option_add",
  "catering.kb.packages.slot_option_classic",
  "catering.kb.packages.slot_option_remove",
  "catering.kb.packages.update",
  "catering.kb.pricing.create",
  "catering.kb.pricing.deactivate",
  "catering.kb.pricing.update",
  "catering.kb.rate.create",
  "catering.kb.rate.deactivate",
  "catering.kb.rate.update",
  "catering.kb.zones.activate",
  "catering.kb.zones.create",
  "catering.kb.zones.deactivate",
  "catering.kb.zones.edit",
  "catering.order.pay_intent",
  "catering.payment.mark_paid",
  "catering.pipeline.create",
  "catering.pipeline.edit",
  "catering.pipeline.stage_move",
  "catering.prep_demand.consume",
  "catering.prep_demand.release",
  "catering.prep_demand.reserve",
  "catering.prep_demand.resync_skipped_package",
  "catering.prep_demand.sync_failed",
  "catering.quote.create",
  "catering.quote.revise",
  "catering.quote.send",
  "catering.quote.status",
  "catering_package.create",

  // ── INVENTORY, RECEIVING & ORDERING ───────────────────────────────────
  // Operational events on the inventory spine — things HAPPENING, not
  // config being re-pointed.
  "credit.resolved",
  "delivery.completed",
  "delivery.match_attested",
  "delivery.match_overridden",
  "delivery.receipt_linked",
  "delivery.received",
  "item.set_type",
  "item_size.create",
  "measure_unit.create",
  "par_pass.submitted",
  "po.confirmed",
  "po.draft_created",
  "po.email_sent",
  "po.placed",
  "po.received",
  "po.reconciled",
  "product.resolution_flip",
  "production.recorded",
  "production.revoked",
  "receipt.parsed",
  "receipt.po_linked",
  "recipe.input_unit_normalize",
  "recipe_input.update",
  "sku.deduplicate",
  "sku.pack_chain_update",
  "sku_count.recorded",
  "vendor_item.price_recorded",

  // ── TOAST / POS ───────────────────────────────────────────────────────
  // Integration bookkeeping: pulls, mappings, exclusions.
  "toast_depletion.materialize",
  "toast_map.auto_match",
  "toast_map.confirm",
  "toast_map.manual_map",
  "toast_map.reject",
  "toast_map.set_location_guid",
  "toast_map.stale",
  "toast_map.unmap",
  "toast_sales.exclusion_add",
  "toast_sales.exclusion_remove",
  "toast_sales.pull",
  "toast_sales.pull_failed",

  // ── PORTAL & CUSTOMER ─────────────────────────────────────────────────
  // Customer-facing funnel events.
  "lto.event.cancel",
  "lto.event.create",
  "portal.magic_link_consumed",
  "portal.magic_link_insert_failed",
  "portal.magic_link_requested",
  "portal.magic_link_throttled",
  "sms.received",

  // ── SEED & INFRA ──────────────────────────────────────────────────────
  // Scripts, cron and one-shot provenance.
  "audit.metadata_correction",
  "cron.failure",
  "cron.success",
  "ezcater.set_location_uuid",
  "maintenance.note",
  "photo.upload",] as const;

/**
 * Registered as destructive but with NO emitter in the codebase today.
 *
 * Kept deliberately, and NOT deleted: each is either (a) a Foundation-Spec
 * placeholder for capability that is planned but unbuilt, or (b) emitted from
 * SQL rather than from JS, where `isDestructive()` is bypassed and the migration
 * sets `destructive` literally. The closed-vocabulary test uses this list to
 * distinguish "not built yet" from "registered a name nothing will ever write",
 * which would otherwise look identical.
 */
export const RESERVED_ACTIONS = [
  // Emitted from SQL only (submit_am_prep_atomic and friends set destructive=true
  // directly on the INSERT) — real, live, and invisible to a JS-side scan.
  "report.update",
  // Convention documented in AGENTS.md, written by hand during incident recovery
  // rather than by any code path.
  "audit.gap_recovery",
  // Location lifecycle — the admin surface for it does not exist yet.
  "location.create",
  "location.activate",
  "location.deactivate",
  "location.change_type",
  // Item composition — superseded in practice by the recipe graph's
  // recipe_input.* edges, which ARE emitted.
  "item_component.add",
  "item_component.remove",
  // Planned/unbuilt capability.
  "pars.update",
  "system.config_update",
  "audit.retention_change",
  "reports.bulk_export",
  "reports.bulk_correct",
  // v2 placeholders — scoped permission grants are not in foundation.
  "permissions.grant",
  "permissions.revoke",
] as const;

/**
 * The whole vocabulary. `AuditInput.action` is typed off this, so this union is
 * the set of names that can reach the audit log.
 */
export const AUDIT_ACTIONS = [...DESTRUCTIVE_ACTIONS, ...NON_DESTRUCTIVE_ACTIONS] as const;

export type NonDestructiveAction = (typeof NON_DESTRUCTIVE_ACTIONS)[number];
export type ReservedAction = (typeof RESERVED_ACTIONS)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Runtime membership check, for the SQL-side and script-side emitters TS cannot see. */
export function isKnownAuditAction(action: string): action is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(action);
}
