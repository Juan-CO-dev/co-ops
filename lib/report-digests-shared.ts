/**
 * Report digests — the PURE core (zero I/O; client-safe). Recipient resolution, the ET schedule
 * and the due / watch decisions for the three digests (Reports hub v2 piece 2 + the catering
 * morning digest, GO 2026-10-07). I/O lives in lib/report-digests.ts.
 *
 * SCHEDULING LIVES HERE, IN ONE PLACE. Vercel is on Hobby (CC answers 2026-10-07), so there is no
 * dedicated cron: the desktop pinger calls /api/cron/digest-tick every 10 minutes inside
 * DIGEST_TICK_WINDOW (03:00-22:00 ET), and every decision below is a pure function of `now` plus
 * the report_settings row. A dedicated cron later is one line in vercel.json pointing at the same
 * runner; nothing here changes.
 */
import { ROLES, isRoleCode } from "@/lib/roles";
import type { Language } from "@/lib/i18n/types";

export type DigestKind = "gm_shop" | "unified" | "catering";
export const DIGEST_KINDS: readonly DigestKind[] = ["gm_shop", "unified", "catering"];

export type DigestSkipReason =
  | "no_email" | "inactive" | "recipient_disabled" | "no_locations"
  | "already_sent" | "not_due" | "shop_not_finalized" | "out_of_scope";

export type DigestDeliveryMode = "off" | "preview" | "live";
export const DIGEST_DELIVERY_MODES: readonly DigestDeliveryMode[] = ["off", "preview", "live"];

/** Level at and above which a user gets the unified digest and the all-shops catering digest. */
export const DIGEST_ALL_SHOPS_LEVEL = 8;
/** A subscription flag never grants a role what it may not read: the floor for each flag. */
export const SHOP_DIGEST_FLAG_MIN = 6;    // AGM and up (Q2's "add an AGM via the override row")
export const CATERING_DIGEST_FLAG_MIN = 5; // PIPELINE_READ_MIN — shift lead+ may view the pipeline

/** The pinger window for digest-tick (ET hours). Starts at 03:00 so the unified fallback runs. */
export const DIGEST_TICK_WINDOW = { startHourET: 3, endHourET: 22 } as const;
/** A claim older than this that never became sent|failed is a dead function; free the key. */
export const DIGEST_STALE_CLAIM_MINUTES = 15;
/**
 * Resend keeps an Idempotency-Key for 24 h. An ambiguous attempt is retried with the SAME key only
 * while now - first_attempt_at < 23 h (an hour of margin); after that it is never resent
 * automatically (failed_ambiguous + alert).
 */
export const AMBIGUOUS_RETRY_HOURS = 23;

// ── Settings ────────────────────────────────────────────────────────────────────────────────

export interface DigestSettings {
  mode: DigestDeliveryMode;
  cateringTimeEt: string;        // "HH:MM"
  unifiedFallbackTimeEt: string; // "HH:MM"
  graceMinutes: number;
}

/** Matches the 0220 seed. The mode is OFF until CC/Juan turn it on. */
export const DEFAULT_DIGEST_SETTINGS: DigestSettings = {
  mode: "off", cateringTimeEt: "07:00", unifiedFallbackTimeEt: "03:00", graceMinutes: 60,
};

/** "HH:MM" (24h) → minutes after midnight, or null when malformed. */
export function parseHhMm(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function isDeliveryMode(value: unknown): value is DigestDeliveryMode {
  return typeof value === "string" && (DIGEST_DELIVERY_MODES as readonly string[]).includes(value);
}

/** A malformed or missing row falls back to the default for THAT key only (never throws). */
export function parseDigestSettings(rows: ReadonlyArray<{ key: string; value: unknown }>): DigestSettings {
  const out = { ...DEFAULT_DIGEST_SETTINGS };
  for (const { key, value } of rows) {
    if (key === "digest_delivery_mode" && isDeliveryMode(value)) out.mode = value;
    if (key === "catering_digest_time_et" && parseHhMm(value) !== null) out.cateringTimeEt = value as string;
    if (key === "unified_fallback_time_et" && parseHhMm(value) !== null) out.unifiedFallbackTimeEt = value as string;
    if (key === "digest_watch_grace_minutes" && typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 720) out.graceMinutes = value;
  }
  return out;
}

// ── Eastern time ────────────────────────────────────────────────────────────────────────────

const eastern = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function parts(at: Date): Record<string, string> {
  return Object.fromEntries(eastern.formatToParts(at).map(({ type, value }) => [type, value]));
}

/** The ET calendar day and minutes-after-midnight of an instant. */
export function etClock(now: Date): { day: string; minutes: number } {
  const p = parts(now);
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** The UTC instant of ET wall time `minutes` on `day` (DST-correct; a skipped wall time lands just after the gap). */
export function etWallTime(day: string, minutes: number): Date {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  const target = Date.parse(`${day}T${hh}:${mm}:00Z`);
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(instant));
    const wall = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    instant += target - wall;
  }
  return new Date(instant);
}

