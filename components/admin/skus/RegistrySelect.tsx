"use client";

/**
 * RegistrySelect (SKU structured-purchase model) — a reusable dropdown over a
 * label-keyed registry (`RegistryOption[]`). `value`/`onChange` carry the
 * registry LABEL (the stored value), modeled on the templates UnitSelect.
 *
 * A blank "—" first option clears the value (unless `required`, in which case a
 * non-value "Select…" placeholder is shown instead). The current value stays
 * selectable even if it's a label no longer present in the active registry
 * (`valueMissing`), so we never silently clear it. When `actorLevel >= 8`
 * (MoO+) a "+ Add" button prompts for a new label, runs a Tier-B step-up,
 * POSTs to `addEndpoint`, then selects the new label + refreshes.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { RegistryOption } from "@/lib/admin/skus";
import type { TranslationKey } from "@/lib/i18n/types";
import { postJson, resolveErrorKey } from "./shared";

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

export function RegistrySelect({
  label,
  value,
  onChange,
  options,
  actorLevel,
  addEndpoint,
  addPromptKey,
  addButtonKey,
  required = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: RegistryOption[];
  actorLevel: number;
  addEndpoint: string;
  addPromptKey: TranslationKey;
  addButtonKey: TranslationKey;
  required?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const canAdd = actorLevel >= 8; // MoO+
  const [adding, setAdding] = useState(false);

  const labels = options.map((o) => o.label);
  const hasValue = value.trim() !== "";
  const valueMissing = hasValue && !labels.includes(value);

  const add = async () => {
    if (adding) return;
    const raw = window.prompt(t(addPromptKey));
    const next = raw?.trim();
    if (!next) return;
    if ((await requestStepUp("B")) !== "ok") return;
    setAdding(true);
    const result = await postJson(addEndpoint, { label: next }, "POST");
    setAdding(false);
    if (result.ok) {
      onChange(next);
      router.refresh();
    } else {
      window.alert(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <label className="block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      <select
        className={fieldCls}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {required ? (
          <option value="" disabled>
            {t("admin.skus.select_placeholder")}
          </option>
        ) : (
          <option value="">—</option>
        )}
        {valueMissing ? <option value={value}>{value}</option> : null}
        {labels.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      {canAdd ? (
        <button
          type="button"
          disabled={adding || disabled}
          onClick={() => void add()}
          className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t(addButtonKey)}
        </button>
      ) : null}
    </label>
  );
}
