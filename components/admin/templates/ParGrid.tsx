"use client";

/**
 * ParGrid (Item/Inventory Spine 2B′) — the per-location par editor extracted
 * from the 2B PrepItemEditPanel. Renders the all-days base row + 7 per-day rows
 * + par_mode, and saves each row independently via PATCH
 * `…/[templateId]/items/[lineId]/par` (AGM+, Tier A step-up).
 *
 * Self-contained: owns its own base/days/parUnit state, seeded from the line's
 * PrepLineParContext. Used on the LOCATION tab only — the Global tab edits the
 * item definition, not per-location overrides.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { ParMode } from "@/lib/types";
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

function seedDay(overrides: PrepLineParContext["overrides"], dayOfWeek: number | null): DayState {
  const row = overrides.find((o) => o.dayOfWeek === dayOfWeek);
  if (!row) return { parValue: "", parMode: "inherit" };
  return {
    parValue: row.parValue != null ? row.parValue.toString() : "",
    parMode: row.parMode,
  };
}

export function ParGrid({
  templateId,
  lineId,
  locationId,
  parCtx,
}: {
  templateId: string;
  lineId: string;
  locationId: string;
  parCtx: PrepLineParContext;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [base, setBase] = useState<DayState>(() => seedDay(parCtx.overrides, null));
  const [days, setDays] = useState<DayState[]>(() => DAY_KEYS.map((_, i) => seedDay(parCtx.overrides, i)));
  const [parUnit, setParUnit] = useState(
    parCtx.overrides.find((o) => o.dayOfWeek === null)?.parUnit ?? parCtx.recommendedParUnit ?? "",
  );

  const field =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";
  const smallBtn =
    "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50";

  const savePar = async (dayOfWeek: number | null, state: DayState) => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setSubmitting(true);
    // inherit → take the recommendation: send parValue=null.
    const parValue =
      state.parMode === "inherit" ? null : state.parValue.trim() === "" ? null : Number(state.parValue);
    const result = await postJson(
      `/api/admin/checklist-templates/${templateId}/items/${lineId}/par`,
      { locationId, dayOfWeek, parValue, parUnit: parUnit.trim() || null, parMode: state.parMode },
      "PATCH",
    );
    setSubmitting(false);
    if (result.ok) router.refresh();
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  return (
    <section className="rounded-lg border-2 border-co-border p-3">
      <h3 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
        {t("admin.templates.par_grid.title")}
      </h3>
      {errorMsg ? <p className="mt-2 text-sm text-co-cta">{errorMsg}</p> : null}
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
          onChange={(next) => setDays((prev) => prev.map((d, j) => (j === i ? next : d)))}
          onSave={() => void savePar(i, days[i]!)}
        />
      ))}
      <p className="mt-2 text-xs text-co-text-muted">{t("admin.templates.par_grid.auto_note")}</p>
    </section>
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
            <option key={m} value={m}>
              {t(`admin.templates.par_grid.mode.${m}` as TranslationKey)}
            </option>
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
