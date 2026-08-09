import { redirect } from "next/navigation";
import Link from "next/link";
import { serverT } from "@/lib/i18n/server";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { requireSessionFromHeaders } from "@/lib/session";
import { loadReceivingFormData, loadRecentDeliveries } from "@/lib/receiving";
import type { DeliveryView } from "@/lib/receiving";
import { loadOpenCreditsSummary } from "@/lib/credits";
import { ReceivingForm } from "@/components/receiving/ReceivingForm";
import { OpenCreditsPanel } from "@/components/receiving/OpenCreditsPanel";
import { AlertPill } from "@/components/ui/AlertPill";
import { DashboardBackLink } from "@/components/DashboardBackLink";

const OPERATIONAL_TZ = "America/New_York";
/** Grace window before a completed, unclaimed, never-attested delivery flags "missing
 *  email": an emailed vendor receipt usually arrives same-day, so 48h of silence is a
 *  real gap for a manager to chase. */
const MISSING_EMAIL_GRACE_MS = 48 * 60 * 60 * 1000;
function nyDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: OPERATIONAL_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
/**
 * IDs of deliveries that should flag "missing email" — a completed delivery with no
 * vendor claim on file, never attested (still counted_only), older than the 48h grace
 * window. The clock is read INSIDE this helper (once per request) so no impure call
 * lands in the component render tree (react-hooks/purity). A null created_at (shouldn't
 * happen — default now()) is treated as too-new to flag.
 */
function deriveMissingEmailIds(deliveries: DeliveryView[]): Set<string> {
  const nowMs = Date.now();
  const out = new Set<string>();
  for (const d of deliveries) {
    if (
      d.deliveryStatus === "complete" &&
      d.matchState === "counted_only" &&
      !d.emailReceiptId &&
      d.createdAt != null &&
      nowMs - Date.parse(d.createdAt) > MISSING_EMAIL_GRACE_MS
    ) {
      out.add(d.id);
    }
  }
  return out;
}

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
  // Missing-email flags derived once per request (clock read inside the helper).
  const missingEmailIds = deriveMissingEmailIds(recent);

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(lang, "receiving.page.title")}</h1>
      <ReceivingForm formData={formData} locationId={location} today={nyDate()} />

      <OpenCreditsPanel summary={openCredits} />

      <h2 className="mt-6 text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{serverT(lang, "receiving.page.recent")}</h2>
      {recent.length === 0 ? (
        <p className="mt-2 text-[11px] italic text-co-text-muted">{serverT(lang, "receiving.page.none")}</p>
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
                  <span className="font-semibold text-co-text">{d.vendorName}</span>
                  <span className="text-xs text-co-text-muted">{d.deliveryDate}</span>
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
    </main>
  );
}
