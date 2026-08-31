/**
 * Admin Catering FAQ data layer (Wave 1 slice 1A — FAQ editor).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → level floor → assertStepUp)
 * AND re-checked here per-action (defense in depth; the lib is the authority).
 * Service-role bypasses RLS by design, consistent with lib/admin/vendors.ts and
 * lib/admin/skus.ts.
 *
 * The per-action re-check includes the LOCATION BIND on every write — the role floor
 * (6) is below the all-locations grant (9), so it cannot say which store's row an actor
 * may touch. See assertFaqLocationWritable.
 *
 * Append-only: removals flip `active=false`, never DELETE.
 *
 * Schema (catering_faq):
 *   id, location_id (uuid nullable — null = global), slug (unique per active
 *   location+slug pair), question_en, question_es, answer_en, answer_es,
 *   active, display_order, created_by, updated_by, created_at, updated_at.
 *
 * slug is derived from question_en (lowercase kebab, truncated to 80 chars).
 * One active row per (location_id, slug) pair — colliding active slug throws
 * faq_exists.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { isAllLocationsAccess, lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

// ── Authority floors (the lib is the authority per-action) ──────────────────
const FAQ_READ_MIN = 6;   // AGM+ / catering_mgr+
const FAQ_WRITE_MIN = 6;  // create — same floor (Tier B step-up at route layer)
const FAQ_EDIT_MIN = 6;   // edit text — same floor (Tier A step-up at route layer)
const FAQ_DEACT_MIN = 6;  // deactivate — same floor (Tier B step-up at route layer)

// ── Typed error ─────────────────────────────────────────────────────────────
export class AdminCateringError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminCateringError";
  }
}

// ── Internal guards ──────────────────────────────────────────────────────────
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new AdminCateringError(403, "forbidden", "Insufficient role level for this action");
  }
}

function normalizeOptional(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t || null;
}

function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}

/**
 * The set of location ids whose rows the actor may READ, or null at the all-locations
 * grant. Globals (location_id null) are always visible regardless and are added by the
 * caller's `.or(… ,location_id.is.null)`.
 *
 * Mirrors `visibleLocationScope` in the sibling packages editor, but takes its threshold
 * from `isAllLocationsAccess` so there is exactly ONE definition of "all locations" in
 * play here — the same one `lockLocationContext` uses for the write bind above.
 */
function visibleLocationScope(actor: AuthContext): string[] | null {
  if (isAllLocationsAccess(actorLoc(actor))) return null;
  return actor.locations ?? [];
}

/**
 * The write-target bind, mirroring lib/admin/catering/zones.ts's requireAccessibleLocation
 * — minus its DB round trip, because the answer is pure: a location the actor does not
 * hold is refused whether or not the row exists.
 *
 * FAQ_WRITE_MIN is 6 and lockLocationContext's all-locations grant starts at 9, so the
 * floor alone never says WHICH store's FAQ this touches. At CO every level 6/7/8 actor
 * holds exactly one shop, so without this an AGM at one store could author, retitle or
 * deactivate the other store's row — a config write into a shop they have no stake in.
 *
 * A NULL location_id is the tenant-wide row and is DELIBERATELY NOT bound here: publishing
 * globally is an existing sanctioned capability of this editor at level 6 (the form's
 * location picker defaults to the Global sentinel), and moving that floor is a role-gate
 * decision that takes the lib+RLS+UI sweep, not a bug fix. It is filed for the chair.
 */
function assertFaqLocationWritable(actor: AuthContext, locationId: string | null): void {
  if (locationId === null) return;
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new AdminCateringError(403, "forbidden", "Location is outside your assignments");
  }
}

/**
 * Derive a stable slug from question_en: trim, lowercase, replace
 * non-alphanumeric runs with hyphens, collapse multiple hyphens,
 * strip leading/trailing hyphens, truncate to 80 chars.
 */
export function slugifyQuestion(question: string): string {
  const slug = question
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) throw new AdminCateringError(400, "invalid_slug", "Question is empty after slugify");
  return slug;
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface FaqView {
  id: string;
  locationId: string | null;
  slug: string;
  questionEn: string;
  questionEs: string | null;
  answerEn: string;
  answerEs: string | null;
  active: boolean;
  displayOrder: number;
}

interface DbFaqRow {
  id: string;
  location_id: string | null;
  slug: string;
  question_en: string;
  question_es: string | null;
  answer_en: string;
  answer_es: string | null;
  active: boolean | null;
  display_order: number;
}

const FAQ_COLS =
  "id, location_id, slug, question_en, question_es, answer_en, answer_es, active, display_order";

