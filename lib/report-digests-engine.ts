/**
 * Report digests — the ORCHESTRATION (no direct I/O: everything goes through DigestIO, which
 * lib/report-digests.ts builds over the service-role client, Resend and the audit log). Kept apart
 * so the idempotency, fallback and watch behaviour is unit-testable against an in-memory store.
 *
 * THE IDEMPOTENCY LAW. One digest per recipient × kind × business day × revision × mode, enforced
 * by 0220's partial unique index, not by reasoning: sendOnce INSERTs a 'claimed' row first; the
 * loser of a double cron fire / retry gets "duplicate" and logs skipped/already_sent.
 *
 * SEND-ONCE ACROSS THE PROVIDER'S 24 h KEY WINDOW (Astra r2 P1, CC ruling r3). Resend keeps an
 * Idempotency-Key for only 24 h, so the key alone cannot stop a late retry from sending twice.
 * The send log therefore carries the provider outcome itself:
 *   1. first_attempt_at + idempotency_key are written BEFORE the provider is called. A claim without
 *      them never reached the provider, and only such a claim may be released by the stale sweep.
 *   2. When the provider ACCEPTS, provider_message_id + sent_at are written as their own update,
 *      and only then is the row finished. A row with a provider_message_id is NEVER resent: if the
 *      finish failed, the sweep reconciles it to sent.
 *   3. A timeout / transport error / no response is AMBIGUOUS: the row keeps the key as
 *      'ambiguous' and is retried with the SAME key only while now - first_attempt_at < 23 h. After
 *      that it becomes 'failed_ambiguous' — never resent automatically — and digest-watch alerts.
 *   4. A definitive provider refusal is 'failed': it releases the key, and the next tick retries.
 */
import {
  AMBIGUOUS_RETRY_HOURS,
  DIGEST_KINDS,
  DIGEST_STALE_CLAIM_MINUTES,
  decideCatering,
  decideUnified,
  digestWatchAt,
  etClock,
  addDays,
  expectedDeliveries,
  missingDeliveries,
  resolveDigestRecipients,
  tickBusinessDays,
  unifiedFallbackAt,
  type DigestDirectory,
  type DigestKind,
  type DigestSettings,
  type DigestSkipReason,
  type ResolvedRecipient,
  type SendLogRow,
} from "@/lib/report-digests-shared";
import {
  renderCateringDigest,
  renderShopDigest,
  renderUnifiedDigest,
  type CateringFacts,
  type Envelope,
  type ShopDayFacts,
} from "@/lib/report-digests-compose";
import {
  PACKAGE_KINDS,
  packageKindFor,
  periodicPackageDue,
  resolvePackageRecipients,
  type ComposedSend,
  type EmailAttachment,
  type PackageIO,
  type PackageKind,
  type PackageRecipientRow,
} from "@/lib/report-package-shared";
import type { PackageCadence } from "@/lib/report-recipients-shared";
export type { ComposedSend, EmailAttachment, PackageIO };

/** Everything the send log keys: the three digests and (exports PR) the three package cadences. */
export type SendKind = DigestKind | PackageKind;

export type DeliveryMode = "preview" | "live";

export interface ClaimRow {
  kind: SendKind; business_day: string; recipient_ref: string; location_id: string | null;
  revision: number; mode: DeliveryMode;
}

export type SendOutcome = "claimed" | "sent" | "failed" | "ambiguous" | "failed_ambiguous";

export interface SendStore {
  /** INSERT outcome='claimed'. "duplicate" = the unique index refused it (23505). Throws on any other error. */
  claim(row: ClaimRow): Promise<{ id: string } | "duplicate">;
  /** Recorded immediately BEFORE the first provider call (guarded: outcome claimed, no attempt yet). */
  markAttempt(id: string, patch: { first_attempt_at: string; idempotency_key: string }): Promise<boolean>;
  /** The provider accepted: its OWN write, before finish (guarded: outcome claimed | ambiguous). */
  recordAccepted(id: string, patch: { provider_message_id: string; sent_at: string }): Promise<boolean>;
  /** Transition, guarded on the row's current outcome being one of `from`. false = not transitioned. */
  finish(id: string, from: SendOutcome[], patch: { outcome: Exclude<SendOutcome, "claimed">; error?: string | null; content_sha?: string | null }): Promise<boolean>;
  skip(row: ClaimRow & { skip_reason: DigestSkipReason }): Promise<void>;
}

