/**
 * Report digests — the ORCHESTRATION (no direct I/O: everything goes through DigestIO, which
 * lib/report-digests.ts builds over the service-role client, Resend and the audit log). Kept apart
 * so the idempotency, fallback and watch behaviour is unit-testable against an in-memory store.
 *
 * THE IDEMPOTENCY LAW. One digest per recipient × kind × business day × revision × mode, enforced
 * by 0220's partial unique index, not by reasoning: sendOnce INSERTs a 'claimed' row first; the
 * loser of a double cron fire / retry gets "duplicate" and logs skipped/already_sent. Only then is
 * the email composed and sent; the row flips to sent (with the Resend id) or failed (with the
 * error). A failed row releases the key, so the next tick retries — and every failure alerts.
 */
import {
  DIGEST_KINDS,
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
  type ComposedEmail,
  type Envelope,
  type ShopDayFacts,
} from "@/lib/report-digests-compose";

export type DeliveryMode = "preview" | "live";

export interface ClaimRow {
  kind: DigestKind; business_day: string; recipient_ref: string; location_id: string | null;
  revision: number; mode: DeliveryMode;
}

export interface SendStore {
  /** INSERT outcome='claimed'. "duplicate" = the unique index refused it (23505). Throws on any other error. */
  claim(row: ClaimRow): Promise<{ id: string } | "duplicate">;
  /** claimed → sent|failed, guarded on outcome='claimed'. false = the row was not claimed any more. */
  finish(id: string, patch: { outcome: "sent" | "failed"; email_id?: string | null; error?: string | null; content_sha?: string | null }): Promise<boolean>;
  skip(row: ClaimRow & { skip_reason: DigestSkipReason }): Promise<void>;
}

export interface DigestAlert {
  kind: DigestKind | "all"; day: string; detector: "digest-watch" | "digest-send" | "digest-preview";
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
  sendLog(days: string[]): Promise<SendLogRow[]>;
  /** day → set of location ids whose closing is finalized (confirmed | incomplete_confirmed | auto_finalized). */
  finalizedClosings(days: string[]): Promise<Map<string, Set<string>>>;
  shopFacts(location: { id: string; name: string }, day: string): Promise<ShopDayFacts>;
  cateringFacts(today: string): Promise<CateringFacts>;
  expireStaleClaims(): Promise<number>;
  store: SendStore;
  /** idempotencyKey is passed to the provider (Resend Idempotency-Key): one email per key, ever. */
  sendEmail(input: { to: string; subject: string; html: string; text: string; idempotencyKey: string }): Promise<{ id: string } | { error: string; code?: string }>;
  sha(content: string): string;
  /** Ops alert, claimed once per detector × kind × ET day. true = this call sent it. Never throws. */
  alert(a: DigestAlert): Promise<boolean>;
  /** One digest.run audit row. Never throws. */
  recordRun(summary: DigestRunSummary): Promise<void>;
}

export interface KindCounts { sent: number; skipped: number; failed: number }
export interface DigestRunSummary {
  trigger: "tick" | "closing";
  mode: DeliveryMode | "off";
  counts: Record<DigestKind, KindCounts>;
  staleClaims: number;
  alerts: number;
}

/**
 * The provider idempotency key: one email per recipient × kind × business day × revision (plus the
 * delivery mode and, for a per-shop digest, the shop — each is a different email by design).
 */
export function digestIdempotencyKey(row: ClaimRow): string {
  return ["co-digest", row.mode, row.kind, row.business_day, `r${row.revision}`, row.recipient_ref, row.location_id ?? "all"].join("/");
}

