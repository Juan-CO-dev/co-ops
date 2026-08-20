"use client";

/**
 * RecipeCateringFlags (Items Master Catalog, piece 2) — a compact card rendered
 * BELOW the recipe builder on /admin/recipes/[id], listing every MENU_ITEM this
 * recipe produces with its catering flags set AT BIRTH: Available / Catering-only
 * / Portions / Serves / Seasonal. Writes ride the EXISTING catering-menu PATCH
 * (/api/admin/catering/menu/[id], kind=menu_item, Tier-A step-up via the ambient
 * StepUpProvider) — no second trip to the catering-menu manager.
 *
 * Rendered as a sibling card (not threaded through the monolithic RecipeBuilder)
 * per the least-invasive-diff choice: current values load server-side and flow
 * in as `outputs`; each control PATCHes one flag and refreshes.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { postJson } from "@/components/admin/recipes/shared";

const tk = (k: string): TranslationKey => k as TranslationKey;

export interface RecipeMenuOutputFlags {
  menuItemId: string;
  name: string;
  cateringAvailable: boolean;
  cateringOnly: boolean;
  cateringPortionable: boolean;
  serves: number | null;
  seasonal: boolean;
}

export function RecipeCateringFlags({
  outputs,
  canEdit,
}: {
  outputs: RecipeMenuOutputFlags[];
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  if (outputs.length === 0) {
    return (
      <div className="mx-auto mt-4 w-full max-w-3xl rounded-lg border-2 border-co-border bg-co-surface p-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-co-text-muted">
          {t("recipes.catering_flags.title")}
        </h2>
        <p className="mt-2 text-xs text-co-text-muted">{t("recipes.catering_flags.empty")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-4 w-full max-w-3xl rounded-lg border-2 border-co-border bg-co-surface p-4">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-co-text-muted">
        {t("recipes.catering_flags.title")}
      </h2>
      <p className="mt-1 text-xs text-co-text-muted">{t("recipes.catering_flags.subtitle")}</p>
      <div className="mt-3 flex flex-col gap-3">
        {outputs.map((o) => (
          <FlagRow key={o.menuItemId} output={o} canEdit={canEdit} />
        ))}
      </div>
    </div>
  );
}

function FlagRow({ output, canEdit }: { output: RecipeMenuOutputFlags; canEdit: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [servesVal, setServesVal] = useState(output.serves == null ? "" : String(output.serves));

  const patch = async (body: Record<string, unknown>) => {
    if (!canEdit || busy) return;
    setErrorKey(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(
      `/api/admin/catering/menu/${output.menuItemId}`,
      { kind: "menu_item", ...body },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else if (result.code === "step_up_required" || result.code === "step_up_stale") {
      // Advisory flag was stale — prompt then retry once.
      if ((await requestStepUp("A")) !== "ok") return;
      setBusy(true);
      const retry = await postJson(
        `/api/admin/catering/menu/${output.menuItemId}`,
        { kind: "menu_item", ...body },
        "PATCH",
      );
      setBusy(false);
      if (retry.ok) router.refresh();
      else setErrorKey("recipes.catering_flags.error");
    } else {
      setErrorKey("recipes.catering_flags.error");
    }
  };

  const commitServes = () => {
    const trimmed = servesVal.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next <= 0)) return;
    if (next === output.serves) return;
    void patch({ serves: next });
  };

  const toggleCls = (on: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-full border-2 px-3 text-xs font-bold transition disabled:opacity-50 ${
      on ? "border-co-gold-deep bg-co-surface-2 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
    }`;

  return (
    <div className="rounded-lg border-2 border-co-border/70 bg-co-surface p-3">
      <p className="text-sm font-bold text-co-text">{output.name}</p>
      {errorKey && <p className="mt-1 text-xs text-co-cta-text">{t(errorKey)}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canEdit || busy}
          aria-pressed={output.cateringAvailable}
          className={toggleCls(output.cateringAvailable)}
          onClick={() => void patch({ cateringAvailable: !output.cateringAvailable })}
        >
          {t("recipes.catering_flags.available")}
        </button>
        <button
          type="button"
          disabled={!canEdit || busy}
          aria-pressed={output.cateringOnly}
          className={toggleCls(output.cateringOnly)}
          onClick={() => void patch({ cateringOnly: !output.cateringOnly })}
        >
          {t("recipes.catering_flags.catering_only")}
        </button>
        <button
          type="button"
          disabled={!canEdit || busy}
          aria-pressed={output.cateringPortionable}
          className={toggleCls(output.cateringPortionable)}
          onClick={() => void patch({ cateringPortionable: !output.cateringPortionable })}
        >
          {t("recipes.catering_flags.portions")}
        </button>
        <button
          type="button"
          disabled={!canEdit || busy}
          aria-pressed={output.seasonal}
          className={toggleCls(output.seasonal)}
          onClick={() => void patch({ seasonal: !output.seasonal })}
        >
          {t("recipes.catering_flags.seasonal")}
        </button>
        <label className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-co-text-dim">{t("recipes.catering_flags.serves")}</span>
          <input
            type="number"
            min={1}
            step="any"
            inputMode="decimal"
            disabled={!canEdit || busy}
            value={servesVal}
            onChange={(e) => setServesVal(e.target.value)}
            onBlur={commitServes}
            placeholder={t("recipes.catering_flags.serves_placeholder")}
            aria-label={`${output.name} — ${t("recipes.catering_flags.serves")}`}
            className="min-h-[44px] w-20 rounded-lg border-2 border-co-border-2 bg-co-surface px-2 text-sm text-co-text disabled:opacity-50"
          />
        </label>
        {busy && <span className="text-xs text-co-text-muted">{t("recipes.catering_flags.working")}</span>}
      </div>
    </div>
  );
}
