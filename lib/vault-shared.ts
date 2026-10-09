/**
 * Password vault — the PURE half (zero I/O, no server imports; safe in a client bundle).
 *
 * Spec: docs/superpowers/specs/2026-10-08-password-vault-design.md. The rules here are the
 * decisions; lib/vault.ts (server-only) applies them before any database work, and the
 * routes/page reuse them for display. Nothing in this module ever touches a secret.
 *
 * Floors (spec "Entries"): shared entries carry a role floor — KH+ (4), SL+ (5), AGM+ (6),
 * GM+ (7), level 8+, owner/cgs only (9). AI keys default to owner/cgs only.
 * Visibility (spec "Visibility and management"): shared entries at/above the viewer's level
 * and in their shops; level 8+ sees and manages every shop; a GM manages their own shop's
 * logins and codes; everyone manages their own personal entries.
 */
import { lockLocationContext } from "@/lib/locations";
import type { RoleCode } from "@/lib/roles";

export const VAULT_ENTRY_KINDS = ["shared", "personal"] as const;
export type VaultEntryKind = (typeof VAULT_ENTRY_KINDS)[number];

export const VAULT_ENTRY_TYPES = ["login", "code", "ai_key"] as const;
export type VaultEntryType = (typeof VAULT_ENTRY_TYPES)[number];

/** KH+ · SL+ · AGM+ · GM+ · Level 8+ · owner/cgs only. */
export const VAULT_ROLE_FLOORS = [4, 5, 6, 7, 8, 9] as const;
export type VaultRoleFloor = (typeof VAULT_ROLE_FLOORS)[number];

/** AI keys default to owner/cgs only (spec). */
export const VAULT_AI_KEY_DEFAULT_FLOOR: VaultRoleFloor = 9;
/** Level 8+ sees and manages every shop's entries, AI keys and both-shop entries. */
export const VAULT_MANAGE_ALL_LEVEL = 8;
/** A GM (7) adds/edits shared entries for their own shop. */
export const VAULT_SHARED_MANAGE_MIN = 7;
/** "Owner-level" recovery of a personal entry: owner (9) and cgs (10). */
export const VAULT_OWNER_RECOVERY_LEVEL = 9;
/** The previous secret is recoverable by level 8+. */
export const VAULT_PREVIOUS_RECOVERY_LEVEL = 8;

/** The revealed secret hides itself after this many seconds (spec: 30 s). */
export const VAULT_AUTO_HIDE_SECONDS = 30;
/** Reveal ATTEMPTS (PIN tries + reveals, shared + personal) allowed per user per hour-bucket. */
export const VAULT_REVEAL_HOURLY_CAP = 20;
/** From this many attempts in an hour the reveals are flagged as a burst; management is told once. */
export const VAULT_REVEAL_BURST_THRESHOLD = 10;
/** On change, the previous secret is kept this long (spec: 30 days). */
export const VAULT_PREVIOUS_SECRET_RETENTION_DAYS = 30;

export const VAULT_LIMITS = { name: 120, username: 200, url: 500, notes: 2000, secret: 4096 } as const;

export interface VaultActor {
  userId: string;
  role: RoleCode;
  level: number;
  /** UUIDs of the actor's assigned shops (from the verified session). */
  locations: string[];
}

/** The fields an access decision needs. Never a secret. */
export interface VaultEntryAccess {
  kind: VaultEntryKind;
  entryType: VaultEntryType;
  /** Shared only; null = both shops. Personal entries carry no shop. */
  locationId: string | null;
  /** Shared only. */
  minLevel: number | null;
  /** Personal only. */
  ownerId: string | null;
  active: boolean;
}

export type VaultErrorCode =
  | "not_enabled" | "invalid_payload" | "forbidden" | "location_access_denied" | "entry_not_found"
  | "reveal_cap" | "no_previous_secret" | "vault_unavailable" | "write_failed";

export class VaultError extends Error {
  constructor(public readonly code: VaultErrorCode, public readonly status: number, public readonly field?: string) {
    // The message is the code: a vault error never carries data (spec: nothing secret in errors).
    super(code);
    this.name = "VaultError";
  }
}

export function isVaultEntryType(v: unknown): v is VaultEntryType {
  return typeof v === "string" && (VAULT_ENTRY_TYPES as readonly string[]).includes(v);
}
export function isVaultRoleFloor(v: unknown): v is VaultRoleFloor {
  return typeof v === "number" && (VAULT_ROLE_FLOORS as readonly number[]).includes(v);
}

/** Level 8+ reaches every shop; a both-shop entry (null) is reachable by anyone; else the session bind. */
export function canAccessVaultLocation(actor: VaultActor, locationId: string | null): boolean {
  if (locationId === null) return true;
  if (actor.level >= VAULT_MANAGE_ALL_LEVEL) return true;
  return lockLocationContext({ role: actor.role, locations: actor.locations }, locationId);
}

/** List-visibility of a SHARED entry: active, at/above the floor, in an allowed shop. */
export function canSeeSharedEntry(actor: VaultActor, entry: VaultEntryAccess): boolean {
  if (entry.kind !== "shared" || !entry.active || entry.minLevel === null) return false;
  if (actor.level < entry.minLevel) return false;
  return canAccessVaultLocation(actor, entry.locationId);
}

/** Who may REVEAL: a shared entry by the floor+shop rule, a personal entry by its owner only. */
export function canRevealEntry(actor: VaultActor, entry: VaultEntryAccess): boolean {
  if (!entry.active) return false;
  if (entry.kind === "personal") return entry.ownerId === actor.userId;
  return canSeeSharedEntry(actor, entry);
}

