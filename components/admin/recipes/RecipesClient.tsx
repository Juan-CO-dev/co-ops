"use client";

/**
 * RecipesClient — hub list for /admin/recipes. Client-side type filter
 * (Production | Consumer | All), row links to /admin/recipes/{id},
 * and a "New recipe" inline form. GM+ (>= 7) can create; AGM+ (>= 6) sees
 * the list read-only.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { RecipeListRow, RecipeType } from "@/lib/recipes";
import { RECIPE_WRITE_MIN } from "@/lib/recipes";
import type { TranslationKey } from "@/lib/i18n/types";
import { postJson, resolveErrorKey } from "./shared";

/** Cast a recipes.* key — translated by the separate i18n task. */
const rk = (k: string): TranslationKey => k as TranslationKey;

type FilterType = RecipeType | "all";

export function RecipesClient({
  recipes,
  level,
}: {
  recipes: RecipeListRow[];
  level: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const canWrite = level >= RECIPE_WRITE_MIN;

  const [filter, setFilter] = useState<FilterType>("all");
  const [creatingName, setCreatingName] = useState("");
  const [creatingType, setCreatingType] = useState<RecipeType>("production");
  const [creatingYield, setCreatingYield] = useState("1");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filtered =
    filter === "all" ? recipes : recipes.filter((r) => r.recipeType === filter);

  const resetCreate = () => {
    setCreatingName("");
    setCreatingType("production");
    setCreatingYield("1");
    setErrorMsg(null);
  };

  const create = async () => {
    if (busy) return;
    setErrorMsg(null);
    const name = creatingName.trim();
    const yieldNum = Number(creatingYield);
    if (!name) { setErrorMsg(t(rk("recipes.error.invalid_name"))); return; }
    if (!Number.isFinite(yieldNum) || yieldNum <= 0) { setErrorMsg(t(rk("recipes.error.invalid_batch_yield"))); return; }
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson("/api/admin/recipes", {
      name,
      recipeType: creatingType,
      batchYield: yieldNum,
    });
    setBusy(false);
    if (result.ok) {
      const id = result.data["id"] as string | undefined;
      resetCreate();
      setShowCreate(false);
      if (id) {
        router.push(`/admin/recipes/${id}`);
      } else {
        router.refresh();
      }
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  const chipCls = (active: boolean) =>
    `inline-flex min-h-[36px] items-center rounded-lg border-2 px-3 text-sm font-bold transition ${
      active
        ? "border-co-gold-deep bg-co-gold text-co-text"
        : "border-co-border bg-co-surface text-co-text hover:border-co-text"
    }`;

  const fieldCls =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="mt-4">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={chipCls(filter === "all")} onClick={() => setFilter("all")}>
          {t(rk("recipes.filter.all"))}
        </button>
        <button type="button" className={chipCls(filter === "production")} onClick={() => setFilter("production")}>
          {t(rk("recipes.filter.production"))}
        </button>
        <button type="button" className={chipCls(filter === "consumer")} onClick={() => setFilter("consumer")}>
          {t(rk("recipes.filter.consumer"))}
        </button>
      </div>

      {/* Recipe list */}
      <div className="mt-4 flex flex-col gap-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-co-text-muted">{t(rk("recipes.hub.empty"))}</p>
        ) : (
          filtered.map((r) => (
            <Link
              key={r.id}
              href={`/admin/recipes/${r.id}`}
              className="flex items-center justify-between rounded-lg border-2 border-co-border bg-co-surface px-4 py-3 hover:border-co-text transition"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-co-text">{r.name}</span>
                  <span className="rounded bg-co-gold/30 px-2 py-0.5 text-xs font-bold uppercase tracking-[0.08em] text-co-text">
                    {r.recipeType === "production"
                      ? t(rk("recipes.type.production"))
                      : t(rk("recipes.type.consumer"))}
                  </span>
                  {(!r.hasInputs || !r.hasOutputs) ? (
                    <span className="rounded bg-co-cta/15 px-2 py-0.5 text-xs font-bold text-co-cta">
                      {t(rk("recipes.badge.incomplete"))}
                    </span>
                  ) : null}
                </div>
                {r.outputNames.length > 0 ? (
                  <p className="mt-0.5 truncate text-xs text-co-text-muted">
                    {t(rk("recipes.hub.outputs_label"))} {r.outputNames.join(", ")}
                  </p>
                ) : null}
              </div>
              <span className="ml-3 text-co-text-muted" aria-hidden>›</span>
            </Link>
          ))
        )}
      </div>

      {/* New recipe */}
      {canWrite ? (
        <div className="mt-6">
          {showCreate ? (
            <div className="rounded-lg border-2 border-co-gold-deep bg-co-surface p-4">
              <h2 className="text-sm font-extrabold text-co-text">{t(rk("recipes.create.title"))}</h2>
              <div className="mt-3 flex flex-col gap-3">
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.create.name_label"))}</span>
                  <input
                    className={fieldCls}
                    type="text"
                    value={creatingName}
                    disabled={busy}
                    onChange={(e) => setCreatingName(e.target.value)}
                    placeholder={t(rk("recipes.create.name_placeholder"))}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.create.type_label"))}</span>
                  <select
                    className={fieldCls}
                    value={creatingType}
                    disabled={busy}
                    onChange={(e) => setCreatingType(e.target.value as RecipeType)}
                  >
                    <option value="production">{t(rk("recipes.type.production"))}</option>
                    <option value="consumer">{t(rk("recipes.type.consumer"))}</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t(rk("recipes.create.batch_yield_label"))}</span>
                  <input
                    className={fieldCls}
                    type="number"
                    min={0.001}
                    step="any"
                    inputMode="decimal"
                    value={creatingYield}
                    disabled={busy}
                    onChange={(e) => setCreatingYield(e.target.value)}
                  />
                </label>
                {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { resetCreate(); setShowCreate(false); }}
                    className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50"
                  >
                    {t(rk("recipes.create.cancel"))}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !creatingName.trim()}
                    onClick={() => void create()}
                    className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
                  >
                    {t(rk("recipes.create.submit"))}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text hover:border-co-text transition"
            >
              {t(rk("recipes.create.open_button"))}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