export interface DigestAlert {
  kind: SendKind | "all"; day: string; detector: "digest-watch" | "digest-send" | "digest-preview";
  missing?: string[]; error?: string; ref?: string;
}

export interface DigestIO {
  now: Date;
  baseUrl: string;
  /**
   * Where preview mode delivers every digest: Juan's OWN account email, resolved from the users
   * table (the single active CGS). null = unresolvable → preview FAILS CLOSED (nothing is sent).
   * No env-var fallback (Astra P2: an alert address is not an identity).
   */
  previewRecipient(): Promise<string | null>;
  settings(): Promise<DigestSettings>;
  directory(): Promise<{ dir: DigestDirectory; locations: Array<{ id: string; name: string }> }>;
  /** Every send-log row for these business days, including id / first_attempt_at / provider_message_id. */
  sendLog(days: string[]): Promise<SendLogRow[]>;
  /** day → set of location ids whose closing is finalized (confirmed | incomplete_confirmed | auto_finalized). */
  finalizedClosings(days: string[]): Promise<Map<string, Set<string>>>;
  shopFacts(location: { id: string; name: string }, day: string): Promise<ShopDayFacts>;
  cateringFacts(today: string): Promise<CateringFacts>;
  store: SendStore;
  /** idempotencyKey is passed to the provider (Resend Idempotency-Key, kept 24 h by the provider). */
  sendEmail(input: { to: string; subject: string; html: string; text: string; idempotencyKey: string; attachments?: EmailAttachment[] }): Promise<{ id: string } | { error: string; code?: string }>;
  sha(content: string): string;
  /** Ops alert, claimed once per detector × kind × ET day. true = this call sent it. Never throws. */
  alert(a: DigestAlert): Promise<boolean>;
  /** Exports PR: the scheduled CSV/PDF package, sent through THIS engine's send-once path. Absent = no package sends. */
  packages?: PackageIO;
  /** One digest.run audit row. Never throws. */
  recordRun(summary: DigestRunSummary): Promise<void>;
}

export interface KindCounts { sent: number; skipped: number; failed: number; ambiguous: number }
export interface DigestRunSummary {
  trigger: "tick" | "closing";
  mode: DeliveryMode | "off";
  counts: Record<SendKind, KindCounts>;
  /** Claims released by the sweep (they never reached the provider). */
  staleClaims: number;
  /** Claims with a recorded provider_message_id reconciled to sent by the sweep (no resend). */
  reconciled: number;
  /** Ambiguous claims past the 23 h window, frozen as failed_ambiguous and alerted. */
  ambiguousExpired: number;
  alerts: number;
}

/**
 * The provider idempotency key: one email per recipient × kind × business day × revision (plus the
 * delivery mode and, for a per-shop digest, the shop — each is a different email by design).
 */
export function digestIdempotencyKey(row: ClaimRow): string {
  return ["co-digest", row.mode, row.kind, row.business_day, `r${row.revision}`, row.recipient_ref, row.location_id ?? "all"].join("/");
}

/**
 * Was the provider's answer definitive? Resend answering with a named error is a refusal — EXCEPT
 * the ones that do not prove the email was not sent (a concurrent request on the same key, or a
 * provider-side 5xx). A transport error, a timeout or a missing id carries no code: ambiguous.
 */
const AMBIGUOUS_CODES = new Set(["concurrent_idempotent_requests", "application_error", "internal_server_error"]);
export function classifyProviderResult(res: { id: string } | { error: string; code?: string }): "accepted" | "reconcile" | "refused" | "ambiguous" {
  if (!("error" in res)) return res.id ? "accepted" : "ambiguous";
  if (res.code === "invalid_idempotent_request") return "reconcile";
  if (!res.code || AMBIGUOUS_CODES.has(res.code)) return "ambiguous";
  return "refused";
}

