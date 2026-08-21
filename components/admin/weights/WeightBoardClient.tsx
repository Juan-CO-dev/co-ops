"use client";

/**
 * WeightBoardClient — every weight the system believes, and the weigh session.
 *
 * ── THE RULING IS THE UI SPEC ─────────────────────────────────────────────────
 * "Triggered on demand. Behaves just like the regular audit." So: NO clocks, NO
 * due dates, NO gates, and no red count anywhere that could read as a nag. The
 * suggestion list's own header says it SUGGESTS. Staleness is shown as an age
 * ("weighed 96 days ago"), never as a deadline, because an age is a fact and a
 * deadline is an instruction.
 *
 * One deliberate departure from the brainstorm mockup, and it is the ruling's
 * doing: the mockup's fourth pill read "GUESS — WEIGH DUE". The mockup predates
 * Juan's on-demand ruling, and "DUE" is exactly the word the ruling removed. The
 * pill keeps the mockup's colour and position and states the fact instead —
 * UNVERIFIED (a value with no recorded provenance) and NOT WEIGHED (no value at
 * all). Same information, no imperative.
 *
 * DISCLOSURE DOCTRINE (docs/DISCLOSURE_DOCTRINE.md): an always-visible metrics
 * strip (D2), CollapsibleSection groups, one SummaryRow per subject with identity +
 * class pill always visible, and provenance/drift/spec inside a lazy drawer.
 * Disclosure state is useState-only (D9).
 *
 * GRAMMAR: admin-form throughout — rounded-lg, 44px floor with items-center,
 * border-co-gold-deep on the primary action, control labels at tracking-[0.1em];
 * field labels 11px/700/tracking-[0.12em]/text-co-text-dim; group headers
 * 12px/700/tracking-wide/text-co-text-muted.
 */

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { AlertPill, type AlertPillTone } from "@/components/ui/AlertPill";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { SummaryRow } from "@/components/ui/SummaryRow";
import type { WeightBoard, WeightBoardRow } from "@/lib/weights";
import type { WeightBelief, WeightSuggestion } from "@/lib/weights-shared";
import { postJson, resolveErrorKey } from "./shared";

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

const primaryBtnCls =
  "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50";

const secondaryBtnCls =
  "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50";

const fieldLabelCls = "text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";
const groupHeaderCls = "text-xs font-bold tracking-wide text-co-text-muted";
const metricLabelCls = "text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-dim";

/**
 * Which pill a belief wears — mapped onto the RATIFIED AlertPill tones, not a
 * hand-rolled palette. AlertPill exists precisely to end the drift of surfaces
 * inventing their own status colours, and its four tones already read the correct
 * fill-vs-text token pair at AA.
 *
 * The mockup drew INVOICE in blue (#EAF1FA / #1F4E79). The token system has no
 * blue TEXT role and AGENTS.md forbids minting a second name for a role, so
 * INVOICE takes AlertPill's neutral `info` tone and carries its meaning in the
 * label. OPERATIONAL green, SPEC gold and the red fourth state land exactly where
 * the mockup put them.
 *
 * Two different absences, deliberately distinguished: a value with no recorded
 * class is UNVERIFIED (we believe a number and cannot say why), and no value at
 * all is NOT WEIGHED (we believe nothing). Collapsing them would hide which of the
 * two a row is in, and they call for different work.
 */
function classPill(belief: WeightBelief, t: T): { tone: AlertPillTone; label: string } {
  if (belief.valueOz == null) {
    return { tone: "info", label: t("admin.weights.pill.not_weighed") };
  }
  switch (belief.weightClass) {
    case "OPERATIONAL":
      return { tone: "ok", label: t("admin.weights.pill.operational") };
    case "SPEC":
      return { tone: "warn", label: t("admin.weights.pill.spec") };
    case "INVOICE_DERIVED":
      return { tone: "info", label: t("admin.weights.pill.invoice") };
    default:
      return { tone: "danger", label: t("admin.weights.pill.unverified") };
  }
}

const KIND_KEY: Readonly<Record<WeightBelief["subjectKind"], TranslationKey>> = {
  sku: "admin.weights.kind.sku",
  product: "admin.weights.kind.product",
  item: "admin.weights.kind.item",
};