/**
 * The UTC instants [start, endExclusive) of one ET calendar day, from TWO independent Eastern
 * midnights — 23 h on the spring-forward day, 25 h on the fall-back day (Astra P2: midnight + 24 h
 * misbuckets an hour on both transition days).
 */
export function etDayRange(day: string): { startIso: string; endExclusiveIso: string } {
  return { startIso: etWallTime(day, 0).toISOString(), endExclusiveIso: etWallTime(addDays(day, 1), 0).toISOString() };
}

// ── Due decisions ───────────────────────────────────────────────────────────────────────────

/** When the unified fallback for business day `day` becomes due: (day + 1) at the fallback time. */
export function unifiedFallbackAt(day: string, settings: DigestSettings): Date {
  return etWallTime(addDays(day, 1), parseHhMm(settings.unifiedFallbackTimeEt) ?? 180);
}

export interface UnifiedDecision { due: boolean; reason: "all_finalized" | "fallback" | "waiting"; missing: string[] }

/**
 * The unified digest for `day` goes out when the LAST active shop finalizes its closing; failing
 * that, at the fallback time it goes out anyway and names each unfinalized shop (spec: "silence
 * never means all good").
 */
export function decideUnified(args: {
  day: string; activeLocationIds: readonly string[]; finalizedLocationIds: ReadonlySet<string>;
  now: Date; settings: DigestSettings;
}): UnifiedDecision {
  const missing = args.activeLocationIds.filter((id) => !args.finalizedLocationIds.has(id));
  if (missing.length === 0 && args.activeLocationIds.length > 0) return { due: true, reason: "all_finalized", missing };
  if (args.now.getTime() >= unifiedFallbackAt(args.day, args.settings).getTime()) return { due: true, reason: "fallback", missing };
  return { due: false, reason: "waiting", missing };
}

/** The catering digest for today is due once ET wall time reaches the setting. */
export function decideCatering(now: Date, settings: DigestSettings): { due: boolean; day: string } {
  const { day, minutes } = etClock(now);
  return { due: minutes >= (parseHhMm(settings.cateringTimeEt) ?? 420), day };
}

/** The business days a tick looks at: yesterday and today (ET). Older days belong to digest-watch. */
export function tickBusinessDays(now: Date): string[] {
  const { day } = etClock(now);
  return [addDays(day, -1), day];
}

/**
 * Digest-watch: the instant after which every expected recipient of (kind, day) must have a sent
 * or skipped row. Per-shop and unified share the unified fallback (+ grace); catering is its own
 * time (+ grace) on the day itself.
 */
export function digestWatchAt(kind: DigestKind, day: string, settings: DigestSettings): Date {
  const base = kind === "catering"
    ? etWallTime(day, parseHhMm(settings.cateringTimeEt) ?? 420)
    : unifiedFallbackAt(day, settings);
  return new Date(base.getTime() + settings.graceMinutes * 60_000);
}

export interface SendLogRow {
  recipient_ref: string; kind: string; business_day: string; location_id: string | null;
  revision: number; mode: string; outcome: string; skip_reason: string | null; attempted_at: string;
  /** Present on rows read from the database (the engine needs them to resume / reconcile). */
  id?: string;
  /** Set immediately before the first provider call; null = never reached the provider. */
  first_attempt_at?: string | null;
  /** Persisted the moment the provider accepted, before the row was finished. */
  provider_message_id?: string | null;
}

