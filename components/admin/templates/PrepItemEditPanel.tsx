"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { ChecklistTemplateItem, ParMode } from "@/lib/types";
import { PREP_SECTIONS } from "@/lib/prep-sections";
import type { TranslationKey } from "@/lib/i18n/types";
import type { PrepLineParContext } from "@/lib/admin/templates";
import { postJson, resolveErrorKey } from "./shared";

/** Sun–Sat, indexed 0–6 (JS getDay convention). null = all-days base. */
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const PAR_MODES: ParMode[] = ["inherit", "manual", "auto"];

interface DayState {
  parValue: string;
  parMode: ParMode;
}

function seedDay(
  overrides: PrepLineParContext["overrides"],
  dayOfWeek: number | null,
): DayState {
  const row = overrides.find((o) => o.dayOfWeek === dayOfWeek);
  if (!row) return { parValue: "", parMode: "inherit" };
  return {
    parValue: row.parValue != null ? row.parValue.toString() : "",
    parMode: row.parMode,
  };
}

export function PrepItemEditPanel({
  templateId,
  item,
  actorLevel,
  locationId,
  parCtx,
}: {
  templateId: string;
  item: ChecklistTemplateItem;
  actorLevel: number;
  locationId: string;
  parCtx: PrepLineParContext;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const es = item.translations?.es ?? {};
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Par grid state: base (all-days) + per-day (0–6) ──────────────────────
  const [base, setBase] = useState<DayState>(() => seedDay(parCtx.overrides, null));
  const [days, setDays] = useState<DayState[]>(() =>
    DAY_KEYS.map((_, i) => seedDay(parCtx.overrides, i)),
  );
  const [parUnit, setParUnit] = useState(
    parCtx.overrides.find((o) => o.dayOfWeek === null)?.parUnit ?? parCtx.recommendedParUnit ?? "",
  );

  // ── Global definition state (MoO+) ───────────────────────────────────────
  // Recommendation seeds from the ITEM's default_par (the true global value),
  // NOT the vestigial line prep_meta.
  const [labelEn, setLabelEn] = useState(item.label);
  const [labelEs, setLabelEs] = useState(es.label ?? "");
  const [defParValue, setDefParValue] = useState(parCtx.recommendedPar?.toString() ?? "");
  const [defParUnit, setDefParUnit] = useState(parCtx.recommendedParUnit ?? "");

  // ── Line content state (GM+) ─────────────────────────────────────────────
  const [siEn, setSiEn] = useState(item.prepMeta?.specialInstruction ?? "");
  const [siEs, setSiEs] = useState(es.specialInstruction ?? "");
  const [required, setRequired] = useState(item.required);
  const [minRole, setMinRole] = useState(item.minRoleLevel.toString());
  const [section, setSection] = useState(item.station ?? "");

  const base_url = `/api/admin/checklist-templates/${templateId}/items/${item.id}`;

  // Header summary: the resolved all-days par (manual base override else the
  // recommendation) — NOT the vestigial line prep_meta.
  const baseRow = parCtx.overrides.find((o) => o.dayOfWeek === null);
  const headerPar = baseRow && baseRow.parMode === "manual" ? baseRow.parValue : parCtx.recommendedPar;
  const headerParUnit = baseRow?.parUnit ?? parCtx.recommendedParUnit;

  const fail = (code: string) => setErrorMsg(t(resolveErrorKey(code)));

  // ── Par override save (AGM+, Tier A) ─────────────────────────────────────
  const savePar = async (dayOfWeek: number | null, state: DayState) => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setSubmitting(true);
    // inherit → take the recommendation: send parValue=null.
    const parValue =
      state.parMode === "inherit" ? null : state.parValue.trim() === "" ? null : Number(state.parValue);
    const result = await postJson(
      `${base_url}/par`,
      { locationId, dayOfWeek, parValue, parUnit: parUnit.trim() || null, parMode: state.parMode },
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) router.refresh();
    else fail(result.code);
  };

  // ── Global definition save (MoO+, Tier B) ────────────────────────────────
  const saveDefinition = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!labelEn.trim()) { fail("invalid_label"); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `${base_url}/definition`,
      {
        label: labelEn.trim(),
        labelEs: labelEs.trim() || null,
        parValue: defParValue.trim() === "" ? null : Number(defParValue),
        parUnit: defParUnit.trim() || null,
      },
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) { setOpen(false); router.refresh(); }
    else fail(result.code);
  };

  // ── Line content save (GM+, Tier A) ──────────────────────────────────────
  const saveContent = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      base_url,
      {
        specialInstruction: siEn.trim() || null,
        specialInstructionEs: siEs.trim() || null,
        required,
      },
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) router.refresh();
    else fail(result.code);
  };

  const saveMinRole = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(`${base_url}/min-role`, { minRoleLevel: Number(minRole) }, "PATCH");
    setSubmitting(false);
    if (result.ok) router.refresh();
    else fail(result.code);
  };

  const saveSection = async () => {
    if (submitting || !section || section === item.station) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(`${base_url}/section`, { section }, "PATCH");
    setSubmitting(false);
    if (result.ok) router.refresh();
    else fail(result.code);
  };

  const removeItem = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!window.confirm(t("admin.templates.remove_confirm"))) return;
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(base_url, {}, "DELETE");
    setSubmitting(false);
    if (result.ok) router.refresh();
    else fail(result.code);
  };

  const promote = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!window.confirm(t("admin.templates.promote.confirm"))) return;
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(`${base_url}/promote`, {}, "POST");
    setSubmitting(false);
    if (result.ok) router.refresh();
    else fail(result.code);
  };

  const field =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";
  const smallBtn =
    "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50";

  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-co-text">
          {item.label}
          {headerPar != null ? (
            <span className="ml-2 text-co-text-muted">
              {t("admin.templates.field.par_value")}: {headerPar}
              {headerParUnit ? ` ${headerParUnit}` : ""}
            </span>
          ) : null}
          {parCtx.itemGlobal ? (
            <span className="ml-2 rounded border border-co-gold-deep px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-co-gold-deep">
              {t("admin.templates.global_badge")}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={smallBtn}
        >
          {t("admin.templates.edit")}
        </button>
      </div>

      {open ? (
        <div className="mt-3 flex flex-col gap-3">
          {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}

          {/* ── PAR GRID (AGM+ — everyone who reached the page) ────────────── */}
          <section className="rounded-lg border-2 border-co-border p-3">
            <h3 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
              {t("admin.templates.par_grid.title")}
            </h3>
            <Labeled label={t("admin.templates.field.par_unit")}>
              <input className={field} value={parUnit} onChange={(e) => setParUnit(e.target.value)} />
            </Labeled>

            <ParRow
              label={t("admin.templates.par_grid.all_days")}
              state={base}
              field={field}
              smallBtn={smallBtn}
              submitting={submitting}
              t={t}
              onChange={setBase}
              onSave={() => void savePar(null, base)}
            />
            {DAY_KEYS.map((dk, i) => (
              <ParRow
                key={dk}
                label={t(`admin.templates.par_grid.day.${dk}` as TranslationKey)}
                state={days[i]!}
                field={field}
                smallBtn={smallBtn}
                submitting={submitting}
                t={t}
                onChange={(next) =>
                  setDays((prev) => prev.map((d, j) => (j === i ? next : d)))
                }
                onSave={() => void savePar(i, days[i]!)}
              />
            ))}
            <p className="mt-2 text-xs text-co-text-muted">{t("admin.templates.par_grid.auto_note")}</p>
          </section>

          {/* ── LINE CONTENT (GM+ ≥7) ─────────────────────────────────────── */}
          {actorLevel >= 7 ? (
            <section className="rounded-lg border-2 border-co-border p-3">
              <h3 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
                {t("admin.templates.line_content.title")}
              </h3>
              <Labeled label={t("admin.templates.field.special_instruction")}>
                <textarea className={field} value={siEn} onChange={(e) => setSiEn(e.target.value)} />
              </Labeled>
              <Labeled label={t("admin.templates.field.special_instruction_es")}>
                <textarea className={field} value={siEs} onChange={(e) => setSiEs(e.target.value)} />
              </Labeled>
              <label className="mt-2 flex items-center gap-2 text-sm text-co-text">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-co-gold"
                  checked={required}
                  onChange={(e) => setRequired(e.target.checked)}
                />
                {t("admin.templates.field.required")}
              </label>
              <div className="mt-3 flex justify-end">
                <button type="button" disabled={submitting} onClick={() => void saveContent()}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">
                  {t("admin.templates.save")}
                </button>
              </div>
            </section>
          ) : null}

          {/* ── GLOBAL DEFINITION (MoO+ ≥8) ───────────────────────────────── */}
          {actorLevel >= 8 ? (
            <section className="rounded-lg border-2 border-co-border p-3">
              <h3 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
                {t("admin.templates.definition.title")}
              </h3>
              <Labeled label={t("admin.templates.field.label_en")}>
                <input className={field} value={labelEn} onChange={(e) => setLabelEn(e.target.value)} />
              </Labeled>
              <Labeled label={t("admin.templates.field.label_es")}>
                <input className={field} value={labelEs} onChange={(e) => setLabelEs(e.target.value)} />
              </Labeled>
              <Labeled label={t("admin.templates.definition.recommendation")}>
                <input className={field} inputMode="decimal" value={defParValue} onChange={(e) => setDefParValue(e.target.value)} />
              </Labeled>
              <Labeled label={t("admin.templates.field.par_unit")}>
                <input className={field} value={defParUnit} onChange={(e) => setDefParUnit(e.target.value)} />
              </Labeled>
              <p className="mt-2 text-xs text-co-text-muted">{t("admin.templates.definition.blast_radius_note")}</p>
              <div className="mt-3 flex justify-end">
                <button type="button" disabled={submitting} onClick={() => void saveDefinition()}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">
                  {t("admin.templates.save")}
                </button>
              </div>
            </section>
          ) : null}

          {/* ── PROMOTE (MoO+ ≥8, only when not already global) ───────────── */}
          {actorLevel >= 8 && !parCtx.itemGlobal && parCtx.itemId ? (
            <div className="rounded-lg border-2 border-co-border p-3">
              <button type="button" disabled={submitting} onClick={() => void promote()} className={smallBtn}>
                {t("admin.templates.promote.button")}
              </button>
            </div>
          ) : null}

          {/* ── MIN ROLE + SECTION (≥7 routes) ────────────────────────────── */}
          {actorLevel >= 7 ? (
            <>
              <div className="rounded-lg border-2 border-co-border p-3">
                <p className="text-xs text-co-text-muted">{t("admin.templates.min_role.hint")}</p>
                <div className="mt-2 flex items-end gap-2">
                  <Labeled label={t("admin.templates.field.min_role_level")}>
                    <input className={field} inputMode="numeric" value={minRole} onChange={(e) => setMinRole(e.target.value)} />
                  </Labeled>
                  <button type="button" disabled={submitting} onClick={() => void saveMinRole()} className={smallBtn}>
                    {t("admin.templates.min_role.change")}
                  </button>
                </div>
              </div>

              <div className="rounded-lg border-2 border-co-border p-3">
                <Labeled label={t("admin.templates.field.section")}>
                  <div className="flex items-end gap-2">
                    <select className={field} value={section} onChange={(e) => setSection(e.target.value)}>
                      {PREP_SECTIONS.map((s) => (
                        <option key={s} value={s}>{t(`admin.templates.section.${s}` as TranslationKey)}</option>
                      ))}
                    </select>
                    <button type="button" disabled={submitting} onClick={() => void saveSection()} className={smallBtn}>
                      {t("admin.templates.change_section")}
                    </button>
                  </div>
                </Labeled>
              </div>

              <div className="rounded-lg border-2 border-co-border p-3">
                <button type="button" disabled={submitting} onClick={() => void removeItem()}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-surface px-3 text-xs font-bold text-co-cta hover:bg-co-cta hover:text-co-surface disabled:opacity-50">
                  {t("admin.templates.remove")}
                </button>
              </div>
            </>
          ) : null}

          <div className="flex justify-end">
            <button type="button" disabled={submitting} onClick={() => setOpen(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50">
              {t("admin.templates.cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ParRow({
  label,
  state,
  field,
  smallBtn,
  submitting,
  t,
  onChange,
  onSave,
}: {
  label: string;
  state: DayState;
  field: string;
  smallBtn: string;
  submitting: boolean;
  t: (k: TranslationKey) => string;
  onChange: (next: DayState) => void;
  onSave: () => void;
}) {
  const inherit = state.parMode === "inherit";
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <span className="min-w-[5rem] text-sm font-bold text-co-text">{label}</span>
      <label className="flex-1">
        <span className="sr-only">{`${label} — ${t("admin.templates.field.par_value")}`}</span>
        <input
          className={field}
          inputMode="decimal"
          disabled={inherit}
          value={inherit ? "" : state.parValue}
          placeholder={inherit ? t("admin.templates.par_grid.inherit_placeholder") : ""}
          onChange={(e) => onChange({ ...state, parValue: e.target.value })}
        />
      </label>
      <label>
        <span className="sr-only">{`${label} — ${t("admin.templates.par_grid.mode_label")}`}</span>
        <select
          className={field}
          value={state.parMode}
          onChange={(e) => onChange({ ...state, parMode: e.target.value as ParMode })}
        >
          {PAR_MODES.map((m) => (
            <option key={m} value={m}>{t(`admin.templates.par_grid.mode.${m}` as TranslationKey)}</option>
          ))}
        </select>
      </label>
      <button type="button" disabled={submitting} onClick={onSave} className={smallBtn}>
        {t("admin.templates.save")}
      </button>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-2 block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      {children}
    </label>
  );
}
