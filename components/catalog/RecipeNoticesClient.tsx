"use client";

/**
 * A GM's RECIPE UPDATES (catalog Phase 3b; spec §6) — the read-time notices for one shop. Each names the recipe and
 * opens THIS shop's view of it (where "Take the update" / "Go back to the default" preview the act); "Keep mine" /
 * "Got it" records the answer for the version seen, in the state seen (no password: it changes no food — the
 * route takes the session, the GM floor, the shop bind and a same-origin check).
 *
 * LEAD DECISIONS this body carries:
 *  - Editing an adopted recipe keeps its link and the notices continue, with "You've changed your copy since
 *    adopting it." added.
 *  - Every notice deep-links to the shop's view (?location=<shop>), never the default's.
 *  - A refused answer is named (the recipe page's refusal map), never generic text.
 *  - Phone-first: rows and button rows wrap, long names break, every control is 44px. Dates are the ET day.
 */
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { formatDateLabel } from "@/lib/i18n/format";
import { etDisplayDate } from "@/lib/operational-day";
import { postJson } from "@/components/admin/vendors/shared";
import type { RecipeNotice } from "@/lib/catalog/recipe-notices-shared";
import { recipeErrorKey, recipeItemHref } from "@/lib/catalog/recipe-item-shared";

const btn =
  "inline-flex min-h-[44px] max-w-full items-center justify-center break-words rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text disabled:opacity-50";
const linkBtn =
  "inline-flex min-h-[44px] max-w-full items-center justify-center break-words rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text";

export function RecipeNoticesClient({ shopId, notices }: { shopId: string; notices: RecipeNotice[] }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const answer = async (n: RecipeNotice) => {
    setBusy(true); setMessage(null);
    // The STATE seen is part of the answer: a retired source is a different notice from an updated one (Astra 3b r1#5).
    const kind = n.kind === "source_changed" ? n.dismissKind : n.kind;
    const r = await postJson(`/api/admin/catalog/recipe/${n.recipeId}/notices/dismiss`, { locationId: shopId, kind, seenVersionId: n.seenVersionId });
    setBusy(false);
    if (r.ok) router.refresh(); else setMessage(t(recipeErrorKey(r.code)));
  };

  if (notices.length === 0) return <p className="text-sm text-co-text-muted">{t("catalog.notices.none")}</p>;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {message ? <p role="status" className="break-words rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text">{message}</p> : null}
      <ul className="flex min-w-0 flex-col gap-2">
        {notices.map((n) => (
          <li key={`${n.kind}-${n.recipeId}-${n.seenVersionId}`} className="flex min-w-0 flex-col gap-2 break-words rounded-xl border-2 border-co-warning bg-co-warning-surface p-3">
            <p className="text-sm text-co-text">
              {n.kind === "new_default"
                ? t("catalog.recipe.notice.new_default", { recipe: n.recipeName, shop: n.fromShopName ?? "" })
                : n.sourceLiveVersionId
                  ? t("catalog.recipe.notice.source_changed", { shop: n.sourceShopName, recipe: n.recipeName })
                  : n.promotedToDefault
                    ? t("catalog.recipe.notice.source_promoted", { shop: n.sourceShopName, recipe: n.recipeName })
                    : t("catalog.recipe.notice.source_gone", { shop: n.sourceShopName, recipe: n.recipeName })}
            </p>
            {/* Lead decision: editing an adopted copy keeps the link, and the notice says so. */}
            {n.kind === "source_changed" && n.editedSinceAdopting ? <p className="text-sm text-co-text-muted">{t("catalog.recipe.notice.edited_since")}</p> : null}
            <p className="text-xs text-co-text-muted">{formatDateLabel(etDisplayDate(n.at), language)}</p>
            <div className="flex flex-wrap gap-2">
              <Link href={recipeItemHref(n.recipeId, { shopId })} className={linkBtn}>{t("catalog.recipe.notice.open")}</Link>
              <button type="button" className={btn} disabled={busy} onClick={() => void answer(n)}>
                {n.kind === "new_default" ? t("catalog.recipe.notice.got_it") : t("catalog.recipe.notice.keep_mine")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
