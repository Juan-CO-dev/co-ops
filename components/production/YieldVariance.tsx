"use client";

/**
 * Yield variance (batch vs bottle PHASE B) — the level 5+ read of how batches come out against
 * the recipe card, with the GM nudges on top.
 *
 * Disclosure doctrine: the alerts (recipe nudges, maker retrain items, open retrains) are always
 * visible at the top (D2); the per-recipe detail is default-collapsed with an i18n'd count and the
 * direction badge on the header (D3/D5); every toggle is a full-row 44px button (CollapsibleSection).
 * Actions render only for a GM bound to this shop (view.canAct). Shift leads — and a level-8
 * reader on a shop they are not assigned to — are VIEW-ONLY and see a hint instead.
 * Update recipe yield asks for the Tier-B step-up (PasswordModal) when the route says so.
 * When 0218 is missing the page shows an explicit "unavailable" state and nothing else.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ActionButton } from "@/components/ActionButton";
import { PasswordModal } from "@/components/auth/PasswordModal";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { MarkRetrainDone } from "@/components/production/RetrainTaskList";
import { formatDateLabel } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import { etCalendarDate } from "@/lib/operational-day";
import type { Language, TranslationKey, TranslationParams } from "@/lib/i18n/types";
import type { RetrainAssigneeOption, YieldItemView, YieldLineView, YieldVarianceView } from "@/lib/yield-stats";
import {
  YIELD_NUDGE_MIN_BATCHES,
  YIELD_STATS_WINDOW,
  directionKey,
  formatSignedPct,
  type DriftSummary,
  type ScopeVerdict,
} from "@/lib/yield-stats-shared";

type T = (key: TranslationKey, params?: TranslationParams) => string;

function fmtNum(n: number, language: Language): string {
  const s = String(Math.round(n * 100) / 100);
  return language === "es" ? s.replace(".", ",") : s;
}
function recipeLabel(item: YieldItemView, language: Language): string {
  if (language === "es") return item.recipeNameEs ?? item.recipeName ?? item.itemNameEs ?? item.itemName;
  return item.recipeName ?? item.itemName;
}
function directionText(t: T, s: DriftSummary, language: Language): string {
  return t(directionKey(s.direction), { pct: formatSignedPct(s.signedDrift, language) });
}

/**
 * The retrain status line for a scope: "Retrain assigned to <KH> — open" while open, "Retrained
 * <date> by <KH>" once done (plus how many batches the snooze still holds), or "held by the recipe
 * retrain" for a maker item held through the recipe's note.
 */
function RetrainStatus({ t, language, item, verdict, canAct }: { t: T; language: Language; item: YieldItemView; verdict: ScopeVerdict; canAct: boolean }) {
  if (verdict.hold?.via === "recipe") return <p className="text-xs text-co-text-muted">{t("yield.retrain.held_by_recipe")}</p>;
  const noteId = verdict.hold?.noteId ?? verdict.latestNoteId;
  const note = noteId ? item.notes[noteId] : undefined;
  if (!note) return null;
  if (note.status === "open") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-co-warning-text">{t("yield.retrain.status_open", { name: note.assignedToName ?? "—" })}</p>
        {canAct ? <MarkRetrainDone noteId={note.id} /> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs text-co-confirm-text">
        {t("yield.retrain.status_done", { date: note.doneAt ? formatDateLabel(etCalendarDate(note.doneAt), language) : "", name: note.doneByName ?? "—" })}
      </p>
      {verdict.hold?.snoozed ? <p className="text-[11px] text-co-text-dim">{t("yield.retrain.batches_left", { n: verdict.hold.remaining })}</p> : null}
    </div>
  );
}

