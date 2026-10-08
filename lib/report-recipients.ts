/**
 * Report recipients — the writer and the admin read (service-role). Level 9+ manages; a GM (7)
 * may view. The LOCATION BIND lives here, before any I/O: every location_ids element must pass
 * lockLocationContext for the actor (tests/location-bind-differential.test.ts lists this file).
 * Deactivate = active=false; nothing is ever deleted (0220 grants no DELETE).
 */
import "server-only";
import { audit } from "@/lib/audit";
import { lockLocationContext } from "@/lib/locations";
import type { RoleCode } from "@/lib/roles";
import type { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import {
  RECIPIENTS_MANAGE_MIN,
  RECIPIENTS_VIEW_MIN,
  settingsRows,
  type RecipientInput,
  type SettingsPatch,
} from "@/lib/report-recipients-shared";
import { DIGEST_KINDS, resolveDigestRecipients, type DigestKind, type DigestSettings, type DigestSkipReason } from "@/lib/report-digests-shared";
import { loadDigestDirectory, loadDigestSettings } from "@/lib/report-digests";
import { isPackageEligibleRole } from "@/lib/report-package-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;

export interface RecipientActor { userId: string; role: RoleCode; level: number; locations: string[] }

export class RecipientError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

interface Row {
  id: string; kind: "internal" | "external"; user_id: string | null; email: string | null; display_name: string; active: boolean;
  catering_digest: boolean; shop_digest: boolean; location_ids: string[] | null; packages: string[]; cadence: string | null; formats: string[];
}
const COLS = "id, kind, user_id, email, display_name, active, catering_digest, shop_digest, location_ids, packages, cadence, formats";

function toRow(v: RecipientInput) {
  return {
    kind: v.kind, user_id: v.userId, email: v.email, display_name: v.displayName, active: v.active,
    catering_digest: v.cateringDigest, shop_digest: v.shopDigest, location_ids: v.locationIds,
    packages: v.packages, cadence: v.cadence, formats: v.formats,
  };
}

/** Create or update one override/external row. Throws RecipientError with a named code. */
export async function saveReportRecipient(sb: Sb, args: { actor: RecipientActor; input: RecipientInput; ipAddress?: string | null; userAgent?: string | null }): Promise<{ id: string }> {
  const { actor, input } = args;
  if (actor.level < RECIPIENTS_MANAGE_MIN) throw new RecipientError(403, "role_insufficient");
  // Location bind before any I/O: a shop list can only name shops the actor may act in.
  for (const id of input.locationIds ?? []) {
    if (!lockLocationContext({ role: actor.role, locations: actor.locations }, id)) throw new RecipientError(403, "location_access_denied");
  }
  if (input.locationIds && input.locationIds.length > 0) {
    const { data, error } = await sb.from("locations").select("id").in("id", input.locationIds).eq("active", true);
    if (error) throw new Error(`locations: ${error.message}`);
    if ((data ?? []).length !== input.locationIds.length) throw new RecipientError(400, "invalid_location");
  }
  if (input.kind === "internal") {
    const { data, error } = await sb.from("users").select("id, role").eq("id", input.userId!).maybeSingle<{ id: string; role: string }>();
    if (error) throw new Error(`users: ${error.message}`);
    if (!data) throw new RecipientError(400, "user_required");
    // CC ruling (Astra P1): staff package rows are for the owner only; the send path re-checks it.
    if (input.packages.length > 0 && !isPackageEligibleRole(data.role)) throw new RecipientError(400, "package_owner_only");
  }

  const audited = { actorId: actor.userId, actorRole: actor.role, resourceTable: "report_recipients", ipAddress: args.ipAddress ?? null, userAgent: args.userAgent ?? null };
  if (input.id === null) {
    const { data, error } = await sb.from("report_recipients")
      .insert({ ...toRow(input), created_by: actor.userId, updated_by: actor.userId }).select("id").single<{ id: string }>();
    if (error) {
      if ((error as { code?: string }).code === "23505") throw new RecipientError(409, "recipient_exists");
      if ((error as { code?: string }).code === "23514") throw new RecipientError(400, "email_required_to_enable");
      throw new Error(`report_recipients insert: ${error.message}`);
    }
    await audit({ ...audited, action: "report_recipient.create", resourceId: data.id, metadata: { after: toRow(input) } });
    return { id: data.id };
  }

  const { data: before, error: readErr } = await sb.from("report_recipients").select(COLS).eq("id", input.id).maybeSingle<Row>();
  if (readErr) throw new Error(`report_recipients read: ${readErr.message}`);
  if (!before) throw new RecipientError(404, "not_found");
  if (before.kind !== input.kind || (before.kind === "internal" && before.user_id !== input.userId)) throw new RecipientError(400, "identity_immutable");
  // Narrowing a row that already names a shop outside the actor's reach is also refused (level 9 reaches all).
  for (const id of before.location_ids ?? []) {
    if (!lockLocationContext({ role: actor.role, locations: actor.locations }, id)) throw new RecipientError(403, "location_access_denied");
  }
  const { data: updated, error } = await sb.from("report_recipients")
    .update({ ...toRow(input), updated_by: actor.userId, updated_at: new Date().toISOString() })
    .eq("id", input.id).select("id");
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new RecipientError(409, "recipient_exists");
    if ((error as { code?: string }).code === "23514") throw new RecipientError(400, "email_required_to_enable");
    throw new Error(`report_recipients update: ${error.message}`);
  }
  if ((updated ?? []).length !== 1) throw new RecipientError(404, "not_found");
  await audit({
    ...audited, resourceId: input.id,
    action: before.active && !input.active ? "report_recipient.deactivate" : "report_recipient.update",
    metadata: { before, after: toRow(input) },
  });
  return { id: input.id };
}