/** Expected (ref, location) pairs with no sent|skipped row = what digest-watch alerts on. */
export function missingDeliveries(
  expected: ReadonlyArray<{ ref: string; locationId: string | null }>,
  log: readonly SendLogRow[],
  mode: "preview" | "live",
): Array<{ ref: string; locationId: string | null }> {
  // A contention skip (already_sent: the LOSER of a claim race) proves nothing about delivery —
  // only the winner's own row does, so it never satisfies the watch (Astra P2).
  const done = new Set(log.filter((r) => r.mode === mode && (r.outcome === "sent" || (r.outcome === "skipped" && r.skip_reason !== "already_sent")))
    .map((r) => `${r.recipient_ref}|${r.location_id ?? ""}`));
  return expected.filter((e) => !done.has(`${e.ref}|${e.locationId ?? ""}`));
}

export function isStaleClaim(row: Pick<SendLogRow, "outcome" | "attempted_at">, now: Date): boolean {
  return row.outcome === "claimed" && now.getTime() - Date.parse(row.attempted_at) > DIGEST_STALE_CLAIM_MINUTES * 60_000;
}

// ── Recipients ──────────────────────────────────────────────────────────────────────────────

export interface DirectoryUser { id: string; name: string; email: string | null; role: string; language: string | null; active: boolean }
export interface DirectoryMembership { userId: string; locationId: string }
export interface RecipientOverride {
  id: string; kind: "internal" | "external"; userId: string | null; email: string | null; displayName: string;
  active: boolean; cateringDigest: boolean; shopDigest: boolean; locationIds: string[] | null;
}
export interface DigestDirectory {
  users: readonly DirectoryUser[];
  memberships: readonly DirectoryMembership[];
  overrides: readonly RecipientOverride[];
  /** Active locations only. */
  locationIds: readonly string[];
}

export interface ResolvedRecipient {
  ref: string;               // "user:<uuid>"
  userId: string;
  name: string;
  email: string | null;
  language: Language;
  /** The shops this person's digest covers (per-shop: one digest per entry). */
  locationIds: string[];
  /** Why this person gets nothing today (logged as a skipped row), or null = send. */
  skip: DigestSkipReason | null;
  /** Covers every active shop (also sees leads with no shop set in the catering digest). */
  allShops: boolean;
  /**
   * May see customer delivery addresses in the catering digest: the catering manager and level 8+
   * only (GO addendum 10-08). Set for the catering kind; absent = no.
   */
  addressAccess?: boolean;
}

export function roleLevel(role: string): number {
  return isRoleCode(role) ? ROLES[role].level : -1;
}

/**
 * Who gets which digest (plan §4, CC answers Q2):
 *   gm_shop  — role gm → each of THEIR shops; an internal override with shop_digest → its shops.
 *   unified  — every active user level ≥ 8 → all shops.
 *   catering — level ≥ 8 → all shops; gm → own shops; catering_mgr (Keith) → memberships, else all
 *              (mirrors resolveCateringManager's fallback); override catering_digest → its shops.
 * An internal override with location_ids set narrows/widens the shops (not for unified); an
 * override with active=false switches every digest off for that person (recipient_disabled).
 * External rows never receive a digest (packages only, PR2).
 */
