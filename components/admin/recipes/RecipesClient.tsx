"use client";

/**
 * RecipesClient — hub list for /admin/recipes. Client-side type filter
 * (Production | Consumer | All), row links to /admin/recipes/{id},
 * and a "New recipe" link to /admin/recipes/new (GM+ only).
 */

import { useState } from "react";
import Link from "next/link";

import { useTranslation } from "@/lib/i18n/provider";
import type { RecipeListRow, RecipeType } from "@/lib/recipes";
import { RECIPE_WRITE_MIN } from "@/lib/recipes";
import type { TranslationKey } from "@/lib/i18n/types";

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
  const canWrite = level >= RECIPE_WRITE_MIN;

  const [filter, setFilter] = useState<FilterType>("all");

  const filtered =
    filter === "all" ? recipes : recipes.filter((r) => r.recipeType === filter);

  const chipCls = (active: boolean) =>
    `inline-flex min-h-[36px] items-center rounded-lg border-2 px-3 text-sm font-bold transition ${
      active
        ? "border-co-gold-deep bg-co-gold text-co-text"
        : "border-co-border bg-co-surface text-co-text hover:border-co-text"
    }`;

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

      {/* New recipe — link to dedicated page */}
      {canWrite ? (
        <div className="mt-6">
          <Link
            href="/admin/recipes/new"
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text hover:border-co-text transition"
          >
            {t(rk("recipes.create.open_button"))}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
