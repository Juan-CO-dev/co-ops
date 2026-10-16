"use client";
/**
 * The budget suggestion (spec §5.2, plan Task 20): CO-OPS's hours for the week with its reasons (the sales ratio against
 * the reference week, catering and settings deltas, days clamped at their minimum crew) and Accept / Keep. Accept posts
 * the digest the person SAW (`accept_budget`; the server recomputes and refuses `preview_stale` on any difference);
 * Keep records the digest so the same suggestion stays quiet. A quiet suggestion renders nothing; an unavailable one
 * names its errand. Only for a viewer with the budget act. 44 px buttons; no step-up (audited).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import type { TranslationKey } from "@/lib/i18n/types";
import type { BudgetSuggestion as Suggestion } from "@/lib/scheduling/budget-shared";
import { scheduleErrorKey } from "./schedule-errors";
import { useBoardLine } from "./use-board-line";

export function BudgetSuggestion({ suggestion, locationId, weekStart, names, positions }: {
  suggestion: Suggestion;
  locationId: string;
  weekStart: string;
  names: Record<string, string>;
  positions: Record<string, { name: string; nameEs: string | null }>;
}) {
  const { t, line } = useBoardLine({ names, positions });
  const router = useRouter();
  const post = useStepUpPost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  if (suggestion.kind === "quiet") return null;
  if (suggestion.kind === "unavailable") {
    return <p className="co-card p-3 text-sm text-co-text-muted" data-section="suggestion">{line(suggestion.errand)}</p>;
  }
  const s = suggestion;
  async function act(action: "accept_budget" | "keep_budget") {
    setBusy(true); setError(null);
    const r = await post("/api/schedule", { action, locationId, weekStart, digest: s.digest });
    setBusy(false);
    if (!r.ok) { setError(scheduleErrorKey(r.code)); return; }
    router.refresh();
  }
  return (
    <section className="co-card grid gap-2 p-4" data-section="suggestion" aria-labelledby="schedule-suggest-title">
      <h2 id="schedule-suggest-title" className="text-base font-bold text-co-text">{t("schedule.board.suggest.title", { hours: s.total })}</h2>
      <ul className="grid gap-1 text-sm text-co-text-muted">
        {s.lines.map((l, i) => <li key={i}>{line(l)}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-suggest="accept" disabled={busy} onClick={() => act("accept_budget")}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text disabled:opacity-60">
          {t("schedule.board.suggest.accept", { hours: s.total })}
        </button>
        <button type="button" data-suggest="keep" disabled={busy} onClick={() => act("keep_budget")}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg border-2 border-co-border-2 bg-co-surface px-4 font-bold text-co-text disabled:opacity-60">
          {t("schedule.board.suggest.keep")}
        </button>
      </div>
      {error ? <p role="alert" className="text-sm font-bold text-co-cta-text">{t(error)}</p> : null}
    </section>
  );
}
