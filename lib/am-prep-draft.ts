/**
 * AM Prep DRAFT — the I/O half (migration 0214, `am_prep_drafts`).
 *
 * The pure half (shape, validator, patch/merge, precedence, role predicate) lives in
 * `lib/am-prep-draft-shared.ts` so the client form can import it. Every function here takes
 * the SERVICE client: the table is deny-all to the PostgREST roles (the 0203 posture), so
 * the app-layer gates in this file ARE the gates — the role floor and the location bind
 * both live in the lib, before any write, with the route as the outer layer.
 *
 * No audit row, deliberately (the 0203 rule): a draft save fires about once a second while
 * someone types; the audit log is the accountability record of human acts, not a keystroke
 * log. The accountability row for AM prep is the one `submitAmPrep` already emits
 * (`prep.submit`). No new audit action is introduced.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  canWriteAmPrepDraft,
  emptyAmPrepDraft,
  mergeAmPrepDraftItems,
  parseAmPrepDraft,
  type AmPrepDraft,
  type AmPrepDraftItem,
} from "./am-prep-draft-shared";
import { lockLocationContext } from "./locations";
import { AM_PREP_BASE_LEVEL, loadAssignmentForToday } from "./prep";
import type { RoleCode } from "./roles";

export * from "./am-prep-draft-shared";

/** The acting user, as the routes hold it (`AuthContext` is structurally compatible). */
export interface AmPrepDraftActor {
  user: { id: string };
  role: RoleCode;
  level: number;
  locations: string[];
}

export class AmPrepDraftError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AmPrepDraftError";
  }
}

interface DraftRow {
  instance_id: string;
  draft: unknown;
  saved_by: string | null;
  saved_at: string;
  consumed_at: string | null;
}

/**
 * loadAmPrepDraft — the stored draft for one shop and business day, or null.
 *
 * Null when there is no row, when it was consumed by a successful submit, and when the
 * stored jsonb fails the validator (logged — observable, not swallowed). The caller decides
 * whether it APPLIES (`amPrepDraftApplies`): this returns the facts the decision needs.
 * The page has already bound the actor to `locationId` before calling.
 */
export async function loadAmPrepDraft(
  service: SupabaseClient,
  args: { locationId: string; businessDate: string },
): Promise<{
  instanceId: string;
  draft: AmPrepDraft;
  savedAt: string;
  savedByName: string | null;
} | null> {
  const { data, error } = await service
    .from("am_prep_drafts")
    .select("instance_id, draft, saved_by, saved_at, consumed_at")
    .eq("location_id", args.locationId)
    .eq("business_date", args.businessDate)
    .maybeSingle<DraftRow>();
  if (error) throw new Error(`loadAmPrepDraft: ${error.message}`);
  if (!data || data.consumed_at !== null) return null;
  const draft = parseAmPrepDraft(data.draft);
  if (!draft) {
    console.error(
      `[am-prep] loadAmPrepDraft: unparseable draft for ${args.locationId} ${args.businessDate}; treating as absent`,
    );
    return null;
  }

  let savedByName: string | null = null;
  if (data.saved_by) {
    // Two-step read (AGENTS.md: no embedded relation filters). Attribution is a courtesy on
    // the restore line; a failed name lookup must not lose the count, so it degrades to null.
    const { data: user, error: userErr } = await service
      .from("users")
      .select("name")
      .eq("id", data.saved_by)
      .maybeSingle<{ name: string | null }>();
    if (userErr) {
      console.error(`[am-prep] loadAmPrepDraft: saver name lookup failed: ${userErr.message}`);
    } else {
      savedByName = user?.name ?? null;
    }
  }

  return { instanceId: data.instance_id, draft, savedAt: data.saved_at, savedByName };
}

/**
 * saveAmPrepDraft — merge a PATCH of changed lines into the shop's draft for the instance's
 * business day. Returns the server's `saved_at`.
 *
 * Order of guards (each refuses before the next does any work):
 *   1. the instance exists                     → 404 instance_not_found
 *   2. the actor holds the instance's shop     → 403 location_access_denied
 *   3. it is an AM prep instance               → 404 instance_not_found (same answer: an
 *      id that is not an AM prep is, to this route, not an AM prep that exists)
 *   4. the AM prep submit role gate            → 403 prep_role_violation
 *   5. the instance is still open              → 409 prep_instance_not_open
 * The location and the day come from the INSTANCE, never from the body.
 *
 * MERGE, then upsert. Line-level last write wins: two people typing into the SAME line at
 * the same second resolve to whoever saved last, and a read-merge-write pair racing another
 * within milliseconds can drop one patch (the next keystroke re-sends it, because the
 * client only advances its baseline on success). A consumed draft, or one left by a
 * different instance (template re-versioned mid-day), is not merged into — its lines belong
 * to a finished count or to another template.
 */
