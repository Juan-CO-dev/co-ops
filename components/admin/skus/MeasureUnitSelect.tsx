"use client";

/**
 * MeasureUnitSelect (R1) — measure-unit dropdown whose MoO+ "+Add" collects
 * label + dimension + to-base-factor (recipe-math needs both). Mirrors
 * RegistrySelect's dropdown; replaces it at the each-measure / made-from-measure
 * spots. value/onChange carry the measure LABEL.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { postJson, resolveErrorKey } from "./shared";

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

export function MeasureUnitSelect({
  label,
  value,
  onChange,
  options,
  actorLevel,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ id: string; label: string }>;
  actorLevel: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const canAdd = actorLevel >= 8; // MoO+

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [dimension, setDimension] = useState<"weight" | "volume" | "count">("weight");
  const [factor, setFactor] = useState("");

  const labels = options.map((o) => o.label);
  const valueMissing = value.trim() !== "" && !labels.includes(value);

  const add = async () => {
    if (busy) return;
    const lbl = newLabel.trim();
    const f = Number(factor);
    if (!lbl || !Number.isFinite(f) || f <= 0) { window.alert(t(resolveErrorKey("invalid_factor"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson("/api/admin/skus/measure-units", { label: lbl, dimension, toBaseFactor: f }, "POST");
    setBusy(false);
    if (result.ok) {
      onChange(lbl);
      setOpen(false); setNewLabel(""); setFactor(""); setDimension("weight");
      router.refresh();
    } else {
      window.alert(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <label className="block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      <select className={fieldCls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {valueMissing ? <option value={value}>{value}</option> : null}
        {labels.map((l) => (<option key={l} value={l}>{l}</option>))}
      </select>
      {canAdd ? (
        open ? (
          <div className="mt-2 flex flex-col gap-2 rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
            <input className={fieldCls} placeholder={t("admin.skus.measure.add_label")} value={newLabel} disabled={busy} onChange={(e) => setNewLabel(e.target.value)} />
            <select className={fieldCls} value={dimension} disabled={busy} onChange={(e) => setDimension(e.target.value as "weight" | "volume" | "count")}>
              <option value="weight">{t("admin.skus.measure.dimension_weight")}</option>
              <option value="volume">{t("admin.skus.measure.dimension_volume")}</option>
              <option value="count">{t("admin.skus.measure.dimension_count")}</option>
            </select>
            <input className={fieldCls} type="number" min={0} step="any" inputMode="decimal" placeholder={t("admin.skus.measure.add_factor")} value={factor} disabled={busy} onChange={(e) => setFactor(e.target.value)} />
            <p className="text-xs text-co-text-muted">{t("admin.skus.measure.factor_hint")}</p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setOpen(false)} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text disabled:opacity-50">{t("admin.skus.cancel")}</button>
              <button type="button" disabled={busy} onClick={() => void add()} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">{t("admin.skus.measure.add_submit")}</button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50">
            {t("admin.skus.measure.add_button")}
          </button>
        )
      ) : null}
    </label>
  );
}