function emptyCounts(): Record<SendKind, KindCounts> {
  const c = () => ({ sent: 0, skipped: 0, failed: 0, ambiguous: 0 });
  return { gm_shop: c(), unified: c(), catering: c(), package_daily: c(), package_weekly: c(), package_monthly: c() };
}

const HOUR = 3_600_000;

class Run {
  readonly summary: DigestRunSummary;
  private readonly log: SendLogRow[];
  private readonly facts = new Map<string, Promise<ShopDayFacts>>();

  constructor(
    readonly io: DigestIO,
    readonly previewTo: string | null,
    readonly settings: DigestSettings,
    readonly mode: DeliveryMode,
    readonly dir: DigestDirectory,
    readonly locations: Array<{ id: string; name: string }>,
    log: SendLogRow[],
    trigger: "tick" | "closing",
  ) {
    this.log = [...log];
    this.summary = { trigger, mode, counts: emptyCounts(), staleClaims: 0, reconciled: 0, ambiguousExpired: 0, alerts: 0 };
  }

  get didWork(): boolean {
    return this.summary.alerts > 0 || this.summary.staleClaims > 0 || this.summary.reconciled > 0 || this.summary.ambiguousExpired > 0 ||
      [...DIGEST_KINDS, ...PACKAGE_KINDS].some((k) => { const c = this.summary.counts[k]; return c.sent + c.skipped + c.failed + c.ambiguous > 0; });
  }

  logFor(kind: SendKind, day: string): SendLogRow[] {
    return this.log.filter((r) => r.kind === kind && r.business_day === day && r.mode === this.mode);
  }

  private rowsFor(kind: SendKind, day: string, ref: string, locationId: string | null): SendLogRow[] {
    return this.logFor(kind, day).filter((r) => r.recipient_ref === ref && (r.location_id ?? null) === locationId && r.revision === 1);
  }

  /** Sent, in flight, or frozen for a human: never touched again automatically. */
  private settled(kind: SendKind, day: string, ref: string, locationId: string | null): boolean {
    return this.rowsFor(kind, day, ref, locationId).some((r) => r.outcome === "sent" || r.outcome === "claimed" || r.outcome === "failed_ambiguous");
  }

  /** An ambiguous attempt still inside the 23 h same-key retry window. */
  private retryable(kind: SendKind, day: string, ref: string, locationId: string | null): SendLogRow | undefined {
    return this.rowsFor(kind, day, ref, locationId).find((r) => r.outcome === "ambiguous" && !!r.id && !!r.first_attempt_at &&
      this.io.now.getTime() - Date.parse(r.first_attempt_at) < AMBIGUOUS_RETRY_HOURS * HOUR);
  }

  private skippedAlready(kind: SendKind, day: string, ref: string, locationId: string | null, reason: DigestSkipReason): boolean {
    return this.rowsFor(kind, day, ref, locationId).some((r) => r.outcome === "skipped" && r.skip_reason === reason);
  }

  private push(row: ClaimRow, outcome: string, extra: Partial<SendLogRow> = {}): SendLogRow {
    const entry: SendLogRow = { ...row, outcome, skip_reason: null, attempted_at: this.io.now.toISOString(), ...extra };
    this.log.push(entry);
    return entry;
  }

  shopFacts(location: { id: string; name: string }, day: string): Promise<ShopDayFacts> {
    const key = `${location.id}|${day}`;
    let p = this.facts.get(key);
    if (!p) { p = this.io.shopFacts(location, day); this.facts.set(key, p); }
    return p;
  }

