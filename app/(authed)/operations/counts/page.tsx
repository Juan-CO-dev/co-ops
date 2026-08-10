import { redirect } from "next/navigation";
import { serverT } from "@/lib/i18n/server";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { requireSessionFromHeaders } from "@/lib/session";
import { loadCountFormData, loadOnHand, COUNT_READ_MIN } from "@/lib/counts";
import { CountForm } from "@/components/counts/CountForm";
import { OnHandPanel } from "@/components/counts/OnHandPanel";
import { DashboardBackLink } from "@/components/DashboardBackLink";

export default async function CountsPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const auth = await requireSessionFromHeaders("/operations/counts");
  const { location } = await searchParams;
  if (auth.level < COUNT_READ_MIN) redirect("/dashboard");
  if (!location) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, location)) redirect("/dashboard");

  const lang = auth.user.language;
  const [formData, onHand] = await Promise.all([
    loadCountFormData(auth, location),
    loadOnHand(auth, location),
  ]);

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <h1 className="mb-1 text-lg font-bold text-co-text">{serverT(lang, "counts.page.title")}</h1>
      <p className="mb-4 text-[11px] text-co-text-muted">{serverT(lang, "counts.page.subtitle")}</p>

      {/* Recomposition PR 3: phone keeps the stack (count form → on-hand); lg+
          puts the ACTION (physical count entry) beside the REFERENCE (computed
          on-hand) — the operator counting a shelf can see the drift math answer
          without scrolling away from the form. Source order unchanged. */}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
      <CountForm skus={formData.skus} locationId={location} />

      <div className="lg:min-w-0">
      <h2 className="mt-6 text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim lg:mt-0">{serverT(lang, "counts.onhand.title")}</h2>
      <OnHandPanel view={onHand} lang={lang} />
      </div>
      </div>
    </main>
  );
}
