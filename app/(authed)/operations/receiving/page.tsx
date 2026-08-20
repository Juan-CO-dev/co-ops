import { redirect } from "next/navigation";
import Link from "next/link";
import { serverT } from "@/lib/i18n/server";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { etCalendarDate } from "@/lib/operational-day";
import { requireSessionFromHeaders } from "@/lib/session";
import { loadReceivingFormData, loadRecentDeliveries } from "@/lib/receiving";
import { deriveMissingEmailIds } from "@/lib/dashboard-status-shared";
import { loadOpenCreditsSummary } from "@/lib/credits";
import { ReceivingForm } from "@/components/receiving/ReceivingForm";
import { OpenCreditsPanel } from "@/components/receiving/OpenCreditsPanel";
import { AlertPill } from "@/components/ui/AlertPill";
import { DashboardBackLink } from "@/components/DashboardBackLink";
import { EmptyState } from "@/components/EmptyState";

export default async function ReceivingPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const auth = await requireSessionFromHeaders("/operations/receiving");
  const { location } = await searchParams;
  if (auth.level < 4) redirect("/dashboard");
  if (!location) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, location)) redirect("/dashboard");

  const lang = auth.user.language;
  const [formData, recent, openCredits] = await Promise.all([
    loadReceivingFormData(auth, location),
    loadRecentDeliveries(auth, location, 20),
    loadOpenCreditsSummary(auth, location),
  ]);
  // Missing-email flags derived once per request — the ONE rule, shared with the
  // dashboard's receiving tile (lib/dashboard-status-shared.ts). The clock is read
  // here so no impure call lands in the render tree (react-hooks/purity).
  const missingEmailIds = deriveMissingEmailIds(recent, Date.now());

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      {/* Back + the sibling hop to ordering (the other end of the draft → PO → truck
          thread). The active location travels so the destination resolves the same shop. */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <DashboardBackLink />
        <Link
          href={`/ordering?location=${encodeURIComponent(location)}`}
          className="-mr-2 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 py-2 text-xs font-bold uppercase tracking-[0.14em] text-co-text-muted transition hover:text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
        >
          <span>{serverT(lang, "nav.ordering")}</span>
          <span aria-hidden>›</span>
        </Link>
      </div>
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(lang, "receiving.page.title")}</h1>
      {/* Recomposition PR 3: phone keeps the stack (form → credits → history);
          lg+ puts the intake form beside the credits + history rail so the door
          ceremony and what-came-before are visible together. Source order
          unchanged — the rail cell wraps the two reference blocks. */}
      <div className="lg:grid lg:grid-cols-[3fr_2fr] lg:items-start lg:gap-8">
      <ReceivingForm formData={formData} locationId={location} today={etCalendarDate(new Date().toISOString())} />

      {/* [&>*:first-child]:lg:mt-0 — the rail's first block (credits panel) carries
          its own stack margin (mt-6) for the phone flow; at lg the rail top must
          align with the form. */}
      <div className="lg:min-w-0 [&>*:first-child]:lg:mt-0">
      <OpenCreditsPanel summary={openCredits} />

      <h2 className="mt-6 text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{serverT(lang, "receiving.page.recent")}</h2>
      {recent.length === 0 ? (
        <EmptyState message={serverT(lang, "receiving.page.none")} />
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {recent.map((d) => {
            // Derived "missing email" state (D2 alert) — computed once above so the
            // render tree stays pure (no clock read here).
            const missingEmail = missingEmailIds.has(d.id);
            return (
            <li key={d.id}>
              <Link href={`/operations/receiving/${d.id}`} className="block rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm transition hover:border-co-text">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block font-semibold text-co-text">{d.vendorName}</span>
                    {/* The id thread: the PO this drop was received against. Absent on a
                        walk-in delivery with no order behind it. */}
                    {d.purchaseOrderCode ? (
                      <span className="block font-mono text-[11px] tracking-wide text-co-text-dim">
                        {d.purchaseOrderCode}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-co-text-muted">{d.deliveryDate}</span>
                </div>
                {/* Alert badges (D2 — always visible, never collapsed): in-progress
                    door, two-way-match state (discrepant/matched/override), missing
                    receipt photo, missing emailed claim. */}
                {d.deliveryStatus === "in_progress" || d.matchState !== "counted_only" || d.receiptUrl === null || missingEmail ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {d.deliveryStatus === "in_progress" ? (
                      <AlertPill tone="info">{serverT(lang, "receiving.badge.in_progress")}</AlertPill>
                    ) : null}
                    {d.matchState === "discrepant" ? (
                      <AlertPill tone="warn">{serverT(lang, "receiving.badge.discrepant")}</AlertPill>
                    ) : null}
                    {d.matchState === "matched" ? (
                      <AlertPill tone="ok">{serverT(lang, "receiving.badge.matched")}</AlertPill>
                    ) : null}
                    {d.matchState === "override" ? (
                      <AlertPill tone="info">{serverT(lang, "receiving.badge.override")}</AlertPill>
                    ) : null}
                    {d.receiptUrl === null ? (
                      <AlertPill tone="warn">{serverT(lang, "receiving.badge.photo_missing")}</AlertPill>
                    ) : null}
                    {missingEmail ? (
                      <AlertPill tone="warn">{serverT(lang, "receiving.badge.email_missing")}</AlertPill>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-1 text-[11px] text-co-text-dim">
                  {serverT(lang, "receiving.page.line_count", { n: d.lineCount })}
                  {d.invoiceNumber ? ` · #${d.invoiceNumber}` : ""}
                  {d.receivedByName ? ` · ${d.receivedByName}` : ""}
                </div>
              </Link>
            </li>
          );
          })}
        </ul>
      )}
      </div>
      </div>
    </main>
  );
}