  /**
   * The sweep, BEFORE any send (every mode, every loaded day):
   *   claimed + provider_message_id           → sent (reconciled; the provider accepted it — never resend)
   *   claimed, stale, no attempt recorded      → failed/stale_claim (never reached the provider: key released)
   *   claimed, stale, attempt recorded         → ambiguous (outcome unknown: keep the key)
   *   ambiguous, first_attempt_at ≥ 23 h ago   → failed_ambiguous + digest-watch alert (a human decides)
   */
  async sweep(): Promise<void> {
    const now = this.io.now.getTime();
    for (const r of this.log) {
      if (!r.id) continue;
      if (r.outcome === "claimed" && r.provider_message_id) {
        if (await this.io.store.finish(r.id, ["claimed"], { outcome: "sent", error: "reconciled: provider accepted (message id recorded before finish)" })) {
          r.outcome = "sent"; this.summary.reconciled++;
        }
        continue;
      }
      const stale = r.outcome === "claimed" && now - Date.parse(r.attempted_at) > DIGEST_STALE_CLAIM_MINUTES * 60_000;
      if (stale && !r.first_attempt_at) {
        if (await this.io.store.finish(r.id, ["claimed"], { outcome: "failed", error: "stale_claim" })) {
          r.outcome = "failed"; this.summary.staleClaims++;
        }
        continue;
      }
      if (stale && r.first_attempt_at) {
        if (await this.io.store.finish(r.id, ["claimed"], { outcome: "ambiguous", error: "stale_claim_after_attempt" })) r.outcome = "ambiguous";
      }
      if (r.outcome === "ambiguous" && r.first_attempt_at && now - Date.parse(r.first_attempt_at) >= AMBIGUOUS_RETRY_HOURS * HOUR) {
        if (await this.io.store.finish(r.id, ["ambiguous"], { outcome: "failed_ambiguous", error: "ambiguous_past_provider_key_window" })) {
          r.outcome = "failed_ambiguous"; this.summary.ambiguousExpired++;
          if (await this.io.alert({ kind: r.kind as SendKind, day: r.business_day, detector: "digest-watch", ref: r.recipient_ref, error: "failed_ambiguous: delivery unknown after 23 h; not resent — decide by hand" })) this.summary.alerts++;
        }
      }
    }
  }

  /** Log a deliberate non-send once per (recipient, kind, day, location, reason). */
  async skip(kind: SendKind, day: string, r: ResolvedRecipient, locationId: string | null, reason: DigestSkipReason): Promise<void> {
    if (this.settled(kind, day, r.ref, locationId) || this.retryable(kind, day, r.ref, locationId) || this.skippedAlready(kind, day, r.ref, locationId, reason)) return;
    const row: ClaimRow = { kind, business_day: day, recipient_ref: r.ref, location_id: locationId, revision: 1, mode: this.mode };
    await this.io.store.skip({ ...row, skip_reason: reason });
    this.push(row, "skipped", { skip_reason: reason });
    this.summary.counts[kind].skipped++;
  }

  /** Claim (or resume an ambiguous claim) → compose → record attempt → send → record. Never throws for a send problem. */
  async sendOnce(kind: SendKind, day: string, r: ResolvedRecipient, locationId: string | null, compose: (env: Envelope) => Promise<ComposedSend> | ComposedSend): Promise<"sent" | "skipped" | "failed" | "ambiguous" | "not_due"> {
    if (this.settled(kind, day, r.ref, locationId)) return "not_due";
    const resumed = this.retryable(kind, day, r.ref, locationId);
    if (!resumed && r.skip) { await this.skip(kind, day, r, locationId, r.skip); return "skipped"; }
    const row: ClaimRow = { kind, business_day: day, recipient_ref: r.ref, location_id: locationId, revision: 1, mode: this.mode };
    const key = digestIdempotencyKey(row);
    let entry: SendLogRow;
    if (resumed) {
      entry = resumed;
    } else {
      const claim = await this.io.store.claim(row);
      if (claim === "duplicate") {
        // Someone else (a double fire, the closing hook) owns this send. Logged, never re-sent.
        await this.io.store.skip({ ...row, skip_reason: "already_sent" });
        this.push(row, "skipped", { skip_reason: "already_sent" });
        this.summary.counts[kind].skipped++;
        return "skipped";
      }
      entry = this.push(row, "claimed", { id: claim.id });
    }
    const id = entry.id!;
    const from: SendOutcome[] = resumed ? ["ambiguous"] : ["claimed"];
    const alertSend = async (error: string) => {
      if (await this.io.alert({ kind, day, detector: "digest-send", ref: r.ref, error: error.slice(0, 300) })) this.summary.alerts++;
    };

    // Compose BEFORE the attempt is recorded: a compose failure never reached the provider.
    let mail: ComposedSend;
    try {
      const env: Envelope = { language: r.language, baseUrl: this.io.baseUrl, previewFor: this.mode === "preview" ? { name: r.name, email: r.email } : null };
      mail = await compose(env);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!resumed && await this.io.store.finish(id, from, { outcome: "failed", error: `compose: ${msg}`.slice(0, 500) })) {
        entry.outcome = "failed"; this.summary.counts[kind].failed++;
      }
      await alertSend(`compose: ${msg}`);
      return resumed ? "ambiguous" : "failed";
    }
    const sha = this.io.sha(mail.html);