export function YieldVariance({ view, dateLabels }: { view: YieldVarianceView; dateLabels: Record<string, string> }) {
  const { t, language } = useTranslation();
  if (view.unavailable) {
    return <p role="status" className="co-card p-4 text-sm text-co-text-muted">{t("yield.view.unavailable")}</p>;
  }
  if (view.items.length === 0) {
    return <p className="text-sm text-co-text-muted">{t("yield.view.none")}</p>;
  }
  const recipeNudges = view.items.filter((i) => i.verdict.recipe.nudge);
  const makerNudges = view.items.flatMap((i) => i.verdict.makers.filter((m) => m.nudge).map((m) => ({ item: i, maker: m })));
  // Open retrains replace their nudge in the attention list ("assigned to <KH> — open").
  const openRecipe = view.items.filter((i) => i.verdict.recipe.hold?.open && i.verdict.recipe.hold.via === "own");
  const openMaker = view.items.flatMap((i) => i.verdict.makers.filter((m) => m.hold?.open && m.hold.via === "own").map((m) => ({ item: i, maker: m })));
  const quiet = recipeNudges.length + makerNudges.length + openRecipe.length + openMaker.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-co-text-muted">{t("yield.view.intro", { window: YIELD_STATS_WINDOW, min: YIELD_NUDGE_MIN_BATCHES })}</p>

      <section className="flex flex-col gap-2" aria-labelledby="yield-attention">
        <h2 id="yield-attention" className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{t("yield.view.needs_attention")}</h2>
        {quiet ? <p className="text-xs text-co-text-muted">{t("yield.view.nothing_urgent")}</p> : null}
        {!view.canAct && !quiet ? <p className="text-[11px] text-co-text-dim">{t("yield.nudge.gm_only")}</p> : null}
        {recipeNudges.map((item) => {
          const s = item.verdict.recipe.summary!;
          const names = item.verdict.recipe.outlierMakerIds.map((id) => item.makerNames[id] ?? t("yield.view.unknown_maker"));
          return (
            <div key={`r-${item.itemId}`} className="co-card flex flex-col gap-2 border-l-4 border-l-co-warning p-4">
              <p className="text-sm font-bold text-co-text">
                {t("yield.nudge.recipe_title", { recipe: recipeLabel(item, language), direction: directionText(t, s, language), n: fmtNum(s.batches, language) })}
              </p>
              <p className="text-xs text-co-text-muted">
                {t("yield.view.card", { n: fmtNum(s.cardPerBatch, language), unit: item.unit ?? "" })} · {t("yield.view.average", { n: fmtNum(s.actualPerBatch, language), unit: item.unit ?? "" })}
              </p>
              {names.length > 0 ? <p className="text-xs text-co-text">{t("yield.nudge.outliers", { names: names.join(", ") })}</p> : null}
              {view.canAct ? (
                <NudgeActions t={t} locationId={view.locationId} itemId={item.itemId} scope="recipe" makerId={null}
                  updatable={item.updatable} suggested={Math.round(s.actualPerBatch * 100) / 100} unit={item.unit} assignees={view.assignees} />
              ) : null}
            </div>
          );
        })}
        {makerNudges.map(({ item, maker }) => {
          const s = maker.summary!;
          return (
            <div key={`m-${item.itemId}-${maker.makerId}`} className="co-card flex flex-col gap-2 border-l-4 border-l-co-warning p-4">
              <p className="text-sm font-bold text-co-text">
                {t("yield.employee.item", { name: item.makerNames[maker.makerId] ?? t("yield.view.unknown_maker"), recipe: recipeLabel(item, language), direction: directionText(t, s, language) })}
              </p>
              <p className="text-xs text-co-text-muted">{t("yield.view.count", { n: fmtNum(s.batches, language) })}</p>
              {view.canAct ? (
                <NudgeActions t={t} locationId={view.locationId} itemId={item.itemId} scope="maker" makerId={maker.makerId}
                  updatable={false} suggested={null} unit={item.unit} assignees={view.assignees} />
              ) : null}
            </div>
          );
        })}
        {openRecipe.map((item) => (
          <div key={`or-${item.itemId}`} className="co-card flex flex-col gap-1 p-4">
            <p className="text-sm font-bold text-co-text">{recipeLabel(item, language)}</p>
            <RetrainStatus t={t} language={language} item={item} verdict={item.verdict.recipe} canAct={view.canAct} />
          </div>
        ))}
        {openMaker.map(({ item, maker }) => (
          <div key={`om-${item.itemId}-${maker.makerId}`} className="co-card flex flex-col gap-1 p-4">
            <p className="text-sm font-bold text-co-text">{recipeLabel(item, language)} · {item.makerNames[maker.makerId] ?? t("yield.view.unknown_maker")}</p>
            <RetrainStatus t={t} language={language} item={item} verdict={maker} canAct={view.canAct} />
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="yield-by-recipe">
        <h2 id="yield-by-recipe" className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{t("yield.view.by_recipe")}</h2>
        {view.items.map((item) => {
          const s = item.verdict.recipe.summary;
          return (
            <CollapsibleSection
              key={item.itemId}
              idBase={`yield-${item.itemId}`}
              title={recipeLabel(item, language)}
              count={t("yield.view.count", { n: fmtNum(s?.batches ?? 0, language) })}
              badge={s && s.enough ? <DirectionBadge text={directionText(t, s, language)} flagged={s.flagged} /> : null}
            >
              <div className="flex flex-col gap-3 px-4 pb-4">
                <SummaryBlock t={t} language={language} s={s} unit={item.unit} />
                <RetrainStatus t={t} language={language} item={item} verdict={item.verdict.recipe} canAct={false} />
                <BatchLines t={t} language={language} lines={item.lines} n={s?.batches ?? 0} unit={item.unit} dateLabels={dateLabels} />
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("yield.view.by_maker")}</p>
                  {item.verdict.makers.map((m) => (
                    <CollapsibleSection
                      key={m.makerId}
                      idBase={`yield-${item.itemId}-${m.makerId}`}
                      title={item.makerNames[m.makerId] ?? t("yield.view.unknown_maker")}
                      count={t("yield.view.count", { n: fmtNum(m.summary?.batches ?? 0, language) })}
                      badge={m.summary && m.summary.enough ? <DirectionBadge text={directionText(t, m.summary, language)} flagged={m.summary.flagged} /> : null}
                    >
                      <div className="flex flex-col gap-2 px-4 pb-4">
                        <SummaryBlock t={t} language={language} s={m.summary} unit={item.unit} />
                        <RetrainStatus t={t} language={language} item={item} verdict={m} canAct={false} />
                        <BatchLines t={t} language={language} lines={item.makerLines[m.makerId] ?? []} n={m.summary?.batches ?? 0} unit={item.unit} dateLabels={dateLabels} />
                      </div>
                    </CollapsibleSection>
                  ))}
                </div>
              </div>
            </CollapsibleSection>
          );
        })}
      </section>
    </div>
  );
}

function DirectionBadge({ text, flagged }: { text: string; flagged: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${flagged ? "bg-co-warning-surface text-co-warning-text" : "bg-co-surface-inset text-co-text-muted"}`}>
      {text}
    </span>
  );
}

function SummaryBlock({ t, language, s, unit }: { t: T; language: Language; s: DriftSummary | null; unit: string | null }) {
  if (!s) return null;
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <p className="text-co-text">
        {t("yield.view.card", { n: fmtNum(s.cardPerBatch, language), unit: unit ?? "" })} · {t("yield.view.average", { n: fmtNum(s.actualPerBatch, language), unit: unit ?? "" })}
      </p>
      <p className={s.flagged ? "font-bold text-co-warning-text" : "text-co-text-muted"}>{directionText(t, s, language)}</p>
      {!s.enough ? <p className="text-xs text-co-text-dim">{t("yield.view.too_few", { n: YIELD_NUDGE_MIN_BATCHES })}</p> : null}
    </div>
  );
}

function BatchLines({ t, language, lines, n, unit, dateLabels }: { t: T; language: Language; lines: YieldLineView[]; n: number; unit: string | null; dateLabels: Record<string, string> }) {
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("yield.view.batches_header", { n: fmtNum(n, language) })}</p>
      <ul className="flex flex-col gap-1">
        {lines.map((l) => (
          <li key={l.id} className="rounded-lg border border-co-border bg-co-surface px-3 py-1.5 text-xs text-co-text">
            {t("yield.view.batch_line", {
              date: dateLabels[l.id] ?? "",
              name: l.makerName ?? t("yield.view.unknown_maker"),
              batches: l.batchesMade,
              actual: fmtNum(l.cameOutTo, language),
              unit: unit ?? "",
              card: fmtNum(l.batchesMade * l.yieldAtTime, language),
            })}
            {l.weight < 1 ? <span className="text-co-text-dim"> · {t("yield.view.partial", { n: fmtNum(l.weight * l.batchesMade, language) })}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

const KNOWN_ERRORS = new Set(["no_active_nudge", "forbidden", "invalid_yield", "not_batch_recipe", "invalid_note", "invalid_assignee", "not_found", "yield_unavailable"]);

function NudgeActions({ t, locationId, itemId, scope, makerId, updatable, suggested, unit, assignees }: {
  t: T;
  locationId: string;
  itemId: string;
  scope: "recipe" | "maker";
  makerId: string | null;
  updatable: boolean;
  suggested: number | null;
  unit: string | null;
  assignees: RetrainAssigneeOption[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "update" | "retrain">("idle");
  const [yieldText, setYieldText] = useState(suggested !== null ? String(suggested) : "");
  const [note, setNote] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const pendingRef = useRef<null | (() => void)>(null);

  const fail = (code: string | undefined) => setErr(t(("yield.error." + (code && KNOWN_ERRORS.has(code) ? code : "generic")) as TranslationKey));

  const saveYield = async () => {
    setBusy(true); setErr(null);
    const res = await fetch("/api/admin/recipes/yield-nudge", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ locationId, itemId, yield: Number(yieldText) }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) { setMode("idle"); router.refresh(); return; }
    const j = (await res?.json().catch(() => null)) as { code?: string } | null;
    if (j?.code === "step_up_required" || j?.code === "step_up_stale") {
      pendingRef.current = () => void saveYield();
      setStepUpOpen(true);
      return;
    }
    fail(j?.code);
  };

  const saveRetrain = async () => {
    setBusy(true); setErr(null);
    const res = await fetch("/api/operations/production/yield/retrain", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ locationId, itemId, scope, makerId, note, assignedTo: assignedTo || null }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) { setDone(true); setMode("idle"); router.refresh(); return; }
    const j = (await res?.json().catch(() => null)) as { code?: string } | null;
    fail(j?.code);
  };

  if (done) return <p className="text-xs font-semibold text-co-confirm-text">{t("yield.nudge.snoozed", { n: YIELD_STATS_WINDOW })}</p>;

  return (
    <div className="flex flex-col gap-2">
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          {scope === "recipe" && updatable ? (
            <ActionButton variant="secondary" onClick={() => { setErr(null); setMode("update"); }}>{t("yield.nudge.update_yield")}</ActionButton>
          ) : null}
          <ActionButton variant="secondary" onClick={() => { setErr(null); setMode("retrain"); }}>{t("yield.nudge.retrain")}</ActionButton>
        </div>
      ) : null}
      {mode === "update" ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("yield.nudge.new_yield_label", { unit: unit ?? "" })}</span>
            <input type="number" inputMode="decimal" min={0} step="any" value={yieldText} disabled={busy}
              onChange={(e) => setYieldText(e.target.value)}
              className="min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm text-co-text"
              aria-label={t("yield.nudge.new_yield_label", { unit: unit ?? "" })} />
          </label>
          <div className="flex flex-wrap gap-2">
            <ActionButton disabled={busy || !(Number(yieldText) > 0)} onClick={() => void saveYield()}>{t("yield.nudge.save_yield")}</ActionButton>
            <ActionButton variant="secondary" disabled={busy} onClick={() => setMode("idle")}>{t("yield.nudge.cancel")}</ActionButton>
          </div>
        </div>
      ) : null}
      {mode === "retrain" ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("yield.retrain.assign_label")}</span>
            <select value={assignedTo} disabled={busy} onChange={(e) => setAssignedTo(e.target.value)}
              aria-label={t("yield.retrain.assign_label")}
              className="min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm text-co-text">
              <option value="">{t("yield.retrain.assign_self")}</option>
              {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("yield.nudge.retrain_note_label")}</span>
            <textarea value={note} maxLength={500} disabled={busy} rows={2}
              onChange={(e) => setNote(e.target.value)} placeholder={t("yield.nudge.retrain_note_hint")}
              className="min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text"
              aria-label={t("yield.nudge.retrain_note_label")} />
          </label>
          <div className="flex flex-wrap gap-2">
            <ActionButton disabled={busy} onClick={() => void saveRetrain()}>{t("yield.nudge.confirm_retrain")}</ActionButton>
            <ActionButton variant="secondary" disabled={busy} onClick={() => setMode("idle")}>{t("yield.nudge.cancel")}</ActionButton>
          </div>
        </div>
      ) : null}
      {err ? <p role="alert" className="text-xs font-semibold text-co-cta-text">{err}</p> : null}
      <PasswordModal
        open={stepUpOpen}
        onConfirm={() => { setStepUpOpen(false); const p = pendingRef.current; pendingRef.current = null; p?.(); }}
        onCancel={() => { setStepUpOpen(false); pendingRef.current = null; }}
      />
    </div>
  );
}
