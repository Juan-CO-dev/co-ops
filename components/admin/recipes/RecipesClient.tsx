"use client";

/**
 * RecipesClient — hub list for /admin/recipes. Client-side type filter
 * (Production | Consumer | All), row links to /admin/recipes/{id},
 * and a "New recipe" link to /admin/recipes/new (GM+ only).
 */

import { useState } from "react";
import Link from "next/link";

import { useTranslation } from "@/lib/i18n/provider";
import type { RecipeListRow, RecipeType } from "@/lib/recipes-shared";
import { RECIPE_WRITE_MIN } from "@/lib/recipes-shared";
import type { Readiness } from "@/lib/readiness";
import { StatusBadge, ReadinessReasons } from "@/components/admin/StatusBadge";
import type { TranslationKey } from "@/lib/i18n/types";

/**
 * Cast a recipes.* key — translated by the separate i18n task.
 *
 * TODO(i18n-type-safety, builder council finding 12): `as TranslationKey` here
 * bypasses compile-time key checking — a typo'd or orphaned key won't fail the
 * build (TranslationKey = keyof typeof en.json, so a real registered key would be
 * enforced). Prefer passing already-registered literal keys directly (no rk())
 * so the compiler catches drift and orphan detection works. Any keys added going
 * forward should be registered in en/es and referenced without this cast.
 */
const rk = (k: string): TranslationKey => k as TranslationKey;

type FilterType = RecipeType | "all";

export function RecipesClient({
  recipes,
  level,
  readiness,
}: {
  recipes: RecipeListRow[];
  level: number;
  readiness: Record<string, Readiness>;
}) {
  const { t } = useTranslation();
  const canWrite = level >= RECIPE_WRITE_MIN;

  const [filter, setFilter] = useState<FilterType>("all");

  const filtered =
    filter === "all" ? recipes : recipes.filter((r) => r.recipeType === filter);

  const chipCls = (active: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-lg border-2 px-3 text-sm font-bold transition ${
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
      <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-co-text-muted">{t(rk("recipes.hub.empty"))}</p>
        ) : (
          filtered.map((r) => {
            const rd = readiness[r.id];
            return (
              <Link
                key={r.id}
                href={`/admin/recipes/${r.id}`}
                className="co-card co-card-interactive flex items-center justify-between px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-co-text">{r.name}</span>
                    <span className="rounded bg-co-gold/30 px-2 py-0.5 text-xs font-bold uppercase tracking-[0.08em] text-co-text">
                      {r.recipeType === "production"
                        ? t(rk("recipes.type.production"))
                        : t(rk("recipes.type.consumer"))}
                    </span>
                    {rd ? (
                      <StatusBadge status={rd.status as "incomplete" | "upstream_gaps"} />
                    ) : null}
                  </div>
                  {r.outputNames.length > 0 ? (
                    <p className="mt-0.5 truncate text-xs text-co-text-muted">
                      {t(rk("recipes.hub.outputs_label"))} {r.outputNames.join(", ")}
                    </p>
                  ) : null}
                  {rd ? <ReadinessReasons reasons={rd.reasons} /> : null}
                </div>
                <span className="ml-3 text-co-text-muted" aria-hidden>›</span>
              </Link>
            );
          })
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
