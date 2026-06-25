"use client";

/**
 * CategoryListClient — list categories (label + slug + ES label) and, for MoO+
 * (≥8), an "Add category" inline form posting to POST /api/admin/categories
 * (Tier B step-up). Mirrors the units add-new pattern.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { CategoryView } from "@/lib/admin/vendors";
import { postJson, resolveErrorKey } from "./shared";

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

export function CategoryListClient({
  categories,
  actorLevel,
}: {
  categories: CategoryView[];
  actorLevel: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const canAdd = actorLevel >= 8; // MoO+

  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [labelEs, setLabelEs] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const reset = () => {
    setLabel("");
    setLabelEs("");
    setAdding(false);
    setErrorMsg(null);
  };

  const add = async () => {
    if (busy || !label.trim()) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson("/api/admin/categories", {
      label: label.trim(),
      labelEs: labelEs.trim() || null,
    });
    setBusy(false);
    if (result.ok) {
      reset();
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <div className="mt-5">
      <ul className="flex flex-col gap-2">
        {categories.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-co-border bg-co-surface p-4"
          >
            <span className="text-base font-bold text-co-text">{c.label}</span>
            <span className="flex items-center gap-3 text-[11px] text-co-text-muted">
              {c.labelEs ? <span>{c.labelEs}</span> : null}
              <span className="font-mono uppercase tracking-[0.08em]">{c.slug}</span>
            </span>
          </li>
        ))}
        {categories.length === 0 ? (
          <li className="rounded-xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
            {t("admin.categories.empty")}
          </li>
        ) : null}
      </ul>

      {canAdd ? (
        adding ? (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border-2 border-dashed border-co-border p-4">
            <label className="block">
              <span className="text-sm font-bold text-co-text">{t("admin.categories.field.label")}</span>
              <input className={fieldCls} value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm font-bold text-co-text">{t("admin.categories.field.label_es")}</span>
              <input className={fieldCls} value={labelEs} onChange={(e) => setLabelEs(e.target.value)} />
            </label>
            {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={reset}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("admin.categories.cancel")}
              </button>
              <button
                type="button"
                disabled={busy || !label.trim()}
                onClick={() => void add()}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("admin.categories.create.submit")}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
            >
              {t("admin.categories.create")}
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
