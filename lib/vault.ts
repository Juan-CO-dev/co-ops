import "server-only";
/**
 * Password vault — the SERVER half (service-role reads and writes; the only place a secret is
 * decrypted). Spec: docs/superpowers/specs/2026-10-08-password-vault-design.md.
 *
 * Every entry point: VAULT_ENABLED check → floors/bind (lib/vault-shared.ts) → I/O. The routes have
 * already verified the actor's PIN for THIS request before calling a reveal or recovery here.
 *
 * What never happens in this module:
 *   - a secret in an audit row, a notification param, an error, or a console line (the only object
 *     that carries plaintext is the return value of a successful reveal/recovery);
 *   - a personal reveal leaving a record (no vault_reveals row, no notification; the DB CHECK agrees);
 *   - a view without its record: for a shared reveal the record is written and management is
 *     notified BEFORE the plaintext is returned, and a failed write refuses the reveal.
 *
 * Decryption failure (missing/rotated master key, tampered row) fails closed: `vault_unavailable`,
 * an audit observation `vault.decrypt_failure` (entry id, version, reason code) and a `vault_alert`
 * notification to level 8+. Nothing partial is ever shown.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import type { TranslationKey } from "@/lib/i18n/types";
import { NOTIFICATION_TYPES, enqueueNotification, type NotificationType } from "@/lib/notifications";
import { ROLES, type RoleCode } from "@/lib/roles";
import {
  MASTER_KEY_ID, VaultCryptoError, decryptSecret, encryptSecret, loadMasterKey, secretAad, type EncryptedSecret,
} from "@/lib/vault-crypto";
import { vaultEnabled } from "@/lib/vault-flag";
import {
  VAULT_MANAGE_ALL_LEVEL, VAULT_OWNER_RECOVERY_LEVEL, VAULT_PREVIOUS_RECOVERY_LEVEL, VAULT_PREVIOUS_SECRET_RETENTION_DAYS,
  VAULT_REVEAL_BURST_THRESHOLD, VAULT_REVEAL_HOURLY_CAP, VaultError, canAccessVaultLocation, canCreateShared, canManageEntry,
  canRevealEntry, canSeeSharedEntry, previousSecretRecoverable, revealCapVerdict,
  type RevealCapVerdict, type VaultActor, type VaultEntryInput, type VaultEntryKind, type VaultEntryType, type VaultEntryView,
} from "@/lib/vault-shared";

export interface VaultServerActor extends VaultActor {
  /** For notification text ("Maya (KH, P Street) viewed …"). */
  name: string;
}

export interface VaultRequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

interface EntryRow {
  id: string;
  revision: number;
  kind: VaultEntryKind;
  entry_type: VaultEntryType;
  name: string;
  username: string | null;
  url: string | null;
  notes: string | null;
  location_id: string | null;
  min_level: number | null;
  owner_id: string | null;
  active: boolean;
  updated_at: string | null;
  created_at: string;
}
const ENTRY_COLS = "id,revision,kind,entry_type,name,username,url,notes,location_id,min_level,owner_id,active,updated_at,created_at";

interface SecretRow {
  id: string;
  entry_id: string;
  version: number;
  ciphertext: string | null;
  iv: string | null;
  tag: string | null;
  wrapped_key: string | null;
  key_iv: string | null;
  key_tag: string | null;
  master_key_id: string;
  superseded_at: string | null;
  scrubbed_at: string | null;
}
const SECRET_COLS = "id,entry_id,version,ciphertext,iv,tag,wrapped_key,key_iv,key_tag,master_key_id,superseded_at,scrubbed_at";

export type { VaultEntryView };

export interface RevealResult {
  secret: string;
  version: number;
  /** True when a vault_reveals row was written and management notified (shared / recovery). */
  recorded: boolean;
}

function access(row: EntryRow) {
  return { kind: row.kind, entryType: row.entry_type, locationId: row.location_id, minLevel: row.min_level, ownerId: row.owner_id, active: row.active };
}

function assertEnabled(): void {
  if (!vaultEnabled()) throw new VaultError("not_enabled", 404);
}

