import { redirect } from "next/navigation";
import Link from "next/link";
import { serverT } from "@/lib/i18n/server";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { requireSessionFromHeaders } from "@/lib/session";
import { loadReceivingFormData, loadRecentDeliveries } from "@/lib/receiving";
import { ReceivingForm } from "@/components/receiving/ReceivingForm";
import { DashboardBackLink } from "@/components/DashboardBackLink";

const OPERATIONAL_TZ = "America/New_York";
function nyDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: OPERATIONAL_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function ReceivingPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const auth = await requireSessionFromHeaders("/operations/receiving");
  const { location } = await searchParams;
  if (auth.level < 4) redirect("/dashboard");
  if (!location) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, location)) redirect("/dashboard");

  const lang = auth.user.language;
  const [formData, recent] = await Promise.all([
    loadReceivingFormData(auth, location),
    loadRecentDeliveries(auth, location, 20),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(lang, "receiving.page.title")}</h1>
      <ReceivingForm formData={formData} locationId={location} today={nyDate()} />

      <h2 className="mt-6 text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{serverT(lang, "receiving.page.recent")}</h2>
      {recent.length === 0 ? (
        <p className="mt-2 text-[11px] italic text-co-text-muted">{serverT(lang, "receiving.page.none")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {recent.map((d) => (
            <li key={d.id}>
              <Link href={`/operations/receiving/${d.id}`} className="block rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm transition hover:border-co-text">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-co-text">{d.vendorName}</span>
                  <span className="text-xs text-co-text-muted">{d.deliveryDate}</span>
                </div>
                <div className="text-[11px] text-co-text-dim">
                  {serverT(lang, "receiving.page.line_count", { n: d.lineCount })}
                  {d.invoiceNumber ? ` · #${d.invoiceNumber}` : ""}
                  {d.receivedByName ? ` · ${d.receivedByName}` : ""}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