/** Write the digest settings (mode / times / grace). Level 9+. */
export async function updateReportSettings(sb: Sb, args: { actor: RecipientActor; patch: SettingsPatch; ipAddress?: string | null; userAgent?: string | null }): Promise<DigestSettings> {
  if (args.actor.level < RECIPIENTS_MANAGE_MIN) throw new RecipientError(403, "role_insufficient");
  const before = await loadDigestSettings(sb);
  const rows = settingsRows(args.patch).map((r) => ({ ...r, updated_by: args.actor.userId, updated_at: new Date().toISOString() }));
  const { error } = await sb.from("report_settings").upsert(rows, { onConflict: "key" });
  if (error) throw new Error(`report_settings: ${error.message}`);
  const after = await loadDigestSettings(sb);
  await audit({
    actorId: args.actor.userId, actorRole: args.actor.role, action: "report_settings.update", resourceTable: "report_settings",
    resourceId: null, metadata: { before, after }, ipAddress: args.ipAddress ?? null, userAgent: args.userAgent ?? null,
  });
  return after;
}

export interface AutomaticRecipient {
  name: string; role: string; hasEmail: boolean; email: string | null; shops: string[]; skip: DigestSkipReason | null;
}
export interface RecipientsAdminView {
  canManage: boolean;
  settings: DigestSettings;
  automatic: Record<DigestKind, AutomaticRecipient[]>;
  rows: Array<Row & { userName: string | null; hasEmail: boolean }>;
  users: Array<{ id: string; name: string; role: string }>;
  locations: Array<{ id: string; name: string }>;
}

/** The admin read. GM (7) views; emails are shown only to managers (9+). */
export async function loadReportRecipientsAdmin(sb: Sb, actor: RecipientActor): Promise<RecipientsAdminView> {
  if (actor.level < RECIPIENTS_VIEW_MIN) throw new RecipientError(403, "role_insufficient");
  const canManage = actor.level >= RECIPIENTS_MANAGE_MIN;
  const [settings, { dir, locations }, rows] = await Promise.all([
    loadDigestSettings(sb),
    loadDigestDirectory(sb),
    selectAllRows<Row>((from, to) => sb.from("report_recipients").select(COLS).order("kind").order("display_name").order("id").range(from, to)),
  ]);
  const names = new Map(locations.map((l) => [l.id, l.name]));
  const users = new Map(dir.users.map((u) => [u.id, u]));
  const automatic = Object.fromEntries(DIGEST_KINDS.map((kind) => [kind, resolveDigestRecipients(kind, dir).map((r) => ({
    name: r.name, role: users.get(r.userId)?.role ?? "", hasEmail: r.email !== null, email: canManage ? r.email : null,
    shops: r.locationIds.map((id) => names.get(id) ?? id), skip: r.skip,
  }))])) as Record<DigestKind, AutomaticRecipient[]>;
  return {
    canManage, settings, automatic, locations,
    rows: rows.map((r) => ({ ...r, email: canManage ? r.email : null, hasEmail: r.email !== null, userName: r.user_id ? users.get(r.user_id)?.name ?? null : null })),
    users: dir.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, role: u.role })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
