"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { postJson, resolveErrorKey } from "@/components/admin/templates/shared";

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-2 block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      {children}
    </label>
  );
}

/**
 * UnitSelect (Units Registry slice) — the unit dropdown sourced from the global
 * `units` registry (no free typing → no drift). `value`/`onChange` carry the
 * unit LABEL (the system key). A blank "—" option clears the unit. When
 * `actorLevel >= 8` (MoO+) a "+ Add unit" control posts a new label to the
 * registry (Tier B step-up) and refreshes so the new unit appears here.
 */
export function UnitSelect({
  label,
  value,
  onChange,
  units,
  actorLevel,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  units: Array<{ label: string }>;
  actorLevel: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const canAddUnit = actorLevel >= 8; // MoO+
  const [adding, setAdding] = useState(false);

  const field =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

  // The current value may be a label no longer in the active registry (e.g. a
  // legacy free-typed value from before the registry). Keep it selectable so we
  // never silently clear it.
  const labels = units.map((u) => u.label);
  const hasValue = value.trim() !== "";
  const valueMissing = hasValue && !labels.includes(value);

  const addUnit = async () => {
    if (adding) return;
    const raw = window.prompt(t("admin.templates.add_unit_prompt"));
    const next = raw?.trim();
    if (!next) return;
    if ((await requestStepUp("B")) !== "ok") return;
    setAdding(true);
    const result = await postJson(
      `/api/admin/checklist-templates/units`,
      { label: next },
      "POST",
    );
    setAdding(false);
    if (result.ok) {
      onChange(next);
      router.refresh();
    } else {
      window.alert(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <Labeled label={label}>
      <select className={field} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("admin.templates.unit_blank_option")}</option>
        {valueMissing ? <option value={value}>{value}</option> : null}
        {labels.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      {canAddUnit ? (
        <button
          type="button"
          disabled={adding}
          onClick={() => void addUnit()}
          className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50"
        >
          {t("admin.templates.add_unit")}
        </button>
      ) : null}
    </Labeled>
  );
}
