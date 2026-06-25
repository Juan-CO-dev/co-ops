"use client";

/**
 * OrderTypeListClient — list order types (label + slug + ES label) and, for MoO+
 * (≥8), an "Add order type" inline form posting to POST /api/admin/order-types
 * (Tier B step-up). Mirrors CategoryListClient exactly; the only differences are
 * the endpoint, the i18n namespace (admin.order_types.*), and the error resolver.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { OrderTypeView } from "@/lib/admin/vendors";
import type { TranslationKey } from "@/lib/i18n/types";
import { postJson } from "./shared";

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

/** Order-type-scoped error resolver (mirrors shared.resolveErrorKey shape). */
function resolveOrderTypeErrorKey(code: string): TranslationKey {
  const known = new Set([
    "forbidden",
    "order_type_exists",
    "invalid_label",
    "step_up_required",
    "step_up_stale",
  ]);
  if (known.has(code)) return `admin.order_types.error.${code}` as TranslationKey;
  return "admin.order_types.error.generic";
}

export function OrderTypeListClient({
  orderTypes,
  actorLevel,
}: {
  orderTypes: OrderTypeView[];
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
    const result = await postJson("/api/admin/order-types", {
      label: label.trim(),
      labelEs: labelEs.trim() || null,
    });
    setBusy(false);
    if (result.ok) {
      reset();
      router.refresh();
    } else {
      setErrorMsg(t(resolveOrderTypeErrorKey(result.code)));
    }
  };

  return (
    <div className="mt-5">
      <ul className="flex flex-col gap-2">
        {orderTypes.map((o) => (
          <li
            key={o.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-co-border bg-co-surface p-4"
          >
            <span className="text-base font-bold text-co-text">{o.label}</span>
            <span className="flex items-center gap-3 text-[11px] text-co-text-muted">
              {o.labelEs ? <span>{o.labelEs}</span> : null}
              <span className="font-mono uppercase tracking-[0.08em]">{o.slug}</span>
            </span>
          </li>
        ))}
        {orderTypes.length === 0 ? (
          <li className="rounded-xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
            {t("admin.order_types.empty")}
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
                {t("admin.order_types.create.submit")}
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
              {t("admin.order_types.create")}
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
