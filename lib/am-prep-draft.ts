import { hasTaskAccess } from "@/lib/assignments";
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
  amPrepDraftApplies,
  amPrepDraftLineHasValue,
  parseAmPrepDraft,
  type AmPrepDraft,
  type AmPrepDraftItem,
  type AmPrepDraftRestore,
} from "./am-prep-draft-shared";
import { lockLocationContext } from "./locations";
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
 * loadRestorableAmPrepDraft — the PAGE's draft read: what (if anything) the form should be
 * seeded with. NEVER THROWS.
 *
 * `loadAmPrepDraft` throws on any Supabase error, which is right for an API caller. The AM
 * prep page is different: if this deploys before 0214 is applied, or the read blips, a
 * throw here would take the whole AM prep page down — strictly worse than the reset bug the
 * draft exists to fix. So any failure is logged with an `[am-prep]` prefix and the page
 * renders the form with no draft.
 */
export async function loadRestorableAmPrepDraft(
  service: SupabaseClient,
  args: {
    mode: "submit" | "edit" | "read_only";
    instance: { id: string; status: string };
    locationId: string;
    businessDate: string;
  },
): Promise<AmPrepDraftRestore | null> {
  if (args.mode !== "submit" || args.instance.status !== "open") return null;
  try {
    const stored = await loadAmPrepDraft(service, {
      locationId: args.locationId,
      businessDate: args.businessDate,
    });
    if (
      !stored ||
      !amPrepDraftApplies({
        mode: args.mode,
        instanceStatus: args.instance.status,
        instanceId: args.instance.id,
        draftInstanceId: stored.instanceId,
        consumed: false,
        itemCount: Object.values(stored.draft.items).filter(amPrepDraftLineHasValue).length,
      })
    ) {
      return null;
    }
    return { draft: stored.draft, savedAt: stored.savedAt, savedByName: stored.savedByName };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[am-prep] draft load failed; rendering the form without a draft: ${msg}`);
    return null;
  }
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
 * ONE ATOMIC RPC. After the app-layer guards above, the write is `save_am_prep_draft`
 * (0214), which locks the instance and the shop-day row and merges the patch per line in
 * SQL. Concurrent saves of different lines both land; the same line is last write wins. A
 * newer instance resets the row (lines and consumed_at); a stale tab on an OLDER instance
 * is refused 409 draft_superseded.
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

  if (!(await hasTaskAccess(service, {
    userId: actor.user.id, level: actor.level, task: "am_prep",
    locationId: instance.location_id, date: instance.date,
  }))) {
    throw new AmPrepDraftError(403, "prep_role_violation", "Active assignment or unassigned KH+ task required.");
  }

  if (instance.status !== "open") {
    throw new AmPrepDraftError(409, "prep_instance_not_open", "AM Prep has already been submitted.");
  }

  // The merge happens IN SQL, atomically (0214 `save_am_prep_draft`): the RPC locks the
  // instance (and rechecks it is open), locks or creates the shop-day row, resets it for a
  // newer instance (lines AND consumed_at), merges this patch per line and returns saved_at.
  // Two devices saving different lines at once therefore both land.
  const { data, error } = await service.rpc("save_am_prep_draft", {
    p_instance_id: instance.id,
    p_patch: args.patch,
    p_saved_by: actor.user.id,
  });
  if (error) {
    const mapped = mapSaveRpcError(error.message);
    if (mapped) throw mapped;
    throw new Error(`saveAmPrepDraft: rpc: ${error.message}`);
  }
  if (typeof data !== "string") {
    throw new Error("saveAmPrepDraft: rpc returned no saved_at");
  }
  return { savedAt: data };
}

/** The RPC raises `am_prep_draft:<code>`; turn the known codes into HTTP answers. */
export function mapSaveRpcError(message: string): AmPrepDraftError | null {
  const m = /am_prep_draft:([a-z_]+)/.exec(message);
  switch (m?.[1]) {
    case "instance_not_found":
      return new AmPrepDraftError(404, "instance_not_found", "AM Prep instance not found.");
    case "prep_instance_not_open":
      return new AmPrepDraftError(409, "prep_instance_not_open", "AM Prep has already been submitted.");
    case "draft_superseded":
      return new AmPrepDraftError(409, "draft_superseded", "A newer AM Prep instance owns today's draft.");
    case "draft_too_large":
    case "invalid_payload":
      return new AmPrepDraftError(400, "invalid_payload", "draft failed validation.");
    default:
      return null;
  }
}

/**
 * consumeAmPrepDraft — mark the draft consumed after a SUCCESSFUL submit of `instanceId`.
 *
 * Called by POST /api/prep/submit only after `submitAmPrep` returned; a failed submit never
 * reaches it, so a failed submit keeps the draft. BOUND TO THE INSTANCE: the UPDATE matches
 * `instance_id` as well as the shop-day key, so an older instance's submit can never consume
 * a newer instance's draft. Marked, not deleted (the 0203 posture). Returns the number of
 * rows marked (0 = there was no open draft for that instance).
 */
export async function consumeAmPrepDraft(
  service: SupabaseClient,
  args: {
    actor: AmPrepDraftActor;
    instanceId: string;
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
    .eq("instance_id", args.instanceId)
    .is("consumed_at", null)
    .select("location_id");
  if (error) throw new Error(`consumeAmPrepDraft: ${error.message}`);
  return (data ?? []).length;
}