export function resolveDigestRecipients(kind: DigestKind, dir: DigestDirectory): ResolvedRecipient[] {
  const active = new Set(dir.locationIds);
  const all = [...dir.locationIds];
  const memberships = new Map<string, string[]>();
  for (const m of dir.memberships) {
    if (!active.has(m.locationId)) continue;
    const list = memberships.get(m.userId) ?? [];
    if (!list.includes(m.locationId)) list.push(m.locationId);
    memberships.set(m.userId, list);
  }
  const overrides = new Map<string, RecipientOverride>();
  for (const o of dir.overrides) if (o.kind === "internal" && o.userId) overrides.set(o.userId, o);

  const out: ResolvedRecipient[] = [];
  for (const u of dir.users) {
    const ov = overrides.get(u.id);
    const flagged = !!ov && ((kind === "catering" && ov.cateringDigest) || (kind === "gm_shop" && ov.shopDigest));
    if (!u.active) {
      // Only an explicit override names an inactive person; role-derived inactive users are simply gone.
      if (flagged) out.push(base(u, [], "inactive", false));
      continue;
    }
    const level = roleLevel(u.role);
    const mem = memberships.get(u.id) ?? [];
    const scope = authorizedScope(kind, u.role, level, mem, all, flagged);
    if (scope === null) {
      // A flag on a role that may not read this digest grants nothing; it is logged, never sent.
      if (flagged) out.push(base(u, [], "out_of_scope", false));
      continue;
    }
    // Overrides only ever NARROW: requested shops are intersected with the recipient's OWN
    // authorized scope at send time (Astra P1: an admin's reach is not the recipient's).
    const requested = ov?.locationIds && kind !== "unified" ? ov.locationIds.filter((id) => active.has(id)) : scope;
    const shops = requested.filter((id) => scope.includes(id));
    const allShops = all.length > 0 && all.every((id) => shops.includes(id));
    const skip: DigestSkipReason | null =
      ov && !ov.active ? "recipient_disabled"
        : !normEmail(u.email) ? "no_email"
          : shops.length === 0 && requested.length > 0 ? "out_of_scope"
            : shops.length === 0 ? "no_locations"
              : null;
    const r = base(u, sortLike(shops, all), skip, allShops);
    if (kind === "catering" && (level >= DIGEST_ALL_SHOPS_LEVEL || u.role === "catering_mgr")) r.addressAccess = true;
    out.push(r);
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref));
}

/**
 * The shops a person may receive for a digest kind, from their ROLE and MEMBERSHIPS alone —
 * independent of any subscription flag. null = not eligible for this kind at all.
 *   gm_shop  — role gm, or the shop_digest flag at level ≥ 6; level ≥ 8 → all shops, else memberships.
 *   unified  — level ≥ 8 → all shops.
 *   catering — level ≥ 8 → all; gm → memberships; catering_mgr (Keith) → memberships, else all
 *              (resolveCateringManager's fallback); the catering_digest flag at level ≥ 5 → memberships.
 */
export function authorizedScope(kind: DigestKind, role: string, level: number, memberships: readonly string[], all: readonly string[], flagged: boolean): string[] | null {
  switch (kind) {
    case "unified":
      return level >= DIGEST_ALL_SHOPS_LEVEL ? [...all] : null;
    case "gm_shop":
      if (role !== "gm" && !(flagged && level >= SHOP_DIGEST_FLAG_MIN)) return null;
      return level >= DIGEST_ALL_SHOPS_LEVEL ? [...all] : [...memberships];
    case "catering":
      if (level >= DIGEST_ALL_SHOPS_LEVEL) return [...all];
      if (role === "gm") return [...memberships];
      if (role === "catering_mgr") return memberships.length > 0 ? [...memberships] : [...all];
      if (flagged && level >= CATERING_DIGEST_FLAG_MIN) return [...memberships];
      return null;
  }
}

function base(u: DirectoryUser, locationIds: string[], skip: DigestSkipReason | null, allShops: boolean): ResolvedRecipient {
  return {
    ref: `user:${u.id}`, userId: u.id, name: u.name, email: normEmail(u.email), language: u.language === "es" ? "es" : "en",
    locationIds, skip, allShops,
  };
}

export function normEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/** Keep the active-locations order so digests list shops the same way for everyone. */
function sortLike(ids: readonly string[], order: readonly string[]): string[] {
  return [...new Set(ids)].sort((x, y) => order.indexOf(x) - order.indexOf(y));
}

/** The (ref, location) pairs a kind expects for a day: per shop for gm_shop, one row otherwise. */
export function expectedDeliveries(kind: DigestKind, recipients: readonly ResolvedRecipient[]): Array<{ ref: string; locationId: string | null }> {
  return recipients.flatMap((r): Array<{ ref: string; locationId: string | null }> => kind === "gm_shop"
    ? r.locationIds.map((locationId) => ({ ref: r.ref, locationId }))
    : [{ ref: r.ref, locationId: null }]);
}