function toView(row: EntryRow, actor: VaultActor, previous: Set<string>): VaultEntryView {
  const a = access(row);
  return {
    id: row.id, revision: row.revision, kind: row.kind, entryType: row.entry_type, name: row.name, username: row.username, url: row.url, notes: row.notes,
    locationId: row.location_id, minLevel: row.min_level, ownerId: row.owner_id, updatedAt: row.updated_at ?? row.created_at,
    canManage: canManageEntry(actor, a),
    canRecoverPrevious: row.kind === "shared" && actor.level >= VAULT_PREVIOUS_RECOVERY_LEVEL && previous.has(row.id),
  };
}

async function loadEntry(service: SupabaseClient, entryId: string): Promise<EntryRow | null> {
  const { data, error } = await service.from("vault_entries").select(ENTRY_COLS).eq("id", entryId).maybeSingle<EntryRow>();
  if (error) throw new VaultError("write_failed", 500);
  return data ?? null;
}

/** Keyset pages continue until empty, even when PostgREST caps a page below 100. */
async function allPages<T extends { id: string }>(page: (after: string | null) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error } = await page(after);
    if (error) throw new VaultError("write_failed", 500);
    const batch = (data ?? []) as T[];
    if (batch.length === 0) return rows;
    const last = batch[batch.length - 1]!.id;
    if (last === after) throw new VaultError("write_failed", 500);
    rows.push(...batch);
    after = last;
  }
}

/** The entries with a recoverable previous version (level 8+ only asks). */
async function previousAvailable(service: SupabaseClient, entryIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (entryIds.length === 0) return out;
  const cutoff = new Date(Date.now() - VAULT_PREVIOUS_SECRET_RETENTION_DAYS * 86_400_000).toISOString();
  for (let i = 0; i < entryIds.length; i += 100) {
    const rows = await allPages<{ id: string; entry_id: string; superseded_at: string | null; scrubbed_at: string | null }>((after) => {
      let q = service.from("vault_secrets").select("id,entry_id,superseded_at,scrubbed_at")
        .in("entry_id", entryIds.slice(i, i + 100)).not("superseded_at", "is", null).is("scrubbed_at", null).gte("superseded_at", cutoff)
        .order("id").limit(100);
      if (after !== null) q = q.gt("id", after);
      return q;
    });
    for (const r of rows) {
      if (previousSecretRecoverable({ supersededAt: r.superseded_at, scrubbedAt: r.scrubbed_at })) out.add(r.entry_id);
    }
  }
  return out;
}

// ── Lists ─────────────────────────────────────────────────────────────────────────────────────

export async function listVaultEntries(service: SupabaseClient, actor: VaultActor): Promise<{ shared: VaultEntryView[]; personal: VaultEntryView[] }> {
  assertEnabled();
  const sharedRows = await allPages<EntryRow>((after) => {
    let q = service.from("vault_entries").select(ENTRY_COLS).eq("kind", "shared").eq("active", true)
      .lte("min_level", actor.level).order("id").limit(100);
    if (actor.level < VAULT_MANAGE_ALL_LEVEL) {
      q = actor.locations.length === 0 ? q.is("location_id", null)
        : q.or(`location_id.is.null,location_id.in.(${actor.locations.join(",")})`);
    }
    if (after !== null) q = q.gt("id", after);
    return q;
  });
  const shared = sharedRows.filter((row) => canSeeSharedEntry(actor, access(row)));
  const personal = await personalEntries(service, actor.userId);
  shared.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const previous = actor.level >= VAULT_PREVIOUS_RECOVERY_LEVEL ? await previousAvailable(service, shared.map((r) => r.id)) : new Set<string>();
  return {
    shared: shared.map((r) => toView(r, actor, previous)),
    personal: personal.map((r) => toView(r, actor, new Set())),
  };
}

/** Owner-level (9+) only: another person's personal entry NAMES, so one can be recovered. */
export async function listPersonalEntriesForRecovery(service: SupabaseClient, actor: VaultActor, ownerId: string): Promise<VaultEntryView[]> {
  assertEnabled();
  if (actor.level < VAULT_OWNER_RECOVERY_LEVEL) throw new VaultError("forbidden", 403);
  return (await personalEntries(service, ownerId)).map((r) => toView(r, actor, new Set()));
}