    if (!resumed) {
      // Rule 1: the attempt is on the row BEFORE the provider sees it. No record → no send.
      let marked = false;
      const at = this.io.now.toISOString();
      try { marked = await this.io.store.markAttempt(id, { first_attempt_at: at, idempotency_key: key }); } catch { marked = false; }
      if (!marked) {
        await alertSend("attempt_unrecorded: not sent; the claim is released by the stale sweep");
        return "failed";
      }
      entry.first_attempt_at = at;
    }

    const to = this.mode === "preview" ? this.previewTo! : r.email!;
    let res: { id: string } | { error: string; code?: string };
    try {
      res = await this.io.sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: key, ...(mail.attachments ? { attachments: mail.attachments } : {}) });
    } catch (e) {
      res = { error: e instanceof Error ? e.message : String(e) };
    }
    const verdict = classifyProviderResult(res);

    if (verdict === "accepted" || verdict === "reconcile") {
      if (verdict === "accepted") {
        // Rule 2: the provider's id is persisted FIRST, on its own. From here this claim is never resent.
        const messageId = (res as { id: string }).id;
        try {
          if (await this.io.store.recordAccepted(id, { provider_message_id: messageId, sent_at: this.io.now.toISOString() })) entry.provider_message_id = messageId;
        } catch { /* the finish below, or the sweep, settles it */ }
      }
      let finished = false;
      try {
        finished = await this.io.store.finish(id, from, {
          outcome: "sent", content_sha: sha,
          error: verdict === "reconcile" ? "reconciled: provider already accepted this idempotency key" : null,
        });
      } catch { finished = false; }
      if (!finished) {
        await alertSend(`finish_unrecorded:sent${entry.provider_message_id ? " (message id recorded; the sweep reconciles it)" : ""}`);
        return "sent";
      }
      entry.outcome = "sent";
      this.summary.counts[kind].sent++;
      return "sent";
    }

    const error = ("error" in res ? res.error : "") || "send_failed";
    if (verdict === "ambiguous") {
      // Rule 3: unknown outcome keeps the key; same-key retries only inside the 23 h window.
      try {
        if (resumed || await this.io.store.finish(id, from, { outcome: "ambiguous", error: `ambiguous: ${error}`.slice(0, 500), content_sha: sha })) entry.outcome = "ambiguous";
      } catch { /* stays claimed with an attempt recorded → the sweep marks it ambiguous */ }
      this.summary.counts[kind].ambiguous++;
      await alertSend(`ambiguous: ${error}`);
      return "ambiguous";
    }

    // Rule 4: a definitive refusal releases the key; the next tick retries.
    try {
      if (await this.io.store.finish(id, from, { outcome: "failed", error: error.slice(0, 500), content_sha: sha })) entry.outcome = "failed";
    } catch { /* stays claimed with an attempt → ambiguous via the sweep: never a blind resend */ }
    this.summary.counts[kind].failed++;
    await alertSend(error);
    return "failed";
  }

  // ── per kind ───────────────────────────────────────────────────────────────────────────

  async shop(day: string, location: { id: string; name: string }): Promise<void> {
    for (const r of resolveDigestRecipients("gm_shop", this.dir).filter((x) => x.locationIds.includes(location.id))) {
      await this.sendOnce("gm_shop", day, r, location.id, async (env) => renderShopDigest(await this.shopFacts(location, day), env));
    }
  }

  /** At the fallback, a shop that never finalized gets a logged skip for its GMs (the unified digest names it). */
  async shopNotFinalized(day: string, locationId: string): Promise<void> {
    for (const r of resolveDigestRecipients("gm_shop", this.dir).filter((x) => x.locationIds.includes(locationId))) {
      await this.skip("gm_shop", day, r, locationId, "shop_not_finalized");
    }
  }

  async unified(day: string, notFinalizedIds: string[]): Promise<void> {
    const recipients = resolveDigestRecipients("unified", this.dir);
    if (recipients.every((r) => this.settled("unified", day, r.ref, null))) return;
    const notFinalized = this.locations.filter((l) => notFinalizedIds.includes(l.id));
    for (const r of recipients) {
      await this.sendOnce("unified", day, r, null, async (env) => renderUnifiedDigest({
        day, notFinalized, shops: await Promise.all(this.locations.map((l) => this.shopFacts(l, day))),
      }, env));
    }
  }

  async catering(day: string): Promise<void> {
    const recipients = resolveDigestRecipients("catering", this.dir);
    if (recipients.every((r) => this.settled("catering", day, r.ref, null))) return;
    let facts: Promise<CateringFacts> | null = null;
    for (const r of recipients) {
      await this.sendOnce("catering", day, r, null, async (env) => {
        facts ??= this.io.cateringFacts(day);
        const locations = this.locations.filter((l) => r.locationIds.includes(l.id));
        return renderCateringDigest(await facts, { locations, includeUnassigned: r.allShops }, env);
      });
    }
  }

  /**
   * The scheduled package for one cadence and business day (exports PR). Recipients are the
   * report_recipients rows with packages + this cadence (Pete; the accountant row, a logged
   * recipient_disabled skip until its email is plugged in). It goes through sendOnce like every
   * digest, so it gets the SAME guarantees: the claim, the attempt recorded before the provider,
   * the provider Idempotency-Key, provider_message_id before finish, ambiguous same-key retries
   * inside 23 h then failed_ambiguous, and the never-silent alert. Nothing here bypasses them.
   */
  private packageRows: Promise<PackageRecipientRow[]> | null = null;
  async packages(cadence: PackageCadence, day: string): Promise<void> {
    const pio = this.io.packages;
    if (!pio) return;
    this.packageRows ??= pio.recipients();
    const recipients = resolvePackageRecipients({
      rows: await this.packageRows, users: this.dir.users, memberships: this.dir.memberships, locationIds: this.dir.locationIds, cadence,
    });
    const kind = packageKindFor(cadence);
    for (const r of recipients) {
      const outcome = await this.sendOnce(kind, day, r, null, (env) => pio.compose(r, cadence, day, env));
      if (outcome === "sent" || outcome === "failed" || outcome === "ambiguous") await pio.recordSend({ kind, day, ref: r.ref, outcome });
    }
  }

  /** Every expected recipient must have a sent or deliberately-skipped row once the deadline passed. */
  async watch(kind: DigestKind, day: string): Promise<void> {
    if (this.io.now.getTime() < digestWatchAt(kind, day, this.settings).getTime()) return;
    const expected = expectedDeliveries(kind, resolveDigestRecipients(kind, this.dir));
    const missing = missingDeliveries(expected, this.logFor(kind, day), this.mode);
    if (missing.length === 0) return;
    if (await this.io.alert({ kind, day, detector: "digest-watch", missing: missing.map((m) => m.locationId ? `${m.ref}@${m.locationId}` : m.ref) })) this.summary.alerts++;
  }
}

