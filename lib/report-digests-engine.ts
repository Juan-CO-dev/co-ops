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
  type Envelope,
  type ShopDayFacts,
} from "@/lib/report-digests-compose";
import {
  PACKAGE_KINDS,
  packageKindFor,
  periodicPackageDue,
  resolvePackageRecipients,
  type PackageKind,
  type PackageRecipientRow,
  type ComposedSend,
  type EmailAttachment,
  type PackageIO,
} from "@/lib/report-package-shared";
export type { ComposedSend, EmailAttachment, PackageIO };
import type { PackageCadence } from "@/lib/report-recipients-shared";

/** Everything the send log keys: the three digests and (exports PR) the three package cadences. */
export type SendKind = DigestKind | PackageKind;

export type DeliveryMode = "preview" | "live";

export interface ClaimRow {
  kind: SendKind; business_day: string; recipient_ref: string; location_id: string | null;
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
  kind: SendKind; day: string; detector: "digest-watch" | "digest-send";
  missing?: string[]; error?: string; ref?: string;
}

export interface DigestIO {
  now: Date;
  baseUrl: string;
  /** Where preview mode delivers every digest (the operator). */
  previewTo: string;
  settings(): Promise<DigestSettings>;
  directory(): Promise<{ dir: DigestDirectory; locations: Array<{ id: string; name: string }> }>;
  sendLog(days: string[]): Promise<SendLogRow[]>;
  /** day → set of location ids whose closing is finalized (confirmed | incomplete_confirmed | auto_finalized). */
  finalizedClosings(days: string[]): Promise<Map<string, Set<string>>>;
  shopFacts(location: { id: string; name: string }, day: string): Promise<ShopDayFacts>;
  cateringFacts(today: string): Promise<CateringFacts>;
  expireStaleClaims(): Promise<number>;
  store: SendStore;
  sendEmail(input: { to: string; subject: string; html: string; text: string; attachments?: EmailAttachment[] }): Promise<{ id: string } | { error: string }>;
  sha(content: string): string;
  /** Ops alert, claimed once per detector × kind × ET day. true = this call sent it. Never throws. */
  alert(a: DigestAlert): Promise<boolean>;
  /** Exports PR: the scheduled CSV/PDF package. Absent = no package sends. */
  packages?: PackageIO;
  /** One digest.run audit row. Never throws. */
  recordRun(summary: DigestRunSummary): Promise<void>;
}

export interface KindCounts { sent: number; skipped: number; failed: number }
export interface DigestRunSummary {
  trigger: "tick" | "closing";
  mode: DeliveryMode | "off";
  counts: Record<SendKind, KindCounts>;
  staleClaims: number;
  alerts: number;
}

function emptyCounts(): Record<SendKind, KindCounts> {
  const zero = (): KindCounts => ({ sent: 0, skipped: 0, failed: 0 });
  return {
    gm_shop: zero(), unified: zero(), catering: zero(),
    ...Object.fromEntries(PACKAGE_KINDS.map((k) => [k, zero()])) as Record<PackageKind, KindCounts>,
  };
}

class Run {
  readonly summary: DigestRunSummary;
  private readonly log: SendLogRow[];
  private readonly facts = new Map<string, Promise<ShopDayFacts>>();

  constructor(
    readonly io: DigestIO,
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
      [...DIGEST_KINDS, ...PACKAGE_KINDS].some((k) => { const c = this.summary.counts[k]; return c.sent + c.skipped + c.failed > 0; });
  }

  logFor(kind: SendKind, day: string): SendLogRow[] {
    return this.log.filter((r) => r.kind === kind && r.business_day === day && r.mode === this.mode);
  }

  /** A live claim or a send already exists: not due, nothing to log. */
  private settled(kind: SendKind, day: string, ref: string, locationId: string | null): boolean {
    return this.logFor(kind, day).some((r) => r.recipient_ref === ref && (r.location_id ?? null) === locationId &&
      r.revision === 1 && (r.outcome === "sent" || r.outcome === "claimed"));
  }

  private skippedAlready(kind: SendKind, day: string, ref: string, locationId: string | null, reason: DigestSkipReason): boolean {
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
  async skip(kind: SendKind, day: string, r: ResolvedRecipient, locationId: string | null, reason: DigestSkipReason): Promise<void> {
    if (this.settled(kind, day, r.ref, locationId) || this.skippedAlready(kind, day, r.ref, locationId, reason)) return;
    const row: ClaimRow = { kind, business_day: day, recipient_ref: r.ref, location_id: locationId, revision: 1, mode: this.mode };
    await this.io.store.skip({ ...row, skip_reason: reason });
    this.push(row, "skipped", reason);
    this.summary.counts[kind].skipped++;
  }

  /** Claim → compose → send → record. Returns the outcome; never throws for a send problem. */
  async sendOnce(kind: SendKind, day: string, r: ResolvedRecipient, locationId: string | null, compose: (env: Envelope) => Promise<ComposedSend> | ComposedSend): Promise<"sent" | "skipped" | "failed" | "not_due"> {
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
    try {
      const env: Envelope = { language: r.language, baseUrl: this.io.baseUrl, previewFor: this.mode === "preview" ? { name: r.name, email: r.email } : null };
      const mail = await compose(env);
      sha = this.io.sha(mail.html);
      const to = this.mode === "preview" ? this.io.previewTo : r.email!;
      const res = await this.io.sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, ...(mail.attachments ? { attachments: mail.attachments } : {}) });
      if ("error" in res) error = res.error || "send_failed";
      else emailId = res.id;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const outcome = error === null ? "sent" : "failed";
    await this.io.store.finish(claim.id, { outcome, email_id: emailId, error: error?.slice(0, 500) ?? null, content_sha: sha });
    const last = this.log[this.log.length - 1]!;
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

  /**
   * The scheduled package for one cadence and business day (exports PR). Recipients are the
   * report_recipients rows with packages + this cadence (Pete; the accountant row, which stays a
   * logged recipient_disabled skip until its email is plugged in). Same claim/send/record path as
   * every digest: one per recipient × kind × day × mode, failures logged + alerted, never silent.
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
      if (outcome === "sent" || outcome === "failed") await pio.recordSend({ kind, day, ref: r.ref, outcome });
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

async function openRun(io: DigestIO, days: string[], trigger: "tick" | "closing", beforeLog?: () => Promise<number>): Promise<Run | null> {
  const settings = await io.settings();
  if (settings.mode === "off") return null;
  // Stale claims are freed BEFORE the log is read, so their retry below is not mistaken for "settled".
  const staleClaims = beforeLog ? await beforeLog() : 0;
  const [{ dir, locations }, log] = await Promise.all([io.directory(), io.sendLog(days)]);
  const run = new Run(io, settings, settings.mode, dir, locations, log, trigger);
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
  if (!run) return null;
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
  if (!run) return null;
  const finalized = (await io.finalizedClosings([day])).get(day) ?? new Set<string>();
  const location = run.locations.find((l) => l.id === locationId);
  if (location && finalized.has(locationId)) await run.shop(day, location);
  const decision = decideUnified({ day, activeLocationIds: run.locations.map((l) => l.id), finalizedLocationIds: finalized, now: io.now, settings: run.settings });
  if (decision.due) await run.unified(day, decision.missing);
  if (decision.due) await run.packages("daily_close", day);
  if (run.didWork) await io.recordRun(run.summary);
  return run.summary;
}