async function personalEntries(service: SupabaseClient, ownerId: string): Promise<EntryRow[]> {
  const rows = await allPages<EntryRow>((after) => {
    let q = service.from("vault_entries").select(ENTRY_COLS).eq("kind", "personal").eq("active", true)
      .eq("owner_id", ownerId).order("id").limit(100);
    if (after !== null) q = q.gt("id", after);
    return q;
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// ── Recipients and labels ─────────────────────────────────────────────────────────────────────

/**
 * Active level-8+ users plus the active GM(s) of the entry's shop (every shop's GMs for a both-shop
 * entry), minus the actor. `gms: false` (bursts, alerts: no entry, no shop) = level 8+ only.
 */
export async function managementRecipients(service: SupabaseClient, locationId: string | null, excludeUserId: string | null, opts: { gms: boolean } = { gms: true }): Promise<string[]> {
  const roles = Object.values(ROLES).filter((r) => r.level >= VAULT_MANAGE_ALL_LEVEL || (opts.gms && r.code === "gm")).map((r) => r.code);
  const { data, error } = await service.from("users").select("id,role").eq("active", true).in("role", roles);
  if (error) throw new VaultError("write_failed", 500);
  const users = (data ?? []) as Array<{ id: string; role: RoleCode }>;
  const out = new Set<string>();
  const gms: string[] = [];
  for (const u of users) {
    if (ROLES[u.role].level >= VAULT_MANAGE_ALL_LEVEL) out.add(u.id);
    else if (u.role === "gm") gms.push(u.id);
  }
  if (gms.length > 0) {
    let q = service.from("user_locations").select("user_id,location_id").eq("active", true).in("user_id", gms);
    if (locationId !== null) q = q.eq("location_id", locationId);
    const m = await q;
    if (m.error) throw new VaultError("write_failed", 500);
    for (const row of (m.data ?? []) as Array<{ user_id: string }>) out.add(row.user_id);
  }
  if (excludeUserId) out.delete(excludeUserId);
  return [...out];
}

/** The shop code(s) for notification text: one code, or every active shop's code joined for a both-shop entry. */
async function shopLabel(service: SupabaseClient, locationId: string | null): Promise<string> {
  const { data, error } = await service.from("locations").select("id,code").eq("active", true).order("code");
  if (error) throw new VaultError("write_failed", 500);
  const rows = (data ?? []) as Array<{ id: string; code: string }>;
  if (locationId === null) return rows.map((r) => r.code).join(" + ");
  return rows.find((r) => r.id === locationId)?.code ?? "?";
}

async function notifyManagement(service: SupabaseClient, args: {
  type: NotificationType; priority: "info" | "urgent"; titleKey: TranslationKey; bodyKey: TranslationKey;
  params: Record<string, string | number>; entry: EntryRow | null; actor: VaultServerActor; recipients?: string[];
}): Promise<void> {
  const recipients = args.recipients ?? await managementRecipients(service, args.entry?.location_id ?? null, args.actor.userId);
  if (recipients.length === 0) return;
  await enqueueNotification(service, {
    type: args.type, priority: args.priority, titleKey: args.titleKey, titleParams: args.params, bodyKey: args.bodyKey, bodyParams: args.params,
    relatedTable: args.entry ? "vault_entries" : undefined, relatedId: args.entry?.id, locationId: args.entry?.location_id ?? undefined,
    createdBy: args.actor.userId, recipients: recipients.map((userId) => ({ userId, deliveryMethod: "in_app" as const })),
  });
}

// ── Decrypt (the ONLY decrypt call sites) ─────────────────────────────────────────────────────

function envelope(row: SecretRow): EncryptedSecret | null {
  if (!row.ciphertext || !row.iv || !row.tag || !row.wrapped_key || !row.key_iv || !row.key_tag) return null;
  return { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, wrappedKey: row.wrapped_key, keyIv: row.key_iv, keyTag: row.key_tag, masterKeyId: row.master_key_id };
}

/** Fails closed: audit observation + alert to 8+ + vault_unavailable. Carries the reason CODE only. */
async function failClosed(service: SupabaseClient, actor: VaultServerActor, entry: EntryRow | null, version: number | null, reason: string, meta: VaultRequestMeta): Promise<never> {
  await audit({
    actorId: actor.userId, actorRole: actor.role, action: "vault.decrypt_failure", resourceTable: "vault_secrets", resourceId: entry?.id ?? null,
    metadata: { entry_id: entry?.id ?? null, version, reason }, ipAddress: meta.ipAddress, userAgent: meta.userAgent,
  });
  try {
    await notifyManagement(service, {
      type: NOTIFICATION_TYPES.VAULT_ALERT, priority: "urgent", titleKey: "notifications.vault_alert.title", bodyKey: "notifications.vault_alert.body",
      params: { entryName: entry?.kind === "shared" ? entry.name : `#${(entry?.id ?? "").slice(0, 8)}`, reason }, entry, actor,
      recipients: await managementRecipients(service, null, null, { gms: false }),
    });
  } catch {
    // The alert is best-effort; the refusal below is not.
  }
  throw new VaultError("vault_unavailable", 503);
}

async function decryptRow(service: SupabaseClient, actor: VaultServerActor, entry: EntryRow, row: SecretRow, meta: VaultRequestMeta): Promise<string> {
  const enc = envelope(row);
  if (!enc) return failClosed(service, actor, entry, row.version, "scrubbed", meta);
  let key: Buffer;
  try {
    key = loadMasterKey();
  } catch (e) {
    return failClosed(service, actor, entry, row.version, e instanceof VaultCryptoError ? e.code : "master_key_invalid", meta);
  }
  try {
    return decryptSecret(enc, key, secretAad(entry.id, row.version));
  } catch {
    return failClosed(service, actor, entry, row.version, "decrypt_failed", meta);
  }
}

async function currentVersion(service: SupabaseClient, entryId: string): Promise<SecretRow | null> {
  const { data, error } = await service.from("vault_secrets").select(SECRET_COLS).eq("entry_id", entryId).is("superseded_at", null).maybeSingle<SecretRow>();
  if (error) throw new VaultError("write_failed", 500);
  return data ?? null;
}

async function recordReveal(service: SupabaseClient, args: {
  entry: EntryRow; actor: VaultActor; kind: "reveal" | "owner_recovery" | "previous_recovery"; version: number; burst: boolean;
}): Promise<void> {
  const { error } = await service.from("vault_reveals").insert({
    entry_id: args.entry.id, entry_kind: args.entry.kind, entry_type: args.entry.entry_type, location_id: args.entry.location_id,
    viewer_id: args.actor.userId, kind: args.kind, secret_version: args.version, burst: args.burst,
  });
  if (error) throw new VaultError("write_failed", 500);
}

// ── The cap ───────────────────────────────────────────────────────────────────────────────────

/**
 * Counts one reveal ATTEMPT for the actor in the current hour-bucket (before the PIN is checked, so
 * PIN guessing through the vault is capped too). At the burst threshold management is told once.
 * Refuses (reveal_cap, 429) once the hour's attempts exceed the cap.
 */
export async function takeRevealSlot(service: SupabaseClient, actor: VaultServerActor): Promise<RevealCapVerdict> {
  assertEnabled();
  const { data, error } = await service.rpc("vault_take_reveal_slot", { p_user_id: actor.userId });
  const attempts = (data as { attempts?: unknown } | null)?.attempts;
  if (error || typeof attempts !== "number") throw new VaultError("write_failed", 500);
  const verdict = revealCapVerdict(attempts);
  if (verdict.notifyBurst) {
    await notifyManagement(service, {
      type: NOTIFICATION_TYPES.VAULT_BURST, priority: "urgent", titleKey: "notifications.vault_burst.title", bodyKey: "notifications.vault_burst.body",
      params: { actorName: actor.name, attempts, threshold: VAULT_REVEAL_BURST_THRESHOLD, cap: VAULT_REVEAL_HOURLY_CAP }, entry: null, actor,
      recipients: await managementRecipients(service, null, actor.userId, { gms: false }),
    });
  }
  if (!verdict.allowed) throw new VaultError("reveal_cap", 429);
  return verdict;
}

// ── Reveal and recoveries ─────────────────────────────────────────────────────────────────────

/**
 * Reveals the CURRENT secret to an actor whose PIN the route already verified for this request.
 * Shared: record + notification BEFORE the plaintext is returned. Personal (owner): neither.
 */
export async function revealVaultSecret(service: SupabaseClient, actor: VaultServerActor, entryId: string, opts: { burst: boolean }, meta: VaultRequestMeta): Promise<RevealResult> {
  assertEnabled();
  const entry = await loadEntry(service, entryId);
  if (!entry || !entry.active || !canRevealEntry(actor, access(entry))) throw new VaultError("entry_not_found", 404);
  const row = await currentVersion(service, entry.id);
  if (!row) return failClosed(service, actor, entry, null, "no_current_version", meta);
  const secret = await decryptRow(service, actor, entry, row, meta);
  if (entry.kind === "personal") return { secret, version: row.version, recorded: false };
  await recordReveal(service, { entry, actor, kind: "reveal", version: row.version, burst: opts.burst });
  await notifyManagement(service, {
    type: NOTIFICATION_TYPES.VAULT_REVEAL, priority: "info", titleKey: "notifications.vault_reveal.title", bodyKey: "notifications.vault_reveal.body",
    params: { viewerName: actor.name, roleShort: ROLES[actor.role].shortLabel, shopLabel: await shopLabel(service, entry.location_id), entryName: entry.name }, entry, actor,
  });
  return { secret, version: row.version, recorded: true };
}

/** Owner-level (9+) recovery of someone's PERSONAL entry: recorded, and the entry's owner is notified. */
export async function recoverPersonalSecret(service: SupabaseClient, actor: VaultServerActor, entryId: string, opts: { burst: boolean }, meta: VaultRequestMeta): Promise<RevealResult> {
  assertEnabled();
  if (actor.level < VAULT_OWNER_RECOVERY_LEVEL) throw new VaultError("forbidden", 403);
  const entry = await loadEntry(service, entryId);
  if (!entry || !entry.active || entry.kind !== "personal" || !entry.owner_id) throw new VaultError("entry_not_found", 404);
  if (entry.owner_id === actor.userId) throw new VaultError("forbidden", 403); // your own entry is a reveal, not a recovery
  const row = await currentVersion(service, entry.id);
  if (!row) return failClosed(service, actor, entry, null, "no_current_version", meta);
  const secret = await decryptRow(service, actor, entry, row, meta);
  await recordReveal(service, { entry, actor, kind: "owner_recovery", version: row.version, burst: opts.burst });
  await notifyManagement(service, {
    type: NOTIFICATION_TYPES.VAULT_RECOVERY, priority: "urgent", titleKey: "notifications.vault_recovery.title.owner", bodyKey: "notifications.vault_recovery.body",
    params: { actorName: actor.name, entryName: entry.name }, entry, actor, recipients: [entry.owner_id],
  });
  return { secret, version: row.version, recorded: true };
}

/** Level 8+ recovery of a SHARED entry's previous secret (inside the 30-day window): recorded + management notified. */
export async function recoverPreviousSecret(service: SupabaseClient, actor: VaultServerActor, entryId: string, opts: { burst: boolean }, meta: VaultRequestMeta): Promise<RevealResult> {
  assertEnabled();
  if (actor.level < VAULT_PREVIOUS_RECOVERY_LEVEL) throw new VaultError("forbidden", 403);
  const entry = await loadEntry(service, entryId);
  if (!entry || !entry.active || entry.kind !== "shared" || !canSeeSharedEntry(actor, access(entry))) throw new VaultError("entry_not_found", 404);
  const { data, error } = await service.from("vault_secrets").select(SECRET_COLS).eq("entry_id", entry.id)
    .not("superseded_at", "is", null).is("scrubbed_at", null)
    .gte("superseded_at", new Date(Date.now() - VAULT_PREVIOUS_SECRET_RETENTION_DAYS * 86_400_000).toISOString())
    .order("version", { ascending: false }).limit(1);
  if (error) throw new VaultError("write_failed", 500);
  const row = ((data ?? []) as SecretRow[]).find((r) => previousSecretRecoverable({ supersededAt: r.superseded_at, scrubbedAt: r.scrubbed_at }));
  if (!row) throw new VaultError("no_previous_secret", 404);
  const secret = await decryptRow(service, actor, entry, row, meta);
  await recordReveal(service, { entry, actor, kind: "previous_recovery", version: row.version, burst: opts.burst });
  await notifyManagement(service, {
    type: NOTIFICATION_TYPES.VAULT_RECOVERY, priority: "urgent", titleKey: "notifications.vault_recovery.title.previous", bodyKey: "notifications.vault_recovery.body",
    params: { actorName: actor.name, entryName: entry.name, shopLabel: await shopLabel(service, entry.location_id) }, entry, actor,
  });
  return { secret, version: row.version, recorded: true };
}

// ── Lifecycle (create / update / deactivate) ──────────────────────────────────────────────────

/** Encrypts for `version` and appends it through the definer RPC; the RPC refuses a stale version. */
async function writeSecret(service: SupabaseClient, actor: VaultServerActor, entry: EntryRow, version: number, plaintext: string, meta: VaultRequestMeta): Promise<number> {
  let key: Buffer;
  try {
    key = loadMasterKey();
  } catch (e) {
    return failClosed(service, actor, entry, version, e instanceof VaultCryptoError ? e.code : "master_key_invalid", meta);
  }
  const enc = encryptSecret(plaintext, key, secretAad(entry.id, version));
  const { data, error } = await service.rpc("vault_write_secret", {
    p_entry_id: entry.id, p_actor_id: actor.userId, p_version: version, p_ciphertext: enc.ciphertext, p_iv: enc.iv, p_tag: enc.tag,
    p_wrapped_key: enc.wrappedKey, p_key_iv: enc.keyIv, p_key_tag: enc.keyTag, p_master_key_id: MASTER_KEY_ID,
  });
  if (error) {
    if (error.message.includes("version_conflict")) throw new VaultError("version_conflict", 409);
    if (error.message.includes("entry_not_found")) throw new VaultError("entry_not_found", 404);
    throw new VaultError("write_failed", 500);
  }
  const written = (data as { version?: unknown } | null)?.version;
  if (written !== version) throw new VaultError("write_failed", 500);
  return version;
}

function lifecycleMetadata(entry: EntryRow, extra: Record<string, unknown>): Record<string, unknown> {
  // A shared entry is named (management reads the row); a personal entry is its id only.
  const base: Record<string, unknown> = { kind: entry.kind, entry_id: entry.id, entry_type: entry.entry_type };
  if (entry.kind === "shared") Object.assign(base, { name: entry.name, location_id: entry.location_id, min_level: entry.min_level });
  return { ...base, ...extra };
}

async function notifyChange(service: SupabaseClient, actor: VaultServerActor, entry: EntryRow, verb: "create" | "update" | "deactivate", body: { key: TranslationKey; changed?: string }): Promise<void> {
  if (entry.kind !== "shared") return;
  await notifyManagement(service, {
    type: NOTIFICATION_TYPES.VAULT_ENTRY_CHANGE, priority: "info", titleKey: `notifications.vault_entry_change.title.${verb}`, bodyKey: body.key,
    params: { actorName: actor.name, entryName: entry.name, shopLabel: await shopLabel(service, entry.location_id), changed: body.changed ?? "" }, entry, actor,
  });
}

export async function createVaultEntry(service: SupabaseClient, actor: VaultServerActor, input: VaultEntryInput, meta: VaultRequestMeta): Promise<VaultEntryView> {
  assertEnabled();
  if (!input.secret) throw new VaultError("invalid_payload", 400, "secret");
  if (input.kind === "shared") {
    if (input.minLevel === null) throw new VaultError("invalid_payload", 400, "minLevel");
    if (input.locationId !== null && !canAccessVaultLocation(actor, input.locationId)) throw new VaultError("location_access_denied", 403);
    if (!canCreateShared(actor, { locationId: input.locationId, minLevel: input.minLevel, entryType: input.entryType })) throw new VaultError("forbidden", 403);
  }
  const { data, error } = await service.from("vault_entries").insert({
    kind: input.kind, entry_type: input.entryType, name: input.name, username: input.username, url: input.url, notes: input.notes,
    location_id: input.kind === "shared" ? input.locationId : null, min_level: input.kind === "shared" ? input.minLevel : null,
    owner_id: input.kind === "personal" ? actor.userId : null, created_by: actor.userId,
  }).select(ENTRY_COLS).maybeSingle<EntryRow>();
  if (error || !data) throw new VaultError("write_failed", 500);
  const entry = data;
  try {
    await writeSecret(service, actor, entry, 1, input.secret, meta);
  } catch (e) {
    // An entry without a secret must not stay listed.
    await service.from("vault_entries").update({ active: false, deactivated_by: actor.userId, deactivated_at: new Date().toISOString() }).eq("id", entry.id);
    throw e;
  }
  await audit({
    actorId: actor.userId, actorRole: actor.role, action: "vault_entry.create", resourceTable: "vault_entries", resourceId: entry.id,
    metadata: lifecycleMetadata(entry, { secret_version: 1 }), ipAddress: meta.ipAddress, userAgent: meta.userAgent,
  });
  await notifyChange(service, actor, entry, "create", { key: "notifications.vault_entry_change.body.create" });
  return toView(entry, actor, new Set());
}

const EDITABLE: Array<[keyof VaultEntryInput, keyof EntryRow]> = [
  ["name", "name"], ["entryType", "entry_type"], ["username", "username"], ["url", "url"], ["notes", "notes"], ["locationId", "location_id"], ["minLevel", "min_level"],
];

export async function updateVaultEntry(service: SupabaseClient, actor: VaultServerActor, entryId: string, input: VaultEntryInput, meta: VaultRequestMeta): Promise<VaultEntryView> {
  assertEnabled();
  const entry = await loadEntry(service, entryId);
  if (!entry || !entry.active || !canRevealEntry(actor, access(entry))) throw new VaultError("entry_not_found", 404);
  if (!canManageEntry(actor, access(entry))) throw new VaultError("forbidden", 403);
  if (input.kind !== entry.kind) throw new VaultError("invalid_payload", 400, "kind");
  if (entry.kind === "shared") {
    if (input.minLevel === null) throw new VaultError("invalid_payload", 400, "minLevel");
    if (input.locationId !== null && !canAccessVaultLocation(actor, input.locationId)) throw new VaultError("location_access_denied", 403);
    if (!canCreateShared(actor, { locationId: input.locationId, minLevel: input.minLevel, entryType: input.entryType })) throw new VaultError("forbidden", 403);
  }
  const changed: string[] = [];
  const patch: Record<string, unknown> = {};
  for (const [inKey, col] of EDITABLE) {
    const next = input[inKey];
    if (next !== entry[col]) { changed.push(col); patch[col] = next; }
  }
  if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision ?? 0) < 1) throw new VaultError("invalid_payload", 400, "expectedRevision");
  if (input.expectedRevision !== entry.revision) throw new VaultError("version_conflict", 409);
  let secretVersion: number | null = null;
  let encrypted: EncryptedSecret | null = null;
  if (input.secret) {
    const current = await currentVersion(service, entry.id);
    secretVersion = (current?.version ?? 0) + 1;
    try {
      encrypted = encryptSecret(input.secret, loadMasterKey(), secretAad(entry.id, secretVersion));
    } catch (e) {
      return failClosed(service, actor, entry, secretVersion, e instanceof VaultCryptoError ? e.code : "master_key_invalid", meta);
    }
  }
  const { data, error } = await service.rpc("vault_update_entry", {
    p_entry_id: entry.id, p_actor_id: actor.userId, p_expected_revision: input.expectedRevision,
    p_patch: { ...patch, _audit: { ip_address: meta.ipAddress, user_agent: meta.userAgent } },
    p_version: secretVersion, p_envelope: encrypted,
  });
  if (error) {
    if (error.message.includes("version_conflict")) throw new VaultError("version_conflict", 409);
    if (error.message.includes("entry_not_found")) throw new VaultError("entry_not_found", 404);
    throw new VaultError("write_failed", 500);
  }
  const after = data as EntryRow | null;
  if (!after || after.id !== entry.id || after.revision !== entry.revision + 1) throw new VaultError("write_failed", 500);
  if (changed.length > 0 || secretVersion !== null) {
    // 0241 writes both audit actions inside the RPC transaction.
    await notifyChange(service, actor, after, "update", secretVersion !== null
      ? { key: "notifications.vault_entry_change.body.secret" }
      : { key: "notifications.vault_entry_change.body.metadata", changed: changed.join(", ") });
  }
  return toView(after, actor, new Set());
}

export async function deactivateVaultEntry(service: SupabaseClient, actor: VaultServerActor, entryId: string, meta: VaultRequestMeta): Promise<void> {
  assertEnabled();
  const entry = await loadEntry(service, entryId);
  if (!entry || !entry.active || !canRevealEntry(actor, access(entry))) throw new VaultError("entry_not_found", 404);
  if (!canManageEntry(actor, access(entry))) throw new VaultError("forbidden", 403);
  const { data, error } = await service.from("vault_entries").update({ active: false, deactivated_by: actor.userId, deactivated_at: new Date().toISOString() })
    .eq("id", entry.id).eq("active", true).select("id").maybeSingle<{ id: string }>();
  if (error || !data) throw new VaultError("write_failed", 500);
  await audit({
    actorId: actor.userId, actorRole: actor.role, action: "vault_entry.deactivate", resourceTable: "vault_entries", resourceId: entry.id,
    metadata: lifecycleMetadata(entry, {}), ipAddress: meta.ipAddress, userAgent: meta.userAgent,
  });
  await notifyChange(service, actor, entry, "deactivate", { key: "notifications.vault_entry_change.body.deactivate" });
}