export async function saveAmPrepDraft(
  service: SupabaseClient,
  args: {
    actor: AmPrepDraftActor;
    instanceId: string;
    patch: Record<string, AmPrepDraftItem>;
  },
): Promise<{ savedAt: string }> {
  const { actor } = args;

  const { data: instance, error: instErr } = await service
    .from("checklist_instances")
    .select("id, template_id, location_id, date, status")
    .eq("id", args.instanceId)
    .maybeSingle<{
      id: string;
      template_id: string;
      location_id: string;
      date: string;
      status: string;
    }>();
  if (instErr) throw new Error(`saveAmPrepDraft: load instance: ${instErr.message}`);
  if (!instance) {
    throw new AmPrepDraftError(404, "instance_not_found", `Instance ${args.instanceId} not found`);
  }

  if (!lockLocationContext({ role: actor.role, locations: actor.locations }, instance.location_id)) {
    throw new AmPrepDraftError(403, "location_access_denied", "You don't have access to this location.");
  }

  const { data: template, error: tmplErr } = await service
    .from("checklist_templates")
    .select("type, prep_subtype")
    .eq("id", instance.template_id)
    .maybeSingle<{ type: string; prep_subtype: string | null }>();
  if (tmplErr) throw new Error(`saveAmPrepDraft: load template: ${tmplErr.message}`);
  if (!template || template.type !== "prep" || template.prep_subtype !== "am_prep") {
    throw new AmPrepDraftError(404, "instance_not_found", `Instance ${args.instanceId} is not an AM prep`);
  }

  let hasAssignment = false;
  if (actor.level < AM_PREP_BASE_LEVEL) {
    const assignment = await loadAssignmentForToday(service, {
      userId: actor.user.id,
      reportType: "am_prep",
      locationId: instance.location_id,
      date: instance.date,
    });
    hasAssignment = assignment !== null;
  }
  if (
    !canWriteAmPrepDraft({
      actorLevel: actor.level,
      baseLevel: AM_PREP_BASE_LEVEL,
      hasAssignment,
    })
  ) {
    throw new AmPrepDraftError(
      403,
      "prep_role_violation",
      `level >= ${AM_PREP_BASE_LEVEL} OR active assignment`,
    );
  }

  if (instance.status !== "open") {
    throw new AmPrepDraftError(409, "prep_instance_not_open", "AM Prep has already been submitted.");
  }

  const { data: existing, error: readErr } = await service
    .from("am_prep_drafts")
    .select("instance_id, draft, consumed_at")
    .eq("location_id", instance.location_id)
    .eq("business_date", instance.date)
    .maybeSingle<{ instance_id: string; draft: unknown; consumed_at: string | null }>();
  if (readErr) throw new Error(`saveAmPrepDraft: load draft: ${readErr.message}`);

  const base =
    existing && existing.consumed_at === null && existing.instance_id === instance.id
      ? parseAmPrepDraft(existing.draft) ?? emptyAmPrepDraft()
      : emptyAmPrepDraft();
  const merged: AmPrepDraft = {
    ...emptyAmPrepDraft(),
    items: mergeAmPrepDraftItems(base.items, args.patch),
  };

  // saved_at written explicitly: the DEFAULT fires on INSERT only (the 0203 note).
  const savedAt = new Date().toISOString();
  const { data, error } = await service
    .from("am_prep_drafts")
    .upsert(
      {
        location_id: instance.location_id,
        business_date: instance.date,
        instance_id: instance.id,
        draft: merged,
        saved_by: actor.user.id,
        saved_at: savedAt,
      },
      { onConflict: "location_id,business_date" },
    )
    .select("saved_at")
    .single<{ saved_at: string }>();
  // Supabase JS swallows constraint violations on the data path — check `error`.
  if (error) throw new Error(`saveAmPrepDraft: upsert: ${error.message}`);
  return { savedAt: data?.saved_at ?? savedAt };
}

/**
 * consumeAmPrepDraft — mark the shop's draft for the day consumed after a SUCCESSFUL submit.
 *
 * Called by POST /api/prep/submit only after `submitAmPrep` returned; a failed submit never
 * reaches it, so a failed submit keeps the draft. Marked, not deleted: the 0203 posture
 * (working state has no delete path) and it leaves a forensic "this count was handed in"
 * stamp. The loader ignores consumed rows, and so would it ignore the row anyway once the
 * instance is confirmed. Returns the number of rows marked (0 = there was no open draft).
 */
export async function consumeAmPrepDraft(
  service: SupabaseClient,
  args: {
    actor: AmPrepDraftActor;
    locationId: string;
    businessDate: string;
  },
): Promise<number> {
  if (
    !lockLocationContext({ role: args.actor.role, locations: args.actor.locations }, args.locationId)
  ) {
    throw new AmPrepDraftError(403, "location_access_denied", "You don't have access to this location.");
  }
  const { data, error } = await service
    .from("am_prep_drafts")
    .update({ consumed_at: new Date().toISOString() })
    .eq("location_id", args.locationId)
    .eq("business_date", args.businessDate)
    .is("consumed_at", null)
    .select("location_id");
  if (error) throw new Error(`consumeAmPrepDraft: ${error.message}`);
  return (data ?? []).length;
}