function rowToView(r: DbFaqRow): FaqView {
  return {
    id: r.id,
    locationId: r.location_id,
    slug: r.slug,
    questionEn: r.question_en,
    questionEs: r.question_es,
    answerEn: r.answer_en,
    answerEs: r.answer_es,
    active: r.active ?? true,
    displayOrder: r.display_order,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * Load the FAQs the actor can see, ordered by display_order (active first). AGM+ (≥6).
 *
 * SCOPED: globals (location_id null) PLUS the actor's own assignments; level 9+ sees
 * every location's rows. This mirrors `loadPackages` in the sibling packages editor —
 * the same `.or(location_id.in.(…),location_id.is.null)` idiom — and it closes the half
 * of the read that `assertFaqLocationWritable` (PR #303) left open: since that bind
 * landed, a single-shop AGM was still SHOWN the other store's FAQ rows in the editor,
 * every one of which 403s on Save. A row you may not edit does not belong in an editor.
 */
export async function loadFaqs(actor: AuthContext): Promise<FaqView[]> {
  requireLevel(actor, FAQ_READ_MIN);
  const sb = getServiceRoleClient();
  const scope = visibleLocationScope(actor);
  let query = sb.from("catering_faq").select(FAQ_COLS);
  if (scope !== null) {
    // Own locations OR global (location_id null). PostgREST `.or()` with an
    // `in.(...)` list plus `is.null` — the loadPackages spelling.
    const idList = scope.length > 0 ? scope.join(",") : "";
    query = idList
      ? query.or(`location_id.in.(${idList}),location_id.is.null`)
      : query.is("location_id", null);
  }
  const { data, error } = await query
    .order("active", { ascending: false, nullsFirst: false })
    .order("display_order", { ascending: true })
    .returns<DbFaqRow[]>();
  if (error) throw new Error(`loadFaqs failed: ${error.message}`);
  return (data ?? []).map(rowToView);
}

/**
 * Load active locations for the optional location selector, SCOPED to the actor's
 * assignments (level 9+ = all). AGM+ (≥6).
 *
 * This list IS the FaqForm's write-target picker, and `assertFaqLocationWritable`
 * already refuses a location the actor does not hold — so offering the other store
 * here ships a dead option that 403s on Save (the `loadFulfillmentNodes` precedent,
 * PR #303).
 *
 * THE GLOBAL LANE IS UNTOUCHED AND STAYS AT LEVEL 6 (Juan's ruling, 2026-08-29).
 * `FaqForm` renders its own Global sentinel — `<option value="">` — independently of
 * this list, and `assertFaqLocationWritable` returns early on a null location_id, so
 * a scoped picker changes nothing about global authoring. `tests/catering-authz.test.ts`
 * pins that deliberate behaviour; this scoping must keep it green.
 */
export async function loadFaqLocations(
  actor: AuthContext,
): Promise<Array<{ id: string; name: string }>> {
  requireLevel(actor, FAQ_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("locations")
    .select("id, name")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`loadFaqLocations failed: ${error.message}`);
  return (data ?? []).filter((l) => lockLocationContext(actorLoc(actor), l.id));
}

// ── Create (AGM+ / catering_mgr+; Tier B step-up at route) ──────────────────
export interface CreateFaqInput {
  locationId: string | null;
  questionEn: string;
  questionEs?: string | null;
  answerEn: string;
  answerEs?: string | null;
}

export async function createFaq(
  actor: AuthContext,
  input: CreateFaqInput,
): Promise<{ id: string; slug: string }> {
  requireLevel(actor, FAQ_WRITE_MIN);
  const locationId = input.locationId ?? null;
  assertFaqLocationWritable(actor, locationId);

  const questionEn = input.questionEn.trim();
  if (!questionEn) throw new AdminCateringError(400, "invalid_label", "question_en cannot be empty");
  const answerEn = input.answerEn.trim();
  if (!answerEn) throw new AdminCateringError(400, "invalid_label", "answer_en cannot be empty");

  const slug = slugifyQuestion(questionEn);
  const questionEs = normalizeOptional(input.questionEs);
  const answerEs = normalizeOptional(input.answerEs);

  const sb = getServiceRoleClient();

  // Dup-guard: one active row per (location_id, slug).
  let dupQuery = sb
    .from("catering_faq")
    .select("id")
    .eq("slug", slug)
    .eq("active", true);
  if (locationId === null) {
    dupQuery = dupQuery.is("location_id", null);
  } else {
    dupQuery = dupQuery.eq("location_id", locationId);
  }
  const { data: existing, error: eErr } = await dupQuery.maybeSingle<{ id: string }>();
  if (eErr) throw new Error(`createFaq dup check failed: ${eErr.message}`);
  if (existing) throw new AdminCateringError(409, "faq_exists", "An active FAQ with that key already exists for this location");

  // display_order = max active + 1.
  const { data: maxRow, error: mErr } = await sb
    .from("catering_faq")
    .select("display_order")
    .eq("active", true)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  if (mErr) throw new Error(`createFaq max order failed: ${mErr.message}`);
  const displayOrder = (maxRow?.display_order ?? 0) + 1;

  const { data: inserted, error: iErr } = await sb
    .from("catering_faq")
    .insert({
      location_id: locationId,
      slug,
      question_en: questionEn,
      question_es: questionEs,
      answer_en: answerEn,
      answer_es: answerEs,
      active: true,
      display_order: displayOrder,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (iErr) throw new Error(`createFaq insert failed: ${iErr.message}`);
  if (!inserted) throw new Error("createFaq insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.faq.create",
    resourceTable: "catering_faq",
    resourceId: inserted.id,
    metadata: { slug, location_id: locationId, display_order: displayOrder },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id, slug };
}

// ── Update text (AGM+ / catering_mgr+; Tier A step-up at route) ─────────────
export interface UpdateFaqTextInput {
  questionEn?: string;
  questionEs?: string | null;
  answerEn?: string;
  answerEs?: string | null;
}

async function requireFaqRow(id: string): Promise<DbFaqRow> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_faq")
    .select(FAQ_COLS)
    .eq("id", id)
    .maybeSingle<DbFaqRow>();
  if (error) throw new Error(`requireFaqRow failed: ${error.message}`);
  if (!data) throw new AdminCateringError(404, "not_found", "FAQ not found");
  return data;
}

export async function updateFaqText(
  actor: AuthContext,
  args: { id: string; changes: UpdateFaqTextInput },
): Promise<void> {
  requireLevel(actor, FAQ_EDIT_MIN);
  const existing = await requireFaqRow(args.id);
  assertFaqLocationWritable(actor, existing.location_id);

  const update: Record<string, unknown> = {};
  const { changes } = args;

  let newSlug: string | undefined;

  if (changes.questionEn !== undefined) {
    const qEn = changes.questionEn.trim();
    if (!qEn) throw new AdminCateringError(400, "invalid_label", "question_en cannot be empty");
    update.question_en = qEn;
    // Re-derive slug from new question_en.
    newSlug = slugifyQuestion(qEn);
  }
  if (changes.questionEs !== undefined) update.question_es = normalizeOptional(changes.questionEs);
  if (changes.answerEn !== undefined) {
    const aEn = changes.answerEn.trim();
    if (!aEn) throw new AdminCateringError(400, "invalid_label", "answer_en cannot be empty");
    update.answer_en = aEn;
  }
  if (changes.answerEs !== undefined) update.answer_es = normalizeOptional(changes.answerEs);

  if (Object.keys(update).length === 0) return;

  // If slug changed, check for collision in the same (location_id, slug) space.
  if (newSlug && newSlug !== existing.slug) {
    const sb = getServiceRoleClient();
    let dupQuery = sb
      .from("catering_faq")
      .select("id")
      .eq("slug", newSlug)
      .eq("active", true)
      .neq("id", args.id);
    if (existing.location_id === null) {
      dupQuery = dupQuery.is("location_id", null);
    } else {
      dupQuery = dupQuery.eq("location_id", existing.location_id);
    }
    const { data: dup, error: dErr } = await dupQuery.maybeSingle<{ id: string }>();
    if (dErr) throw new Error(`updateFaqText dup check failed: ${dErr.message}`);
    if (dup) throw new AdminCateringError(409, "faq_exists", "An active FAQ with that key already exists for this location");
    update.slug = newSlug;
  }

  update.updated_by = actor.user.id;
  update.updated_at = new Date().toISOString();

  const sb = getServiceRoleClient();
  const { error } = await sb.from("catering_faq").update(update).eq("id", args.id);
  if (error) throw new Error(`updateFaqText failed: ${error.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.faq.edit",
    resourceTable: "catering_faq",
    resourceId: args.id,
    metadata: {
      location_id: existing.location_id,
      fields: Object.keys(update).filter((k) => k !== "updated_by" && k !== "updated_at"),
      ...(newSlug ? { slug_changed_to: newSlug } : {}),
    },
    ipAddress: null,
    userAgent: null,
  });
}

// ── Deactivate / reactivate (AGM+ / catering_mgr+; Tier B step-up at route) ─
export async function deactivateFaq(
  actor: AuthContext,
  args: { id: string; active: boolean },
): Promise<void> {
  requireLevel(actor, FAQ_DEACT_MIN);
  const existing = await requireFaqRow(args.id);
  assertFaqLocationWritable(actor, existing.location_id);

  const sb = getServiceRoleClient();
  const { error } = await sb
    .from("catering_faq")
    .update({
      active: args.active,
      updated_by: actor.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.id);
  if (error) throw new Error(`deactivateFaq failed: ${error.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: args.active ? "catering.kb.faq.activate" : "catering.kb.faq.deactivate",
    resourceTable: "catering_faq",
    resourceId: args.id,
    metadata: { location_id: existing.location_id, slug: existing.slug },
    ipAddress: null,
    userAgent: null,
  });
}