const DRIFT_KEY: Readonly<Record<string, TranslationKey>> = {
  agrees: "admin.weights.trim.drift.agrees",
  over_trim: "admin.weights.trim.drift.over_trim",
  under_trim: "admin.weights.trim.drift.under_trim",
  no_reference: "admin.weights.trim.drift.no_reference",
};

const BAND_KEY: Readonly<Record<WeightSuggestion["band"], TranslationKey>> = {
  blocks_repoint: "admin.weights.band.blocks_repoint",
  never_measured: "admin.weights.band.never_measured",
  aging: "admin.weights.band.aging",
  unrankable: "admin.weights.band.unrankable",
};

/** A measurement staged in the current session, keyed by kind+id. */
interface StagedMeasurement {
  subjectKind: WeightBelief["subjectKind"];
  subjectId: string;
  name: string;
  unit: string;
  currentOz: number | null;
  value: string;
  note: string;
}

const stageKey = (kind: string, id: string) => `${kind}:${id}`;

export function WeightBoardClient({ board, canWeigh }: { board: WeightBoard; canWeigh: boolean }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [staged, setStaged] = useState<StagedMeasurement[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const oz = useMemo(() => {
    const fmt = new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", {
      maximumFractionDigits: 3,
    });
    return (v: number | null) => (v == null ? "—" : fmt.format(v));
  }, [language]);

  const money = useMemo(() => {
    const fmt = new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", {
      style: "currency",
      currency: "USD",
    });
    return (v: number | null) => (v == null ? "—" : fmt.format(v));
  }, [language]);

  const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

  const rowsById = useMemo(() => {
    const m = new Map<string, WeightBoardRow>();
    for (const r of board.rows) m.set(stageKey(r.belief.subjectKind, r.belief.subjectId), r);
    return m;
  }, [board.rows]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stagedKeys = useMemo(
    () => new Set(staged.map((s) => stageKey(s.subjectKind, s.subjectId))),
    [staged],
  );

  const stage = (belief: WeightBelief) => {
    const key = stageKey(belief.subjectKind, belief.subjectId);
    if (stagedKeys.has(key)) return;
    setOkMsg(null);
    setStaged((prev) => [
      ...prev,
      {
        subjectKind: belief.subjectKind,
        subjectId: belief.subjectId,
        name: belief.name,
        unit: belief.unit,
        currentOz: belief.valueOz,
        value: "",
        note: "",
      },
    ]);
  };

  const unstage = (key: string) =>
    setStaged((prev) => prev.filter((s) => stageKey(s.subjectKind, s.subjectId) !== key));

  const editStaged = (key: string, patch: Partial<StagedMeasurement>) =>
    setStaged((prev) =>
      prev.map((s) => (stageKey(s.subjectKind, s.subjectId) === key ? { ...s, ...patch } : s)),
    );

  const parsedStaged = staged.map((s) => {
    const trimmed = s.value.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    return { staged: s, parsed, valid: parsed != null && Number.isFinite(parsed) && parsed > 0 };
  });
  const readyCount = parsedStaged.filter((p) => p.valid).length;

  /** Commit the session: step-up B → POST → refresh. */
  const commit = async () => {
    if (busy || readyCount === 0) return;
    setErrorMsg(null);
    setOkMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson("/api/admin/weights", {
      measurements: parsedStaged
        .filter((p) => p.valid)
        .map((p) => ({
          subjectKind: p.staged.subjectKind,
          subjectId: p.staged.subjectId,
          valueOz: p.parsed,
          sourceNote: p.staged.note.trim() || null,
        })),
    });
    setBusy(false);
    if (result.ok) {
      const n = Array.isArray(result.data.recorded) ? result.data.recorded.length : readyCount;
      setStaged([]);
      setOkMsg(t("admin.weights.session.recorded", { n }));
      router.refresh();
      return;
    }
    setErrorMsg(t(resolveErrorKey(result.code)));
  };

  // ── The always-visible metrics strip (D2) ─────────────────────────────────
  const believed = board.rows.filter((r) => r.belief.valueOz != null);
  const counts = {
    believed: believed.length,
    operational: believed.filter((r) => r.belief.weightClass === "OPERATIONAL").length,
    spec: believed.filter((r) => r.belief.weightClass === "SPEC").length,
    unverified: believed.filter((r) => r.belief.weightClass == null).length,
    unweighed: board.rows.length - believed.length,
  };

  const byKind = (kind: WeightBelief["subjectKind"]) =>
    board.rows.filter((r) => r.belief.subjectKind === kind);

  const renderRow = (row: WeightBoardRow) => {
    const key = stageKey(row.belief.subjectKind, row.belief.subjectId);
    const pill = classPill(row.belief, t);
    return (
      <li key={key}>
        <SummaryRow
          drawerId={`weights-row-${key}`}
          expanded={expanded.has(key)}
          onToggle={() => toggle(key)}
          toggleLabel={expanded.has(key) ? t("admin.weights.toggle.hide") : t("admin.weights.toggle.show")}
          summary={
            <span className="flex min-w-0 flex-wrap items-baseline gap-2">
              <span className="text-sm font-bold text-co-text">{row.belief.name}</span>
              <span className="text-sm text-co-text">
                {row.belief.valueOz == null
                  ? t("admin.weights.value_unknown")
                  : t("admin.weights.value", { oz: oz(row.belief.valueOz), unit: row.belief.unit })}
              </span>
              {row.vendorLabels.length > 0 ? (
                <span className="text-xs text-co-text-muted">{row.vendorLabels.join(" · ")}</span>
              ) : null}
            </span>
          }
          badges={
            <span className="flex flex-wrap items-center gap-1">
              <AlertPill tone={pill.tone}>{pill.label}</AlertPill>
              {row.belief.blocksRepoint ? (
                <AlertPill tone="danger">{t("admin.weights.pill.blocks_repoint")}</AlertPill>
              ) : null}
              {row.invoiceDrift ? (
                <AlertPill tone="info">{t("admin.weights.pill.invoice_drift")}</AlertPill>
              ) : null}
              {row.countImplicated ? (
                <AlertPill tone="warn">{t("admin.weights.pill.count_implicated")}</AlertPill>
              ) : null}
            </span>
          }
        >
          <RowDrawer
            row={row}
            t={t}
            oz={oz}
            money={money}
            pct={pct}
            canWeigh={canWeigh}
            staged={stagedKeys.has(key)}
            onStage={() => stage(row.belief)}
          />
        </SummaryRow>
      </li>
    );
  };

  return (
    <div className="mt-5 flex flex-col gap-3">
      {errorMsg ? (
        <p role="status" className="text-sm text-co-cta-text">
          {errorMsg}
        </p>
      ) : null}
      {okMsg ? (
        <p role="status" className="text-sm text-co-confirm-text">
          {okMsg}
        </p>
      ) : null}

      <section className="co-card p-4" aria-label={t("admin.weights.metrics_aria")}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-6">
          <Metric label={t("admin.weights.metric.believed")} value={String(counts.believed)} />
          <Metric label={t("admin.weights.metric.operational")} value={String(counts.operational)} />
          <Metric label={t("admin.weights.metric.spec")} value={String(counts.spec)} />
          <Metric label={t("admin.weights.metric.unverified")} value={String(counts.unverified)} />
          <Metric label={t("admin.weights.metric.unweighed")} value={String(counts.unweighed)} />
        </div>
        <p className="mt-3 text-xs text-co-text-muted">
          {t("admin.weights.usage_window", { days: board.usageWindowDays })}
        </p>
      </section>

      {canWeigh ? (
        <WeighSession
          t={t}
          oz={oz}
          staged={parsedStaged}
          busy={busy}
          readyCount={readyCount}
          onEdit={editStaged}
          onRemove={unstage}
          onCommit={() => void commit()}
        />
      ) : null}

      <CollapsibleSection
        idBase="weights-suggestions"
        title={t("admin.weights.suggestions.heading")}
        count={t("admin.weights.count", { n: board.suggestions.length })}
        defaultOpen
      >
        {/* The header above SUGGESTS and this line says why, in the ruling's own
            register. There is no deadline anywhere on this surface. */}
        <p className="text-xs text-co-text-muted">{t("admin.weights.suggestions.hint")}</p>
        <ul className="mt-2 flex flex-col gap-2">
          {board.suggestions.map((s) => {
            const key = stageKey(s.belief.subjectKind, s.belief.subjectId);
            const row = rowsById.get(key);
            return (
              <li
                key={key}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-co-border/50 pb-2 last:border-b-0"
              >
                <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <span className="text-sm font-bold text-co-text">{s.belief.name}</span>
                  <span className="text-xs text-co-text-muted">{t(KIND_KEY[s.belief.subjectKind])}</span>
                  <AlertPill tone={s.band === "blocks_repoint" ? "danger" : "info"}>
                    {t(BAND_KEY[s.band])}
                  </AlertPill>
                  <span className="text-xs text-co-text-muted">
                    {s.costImpact == null
                      ? t("admin.weights.suggestions.no_cost_basis")
                      : t("admin.weights.suggestions.impact", { amount: money(s.costImpact) })}
                  </span>
                  <span className="text-xs text-co-text-muted">
                    {s.stalenessDays == null
                      ? t("admin.weights.age.never")
                      : t("admin.weights.age.days", { n: s.stalenessDays })}
                  </span>
                </span>
                {canWeigh && row ? (
                  <button
                    type="button"
                    disabled={busy || stagedKeys.has(key)}
                    aria-label={t("admin.weights.session.add_aria", { subject: s.belief.name })}
                    onClick={() => stage(s.belief)}
                    className={secondaryBtnCls}
                  >
                    {stagedKeys.has(key)
                      ? t("admin.weights.session.added")
                      : t("admin.weights.session.add")}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CollapsibleSection>

      {(["sku", "product", "item"] as const).map((kind) => {
        const list = byKind(kind);
        if (list.length === 0) return null;
        return (
          <CollapsibleSection
            key={kind}
            idBase={`weights-${kind}`}
            title={t(KIND_KEY[kind])}
            count={t("admin.weights.count", { n: list.length })}
          >
            <ul className="flex flex-col gap-2">{list.map(renderRow)}</ul>
          </CollapsibleSection>
        );
      })}

      <CollapsibleSection
        idBase="weights-trim"
        title={t("admin.weights.trim.heading")}
        count={t("admin.weights.count", { n: board.trim.length })}
      >
        <p className="text-xs text-co-text-muted">
          {board.observedTrimAvailable
            ? t("admin.weights.trim.hint")
            : t("admin.weights.trim.awaiting_capture")}
        </p>
        <ul className="mt-2 flex flex-col gap-2">
          {board.trim.map((row) => (
            <li key={row.itemId} className="border-b border-co-border/50 pb-2 last:border-b-0">
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-bold text-co-text">
                  {language === "es" && row.nameEs ? row.nameEs : row.name}
                </span>
                <span className="text-sm text-co-text">
                  {t("admin.weights.trim.standard", { pct: pct(row.standard.trim) })}
                </span>
                <AlertPill tone={row.standard.evidence === "PUBLISHED_YIELD_TABLE" ? "warn" : "info"}>
                  {t(
                    row.standard.evidence === "PUBLISHED_YIELD_TABLE"
                      ? "admin.weights.trim.evidence.published"
                      : row.standard.evidence === "VENDOR_PREPROCESSED"
                        ? "admin.weights.trim.evidence.vendor"
                        : "admin.weights.trim.evidence.estimate",
                  )}
                </AlertPill>
                <span className="text-xs text-co-text-muted">
                  {row.observedTrim == null
                    ? t("admin.weights.trim.observed_none")
                    : t("admin.weights.trim.observed", {
                        pct: pct(row.observedTrim),
                        n: row.observationCount,
                      })}
                </span>
                <span className="text-xs text-co-text-muted">{t(DRIFT_KEY[row.drift] ?? DRIFT_KEY.no_reference!)}</span>
              </span>
              <p className="mt-1 text-xs text-co-text-muted">{row.standard.rationale}</p>
            </li>
          ))}
        </ul>
      </CollapsibleSection>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className={metricLabelCls}>{label}</span>
      <span className="text-sm font-bold text-co-text">{value}</span>
    </span>
  );
}

/** Provenance, the spec reference beside the operational value, and the advisories. */
function RowDrawer({
  row,
  t,
  oz,
  money,
  pct,
  canWeigh,
  staged,
  onStage,
}: {
  row: WeightBoardRow;
  t: T;
  oz: (v: number | null) => string;
  money: (v: number | null) => string;
  pct: (v: number | null) => string;
  canWeigh: boolean;
  staged: boolean;
  onStage: () => void;
}) {
  const p = row.provenance;
  return (
    <>
      <section>
        <h3 className={groupHeaderCls}>{t("admin.weights.drawer.provenance")}</h3>
        <p className="mt-1 text-sm text-co-text-muted">
          {p.establishedByName
            ? t("admin.weights.provenance.by_person", { who: p.establishedByName })
            : p.seedScript
              ? // "seed · <script>" — the honest rendering when NOBODY established
                // it. Every seed-written weight audits with actorId null, so there
                // is genuinely no person to name and none is invented.
                t("admin.weights.provenance.by_seed", { script: p.seedScript })
              : t("admin.weights.provenance.unknown")}
          {row.belief.establishedAt
            ? ` · ${new Date(row.belief.establishedAt).toISOString().slice(0, 10)}`
            : ""}
        </p>
        {row.belief.sourceNote ? (
          <p className="mt-1 text-xs text-co-text-muted">{row.belief.sourceNote}</p>
        ) : null}
        {p.auditNote ? <p className="mt-1 text-xs text-co-text-muted">{p.auditNote}</p> : null}
      </section>

      {/* The SPEC reference rendered BESIDE the operational value — the spec's own
          wording. A spec that disagrees with live is the gap Juan's ruling
          documented (−20% to −60% on every deli item he actually weighed). */}
      {row.specOz != null || row.ruling ? (
        <section>
          <h3 className={groupHeaderCls}>{t("admin.weights.drawer.reference")}</h3>
          {row.specOz != null ? (
            <p className="mt-1 text-sm text-co-text-muted">
              {t("admin.weights.spec_says", { oz: oz(row.specOz) })}
            </p>
          ) : null}
          {row.ruling ? (
            <p className="mt-1 text-sm text-co-text-muted">
              {t(
                row.ruling.status === "RULED_KEEP_LIVE"
                  ? "admin.weights.ruling.keep_live"
                  : row.ruling.status === "RULED_DRIFTED"
                    ? "admin.weights.ruling.drifted"
                    : "admin.weights.ruling.unruled",
                { oz: oz(row.ruling.ruledOz) },
              )}
            </p>
          ) : null}
        </section>
      ) : null}

      {row.invoiceDrift || row.countImplicated ? (
        <section>
          <h3 className={groupHeaderCls}>{t("admin.weights.drawer.advisories")}</h3>
          {row.invoiceDrift ? (
            <p className="mt-1 text-sm text-co-text-muted">
              {t("admin.weights.advisory.invoice", {
                observed: oz(row.invoiceDrift.observedAvgOz),
                n: row.invoiceDrift.sampleCount,
                delta: pct(row.invoiceDrift.deltaFraction),
              })}
            </p>
          ) : null}
          {row.countImplicated ? (
            <p className="mt-1 text-sm text-co-text-muted">{t("admin.weights.advisory.count")}</p>
          ) : null}
        </section>
      ) : null}

      <section>
        <h3 className={groupHeaderCls}>{t("admin.weights.drawer.cost")}</h3>
        <p className="mt-1 text-sm text-co-text-muted">
          {t("admin.weights.cost_basis", {
            perOz: money(row.belief.costPerOz),
            usage: row.belief.usageOz == null ? "—" : oz(row.belief.usageOz),
          })}
        </p>
      </section>

      {canWeigh ? (
        <div>
          <button
            type="button"
            disabled={staged}
            aria-label={t("admin.weights.session.add_aria", { subject: row.belief.name })}
            onClick={onStage}
            className={secondaryBtnCls}
          >
            {staged ? t("admin.weights.session.added") : t("admin.weights.session.add")}
          </button>
        </div>
      ) : null}
    </>
  );
}

/**
 * The weigh session — owner-invoked, mirroring the /counts session flow: pick
 * subjects (or take the suggestions), enter measurements, commit.
 *
 * It stays MOUNTED and locked open while it holds staged edits, per the disclosure
 * doctrine's dirty-editor rule — a collapse that discarded a half-entered session
 * would lose measurements somebody already took off a scale.
 */
function WeighSession({
  t,
  oz,
  staged,
  busy,
  readyCount,
  onEdit,
  onRemove,
  onCommit,
}: {
  t: T;
  oz: (v: number | null) => string;
  staged: Array<{ staged: StagedMeasurement; parsed: number | null; valid: boolean }>;
  busy: boolean;
  readyCount: number;
  onEdit: (key: string, patch: Partial<StagedMeasurement>) => void;
  onRemove: (key: string) => void;
  onCommit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isOpen = open || staged.length > 0;

  return (
    <CollapsibleSection
      idBase="weights-session"
      title={t("admin.weights.session.heading")}
      count={staged.length > 0 ? t("admin.weights.session.count", { n: staged.length }) : null}
      open={isOpen}
      onToggle={() => setOpen((v) => !v)}
    >
      <p className="text-xs text-co-text-muted">{t("admin.weights.session.hint")}</p>
      {staged.length === 0 ? (
        <p className="mt-2 text-sm text-co-text-muted">{t("admin.weights.session.empty")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {staged.map(({ staged: s, valid }) => (
            <StagedRow
              key={stageKey(s.subjectKind, s.subjectId)}
              t={t}
              oz={oz}
              row={s}
              valid={valid || s.value.trim() === ""}
              busy={busy}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
      <div className="mt-3">
        <button
          type="button"
          disabled={busy || readyCount === 0}
          onClick={onCommit}
          className={primaryBtnCls}
        >
          {t("admin.weights.session.commit", { n: readyCount })}
        </button>
      </div>
    </CollapsibleSection>
  );
}

function StagedRow({
  t,
  oz,
  row,
  valid,
  busy,
  onEdit,
  onRemove,
}: {
  t: T;
  oz: (v: number | null) => string;
  row: StagedMeasurement;
  valid: boolean;
  busy: boolean;
  onEdit: (key: string, patch: Partial<StagedMeasurement>) => void;
  onRemove: (key: string) => void;
}) {
  const key = stageKey(row.subjectKind, row.subjectId);
  const valueId = useId();
  const noteId = useId();

  return (
    <li className="rounded-lg border-2 border-co-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-bold text-co-text">{row.name}</span>
          <span className="text-xs text-co-text-muted">{t(KIND_KEY[row.subjectKind])}</span>
          <span className="text-xs text-co-text-muted">
            {row.currentOz == null
              ? t("admin.weights.value_unknown")
              : t("admin.weights.session.current", { oz: oz(row.currentOz), unit: row.unit })}
          </span>
        </span>
        <button
          type="button"
          disabled={busy}
          aria-label={t("admin.weights.session.remove_aria", { subject: row.name })}
          onClick={() => onRemove(key)}
          className={secondaryBtnCls}
        >
          {t("admin.weights.session.remove")}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={valueId} className={fieldLabelCls}>
            {t("admin.weights.session.measured", { unit: row.unit })}
          </label>
          <input
            id={valueId}
            className={fieldCls}
            inputMode="decimal"
            value={row.value}
            disabled={busy}
            onChange={(e) => onEdit(key, { value: e.target.value })}
          />
        </div>
        <div className="grow">
          <label htmlFor={noteId} className={fieldLabelCls}>
            {t("admin.weights.session.note")}
          </label>
          <input
            id={noteId}
            className={fieldCls}
            value={row.note}
            disabled={busy}
            onChange={(e) => onEdit(key, { note: e.target.value })}
          />
        </div>
      </div>
      {!valid ? (
        <p className="mt-1 text-sm text-co-cta-text">{t("admin.weights.error.invalid_weight")}</p>
      ) : null}
    </li>
  );
}