async function openRun(io: DigestIO, days: string[], trigger: "tick" | "closing"): Promise<Run | DigestRunSummary | null> {
  const settings = await io.settings();
  if (settings.mode === "off") return null;
  let previewTo: string | null = null;
  if (settings.mode === "preview") {
    previewTo = await io.previewRecipient();
    if (!previewTo) {
      // Fail closed: no resolvable operator identity → nothing is composed or sent, and it is said.
      const summary: DigestRunSummary = { trigger, mode: "preview", counts: emptyCounts(), staleClaims: 0, reconciled: 0, ambiguousExpired: 0, alerts: 0 };
      if (await io.alert({ kind: "all", day: etClock(io.now).day, detector: "digest-preview", error: "preview_recipient_unresolved" })) {
        summary.alerts = 1;
        await io.recordRun(summary);
      }
      return summary;
    }
  }
  const [{ dir, locations }, log] = await Promise.all([io.directory(), io.sendLog(days)]);
  const run = new Run(io, previewTo, settings, settings.mode, dir, locations, log, trigger);
  // The sweep runs before any send, so a reconciled / released / frozen claim is seen as such below.
  await run.sweep();
  return run;
}

/**
 * The 10-minute pinger tick (03:00-22:00 ET). Reconciles every digest that is due and not sent,
 * runs the 03:00 fallback, sends the catering digest at its time, and watches for misses.
 * Returns null when the switch is OFF (no work, nothing expected, nothing alerted).
 */