function emptyCounts(): Record<DigestKind, KindCounts> {
  return { gm_shop: { sent: 0, skipped: 0, failed: 0 }, unified: { sent: 0, skipped: 0, failed: 0 }, catering: { sent: 0, skipped: 0, failed: 0 } };
}

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
    this.summary = { trigger, mode, counts: emptyCounts(), staleClaims: 0, alerts: 0 };
  }

  get didWork(): boolean {
    return this.summary.alerts > 0 || this.summary.staleClaims > 0 ||
      DIGEST_KINDS.some((k) => { const c = this.summary.counts[k]; return c.sent + c.skipped + c.failed > 0; });
  }

  logFor(kind: DigestKind, day: string): SendLogRow[] {
    return this.log.filter((r) => r.kind === kind && r.business_day === day && r.mode === this.mode);
  }

  /** A live claim or a send already exists: not due, nothing to log. */
  private settled(kind: DigestKind, day: string, ref: string, locationId: string | null): boolean {
    return this.logFor(kind, day).some((r) => r.recipient_ref === ref && (r.location_id ?? null) === locationId &&
      r.revision === 1 && (r.outcome === "sent" || r.outcome === "claimed"));
  }

  private skippedAlready(kind: DigestKind, day: string, ref: string, locationId: string | null, reason: DigestSkipReason): boolean {
    return this.logFor(kind, day).some((r) => r.recipient_ref === ref && (r.location_id ?? null) === locationId &&
      r.outcome === "skipped" && r.skip_reason === reason);
  }

  private push(row: ClaimRow, outcome: string, skip_reason: string | null = null): void {
    this.log.push({ ...row, outcome, skip_reason, attempted_at: this.io.now.toISOString() });
  }

  shopFacts(location: { id: string; name: string }, day: string): Promise<ShopDayFacts> {
    const key = `${location.id}|${day}`;
    let p = this.facts.get(key);
    if (!p) { p = this.io.shopFacts(location, day); this.facts.set(key, p); }
    return p;
  }

  /** Log a deliberate non-send once per (recipient, kind, day, location, reason). */
  async skip(kind: DigestKind, day: string, r: ResolvedRecipient, locationId: string | null, reason: DigestSkipReason): Promise<void> {
    if (this.settled(kind, day, r.ref, locationId) || this.skippedAlready(kind, day, r.ref, locationId, reason)) return;
    const row: ClaimRow = { kind, business_day: day, recipient_ref: r.ref, location_id: locationId, revision: 1, mode: this.mode };
    await this.io.store.skip({ ...row, skip_reason: reason });
    this.push(row, "skipped", reason);
    this.summary.counts[kind].skipped++;
  }

  /** Claim → compose → send → record. Returns the outcome; never throws for a send problem. */
  async sendOnce(kind: DigestKind, day: string, r: ResolvedRecipient, locationId: string | null, compose: (env: Envelope) => Promise<ComposedEmail> | ComposedEmail): Promise<"sent" | "skipped" | "failed" | "not_due"> {
    if (this.settled(kind, day, r.ref, locationId)) return "not_due";
    if (r.skip) { await this.skip(kind, day, r, locationId, r.skip); return "skipped"; }
    const row: ClaimRow = { kind, business_day: day, recipient_ref: r.ref, location_id: locationId, revision: 1, mode: this.mode };
    const claim = await this.io.store.claim(row);
    if (claim === "duplicate") {
      // Someone else (a double fire, the closing hook) owns this send. Logged, never re-sent.
      await this.io.store.skip({ ...row, skip_reason: "already_sent" });
      this.push(row, "skipped", "already_sent");
      this.summary.counts[kind].skipped++;
      return "skipped";
    }
    this.push(row, "claimed");
    let error: string | null = null;
    let emailId: string | null = null;
    let sha: string | null = null;
    let reconciled = false;
    try {
      const env: Envelope = { language: r.language, baseUrl: this.io.baseUrl, previewFor: this.mode === "preview" ? { name: r.name, email: r.email } : null };
      const mail = await compose(env);
      sha = this.io.sha(mail.html);
      const to = this.mode === "preview" ? this.previewTo! : r.email!;
      const res = await this.io.sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: digestIdempotencyKey(row) });
      if ("error" in res) {
        if (res.code === "invalid_idempotent_request") {
          // The provider already ACCEPTED this key (an earlier attempt whose outcome we lost, with
          // content that has since changed). That is a delivery: reconcile as sent, never resend.
          reconciled = true;
        } else error = res.error || "send_failed";
      } else emailId = res.id;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const outcome = error === null ? "sent" : "failed";
    let recorded = false;
    try {
      recorded = await this.io.store.finish(claim.id, {
        outcome, email_id: emailId, content_sha: sha,
        error: reconciled ? "reconciled: provider already accepted this idempotency key" : error?.slice(0, 500) ?? null,
      });
    } catch {
      recorded = false;
    }
    const last = this.log[this.log.length - 1]!;
    if (!recorded) {
      // The send log could not be updated. The claim is NOT released here: it stays 'claimed',
      // keeps the key, and only the stale-claim sweep frees it — whose retry reuses the SAME
      // provider idempotency key, so an email that did go out is never sent twice.
      if (await this.io.alert({ kind, day, detector: "digest-send", ref: r.ref, error: `finish_unrecorded:${outcome}${error ? `:${error.slice(0, 200)}` : ""}` })) this.summary.alerts++;
      return outcome;
    }
    last.outcome = outcome;
    this.summary.counts[kind][outcome]++;
    if (error !== null) {
      // NEVER silent: the failed row is in the send log, and the operator is told now.
      if (await this.io.alert({ kind, day, detector: "digest-send", ref: r.ref, error: error.slice(0, 300) })) this.summary.alerts++;
    }
    return outcome;
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

  /** Every expected recipient must have a sent or skipped row once the deadline passed. */
  async watch(kind: DigestKind, day: string): Promise<void> {
    if (this.io.now.getTime() < digestWatchAt(kind, day, this.settings).getTime()) return;
    const expected = expectedDeliveries(kind, resolveDigestRecipients(kind, this.dir));
    const missing = missingDeliveries(expected, this.logFor(kind, day), this.mode);
    if (missing.length === 0) return;
    if (await this.io.alert({ kind, day, detector: "digest-watch", missing: missing.map((m) => m.locationId ? `${m.ref}@${m.locationId}` : m.ref) })) this.summary.alerts++;
  }
}

async function openRun(io: DigestIO, days: string[], trigger: "tick" | "closing", beforeLog?: () => Promise<number>): Promise<Run | DigestRunSummary | null> {
  const settings = await io.settings();
  if (settings.mode === "off") return null;
  // Stale claims are freed BEFORE the log is read, so their retry below is not mistaken for "settled".
  const staleClaims = beforeLog ? await beforeLog() : 0;
  let previewTo: string | null = null;
  if (settings.mode === "preview") {
    previewTo = await io.previewRecipient();
    if (!previewTo) {
      // Fail closed: no resolvable operator identity → nothing is composed or sent, and it is said.
      const summary: DigestRunSummary = { trigger, mode: "preview", counts: emptyCounts(), staleClaims, alerts: 0 };
      if (await io.alert({ kind: "all", day: etClock(io.now).day, detector: "digest-preview", error: "preview_recipient_unresolved" })) {
        summary.alerts = 1;
        await io.recordRun(summary);
      }
      return summary;
    }
  }
  const [{ dir, locations }, log] = await Promise.all([io.directory(), io.sendLog(days)]);
  const run = new Run(io, previewTo, settings, settings.mode, dir, locations, log, trigger);
  run.summary.staleClaims = staleClaims;
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
  const run = await openRun(io, days, "tick", () => io.expireStaleClaims());
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
  }
  const catering = decideCatering(io.now, run.settings);
  if (catering.due) await run.catering(catering.day);

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
  if (run.didWork) await io.recordRun(run.summary);
  return run.summary;
}
