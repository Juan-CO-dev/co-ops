/**
 * /catering/insights — the catering read surface (Wave 1 slice 1F, feedback + trends).
 *
 * Server component. Pipeline funnel + quote/revenue rollups + customer feedback, all read
 * over the capture artifacts the other slices produce. Money rollups are SQL SUM (the
 * catering_insights RPC), never a client reduce. Everything reads $0 / empty until catering
 * data is authored — the surface is here for when it arrives.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { formatCents, formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import { loadCateringInsights, INSIGHTS_READ_MIN } from "@/lib/catering/insights";
import { PIPELINE_STAGES } from "@/lib/catering/pipeline-shared";
import { BackLink } from "@/components/nav/BackLink";

const QUOTE_STATUSES = ["draft", "sent", "accepted", "declined", "expired"] as const;

export default async function CateringInsightsPage() {
  const auth = await requireSessionFromHeaders("/catering/insights");
  if (getRoleLevel(auth.user.role) < INSIGHTS_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const insights = await loadCateringInsights(auth);
  const money = (c: number) => formatCents(c, lang);

  const pipelineCounts = PIPELINE_STAGES.map((s) => ({
    key: s,
    label: serverT(lang, `catering.pipeline.stage.${s}` as TranslationKey),
    count: insights.pipeline.find((p) => p.stage === s)?.count ?? 0,
  }));
  const quoteCounts = QUOTE_STATUSES.map((s) => {
    const row = insights.quotes.find((q) => q.status === s);
    return {
      key: s,
      label: serverT(lang, `catering.quotes.status.${s}` as TranslationKey),
      count: row?.count ?? 0,
      totalCents: row?.totalCents ?? 0,
    };
  });
  const pipelineMax = Math.max(...pipelineCounts.map((p) => p.count), 1);
  const quoteMax = Math.max(...quoteCounts.map((q) => q.count), 1);
  const hasActivity =
    pipelineCounts.some((p) => p.count > 0) ||
    quoteCounts.some((q) => q.count > 0) ||
    insights.feedbackCount > 0;

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <BackLink />
      <h1 className="text-lg font-bold text-co-text">{serverT(lang, "catering.insights.title")}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "catering.insights.subtitle")}</p>

      {/* Revenue cards */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <RevenueCard label={serverT(lang, "catering.insights.revenue.open")} value={money(insights.revenue.pipelineValueCents)} />
        <RevenueCard label={serverT(lang, "catering.insights.revenue.won")} value={money(insights.revenue.wonValueCents)} accent />
        <RevenueCard label={serverT(lang, "catering.insights.revenue.orders")} value={money(insights.revenue.orderRevenueCents)} />
      </div>

      {!hasActivity && (
        <p className="co-card mt-4 p-6 text-sm text-co-text-muted">{serverT(lang, "catering.insights.empty")}</p>
      )}

      {/* Funnels */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="co-card p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">
            {serverT(lang, "catering.insights.pipeline_funnel")}
          </h2>
          <div className="flex flex-col gap-2.5">
            {pipelineCounts.map((p) => (
              <FunnelBar key={p.key} label={p.label} count={p.count} max={pipelineMax} />
            ))}
          </div>
        </section>

        <section className="co-card p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">
            {serverT(lang, "catering.insights.quote_funnel")}
          </h2>
          <div className="flex flex-col gap-2.5">
            {quoteCounts.map((q) => (
              <FunnelBar key={q.key} label={q.label} count={q.count} max={quoteMax} note={q.count > 0 ? money(q.totalCents) : undefined} />
            ))}
          </div>
        </section>
      </div>

      {/* Feedback */}
      <section className="co-card mt-4 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{serverT(lang, "catering.insights.feedback")}</h2>
          <span className="text-sm text-co-text-muted">
            {insights.averageRating != null ? (
              <>
                <span className="text-lg font-extrabold text-co-text">{insights.averageRating.toFixed(1)}</span>
                <span className="text-co-text-dim"> / 5 · {insights.feedbackCount} {serverT(lang, "catering.insights.feedback_count")}</span>
              </>
            ) : (
              serverT(lang, "catering.insights.no_feedback")
            )}
          </span>
        </div>
        {insights.recentFeedback.length > 0 && (
          <ul className="flex flex-col gap-2">
            {insights.recentFeedback.map((f) => (
              <li key={f.id} className="rounded-lg border-2 border-co-border-2 bg-co-surface p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-co-text">
                    {f.rating != null ? `${f.rating}/5` : "—"}
                    {f.category ? <span className="ml-2 text-xs font-normal text-co-text-dim">{f.category}</span> : null}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-co-text-dim">
                    {f.followUpNeeded && (
                      <span className="rounded-full border border-co-cta/40 bg-co-cta/10 px-2 py-0.5 font-bold text-co-cta-text">
                        {serverT(lang, "catering.insights.follow_up")}
                      </span>
                    )}
                    {f.submittedAt ? formatDateLabel(f.submittedAt.slice(0, 10), lang) : ""}
                  </span>
                </div>
                {f.comment && <p className="mt-1 text-sm text-co-text-muted">{f.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function RevenueCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`co-card p-4 ${accent ? "ring-2 ring-co-gold/40" : ""}`}>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-co-text">{value}</p>
    </div>
  );
}

function FunnelBar({ label, count, max, note }: { label: string; count: number; max: number; note?: string }) {
  const pct = Math.round((count / max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-co-text">{label}</span>
        <span className="tabular-nums text-co-text-muted">
          {note ? <span className="mr-2 text-xs text-co-text-dim">{note}</span> : null}
          <span className="font-bold text-co-text">{count}</span>
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-co-border/40">
        <div className="h-full rounded-full bg-co-gold" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