/** Who may CREATE a shared entry with these attributes. */
export function canCreateShared(actor: VaultActor, target: { locationId: string | null; minLevel: number; entryType: VaultEntryType }): boolean {
  if (target.minLevel > actor.level) return false; // never a floor above your own level
  if (actor.level >= VAULT_MANAGE_ALL_LEVEL) return true;
  if (actor.level < VAULT_SHARED_MANAGE_MIN) return false;
  // A GM: own shop only, logins and codes only, never both-shop, never an AI key.
  if (target.entryType === "ai_key" || target.locationId === null) return false;
  return lockLocationContext({ role: actor.role, locations: actor.locations }, target.locationId);
}

/** Who may EDIT or DEACTIVATE an existing entry. */
export function canManageEntry(actor: VaultActor, entry: VaultEntryAccess): boolean {
  if (entry.kind === "personal") return entry.ownerId === actor.userId;
  if (entry.minLevel === null) return false;
  return canCreateShared(actor, { locationId: entry.locationId, minLevel: entry.minLevel, entryType: entry.entryType });
}

export interface RevealCapVerdict {
  /** False once the hour's attempts exceed the cap: the reveal is refused. */
  allowed: boolean;
  /** True from the burst threshold on; written on the reveal record. */
  burst: boolean;
  /** True exactly at the threshold crossing: management is told once per hour-bucket. */
  notifyBurst: boolean;
}

/** `attempts` is the count INCLUDING this attempt. */
export function revealCapVerdict(attempts: number): RevealCapVerdict {
  return {
    allowed: attempts <= VAULT_REVEAL_HOURLY_CAP,
    burst: attempts >= VAULT_REVEAL_BURST_THRESHOLD,
    notifyBurst: attempts === VAULT_REVEAL_BURST_THRESHOLD,
  };
}

/** A superseded, unscrubbed version inside the retention window. The current version is never "previous". */
export function previousSecretRecoverable(v: { supersededAt: string | null; scrubbedAt: string | null }, now: Date = new Date()): boolean {
  if (!v.supersededAt || v.scrubbedAt) return false;
  const superseded = Date.parse(v.supersededAt);
  if (Number.isNaN(superseded)) return false;
  return now.getTime() - superseded <= VAULT_PREVIOUS_SECRET_RETENTION_DAYS * 86_400_000;
}

export interface VaultEntryInput {
  kind: VaultEntryKind;
  name: string;
  entryType: VaultEntryType;
  username: string | null;
  /** Null only on an edit that keeps the current secret. */
  secret: string | null;
  url: string | null;
  notes: string | null;
  locationId: string | null;
  minLevel: VaultRoleFloor | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optionalText(raw: Record<string, unknown>, field: "username" | "url" | "notes", max: number): string | null {
  const v = raw[field];
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > max) throw new VaultError("invalid_payload", 400, field);
  return v;
}

/**
 * Narrows an untrusted body into a VaultEntryInput or throws invalid_payload naming the field.
 * Personal entries carry neither shop nor floor; shared entries carry a floor (AI keys default
 * to owner/cgs) and a shop or null for both.
 */
export function validateEntryInput(raw: Record<string, unknown>, opts: { requireSecret: boolean }): VaultEntryInput {
  const kind = raw.kind;
  if (kind !== "shared" && kind !== "personal") throw new VaultError("invalid_payload", 400, "kind");
  if (typeof raw.name !== "string") throw new VaultError("invalid_payload", 400, "name");
  const name = raw.name.trim();
  if (name.length < 1 || name.length > VAULT_LIMITS.name) throw new VaultError("invalid_payload", 400, "name");
  if (!isVaultEntryType(raw.entryType)) throw new VaultError("invalid_payload", 400, "entryType");
  const entryType = raw.entryType;
  const username = optionalText(raw, "username", VAULT_LIMITS.username);
  const url = optionalText(raw, "url", VAULT_LIMITS.url);
  if (url !== null && !/^https?:\/\/\S+$/i.test(url)) throw new VaultError("invalid_payload", 400, "url");
  const notes = optionalText(raw, "notes", VAULT_LIMITS.notes);

  let secret: string | null = null;
  if (raw.secret !== undefined && raw.secret !== null) {
    if (typeof raw.secret !== "string" || raw.secret.length < 1 || raw.secret.length > VAULT_LIMITS.secret) {
      throw new VaultError("invalid_payload", 400, "secret");
    }
    secret = raw.secret;
  } else if (opts.requireSecret) {
    throw new VaultError("invalid_payload", 400, "secret");
  }

  if (kind === "personal") {
    if (raw.locationId !== undefined && raw.locationId !== null) throw new VaultError("invalid_payload", 400, "locationId");
    if (raw.minLevel !== undefined && raw.minLevel !== null) throw new VaultError("invalid_payload", 400, "minLevel");
    return { kind, name, entryType, username, secret, url, notes, locationId: null, minLevel: null };
  }

  let locationId: string | null = null;
  if (raw.locationId !== undefined && raw.locationId !== null) {
    if (typeof raw.locationId !== "string" || !UUID.test(raw.locationId)) throw new VaultError("invalid_payload", 400, "locationId");
    locationId = raw.locationId;
  }
  let minLevel: VaultRoleFloor;
  if (raw.minLevel === undefined || raw.minLevel === null) {
    if (entryType !== "ai_key") throw new VaultError("invalid_payload", 400, "minLevel");
    minLevel = VAULT_AI_KEY_DEFAULT_FLOOR;
  } else if (isVaultRoleFloor(raw.minLevel)) {
    minLevel = raw.minLevel;
  } else {
    throw new VaultError("invalid_payload", 400, "minLevel");
  }
  return { kind, name, entryType, username, secret, url, notes, locationId, minLevel };
}