export async function runDigestTickWith(io: DigestIO): Promise<DigestRunSummary | null> {
  const days = tickBusinessDays(io.now);
  const today = etClock(io.now).day;
  // The sweep also sees the day before yesterday: an ambiguous attempt there can still need freezing.
  const run = await openRun(io, [addDays(days[0]!, -1), ...days], "tick");
  if (!(run instanceof Run)) return run;
  return finishTick(run, days, today);
}

async function finishTick(run: Run, days: string[], today: string): Promise<DigestRunSummary> {
  const io = run.io;
  const finalized = await io.finalizedClosings(days);
  const activeIds = run.locations.map((l) => l.id);
  for (const day of days) {
    const done = finalized.get(day) ?? new Set<string>();
    for (const location of run.locations) {
      if (done.has(location.id)) await run.shop(day, location);
      else if (io.now.getTime() >= unifiedFallbackAt(day, run.settings).getTime()) await run.shopNotFinalized(day, location.id);
    }
    const decision = decideUnified({ day, activeLocationIds: activeIds, finalizedLocationIds: done, now: io.now, settings: run.settings });
    if (decision.due) await run.unified(day, decision.missing);
    // Pete (and the accountant, once enabled) get the day's CSV + PDF "at close": with the unified digest.
    if (decision.due) await run.packages("daily_close", day);
  }
  const catering = decideCatering(io.now, run.settings);
  if (catering.due) await run.catering(catering.day);
  for (const periodic of periodicPackageDue(io.now)) await run.packages(periodic.cadence, periodic.day);

  const yesterday = addDays(today, -1);
  await run.watch("gm_shop", yesterday);
  await run.watch("unified", yesterday);
  await run.watch("catering", today);
  if (run.didWork) await io.recordRun(run.summary);
  return run.summary;
}

/**
 * The closing hook (after() in /api/checklist/confirm): the shop's GM digest now, and the unified
 * digest if this was the last shop. Latency only — the tick reconciles anything this misses.
 */
export async function runClosingDigestsWith(io: DigestIO, locationId: string, day: string): Promise<DigestRunSummary | null> {
  const run = await openRun(io, [day], "closing");
  if (!(run instanceof Run)) return run;
  const finalized = (await io.finalizedClosings([day])).get(day) ?? new Set<string>();
  const location = run.locations.find((l) => l.id === locationId);
  if (location && finalized.has(locationId)) await run.shop(day, location);
  const decision = decideUnified({ day, activeLocationIds: run.locations.map((l) => l.id), finalizedLocationIds: finalized, now: io.now, settings: run.settings });
  if (decision.due) await run.unified(day, decision.missing);
  if (decision.due) await run.packages("daily_close", day);
  if (run.didWork) await io.recordRun(run.summary);
  return run.summary;
}
