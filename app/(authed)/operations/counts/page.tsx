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

      <CountForm skus={formData.skus} locationId={location} />

      <h2 className="mt-6 text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{serverT(lang, "counts.onhand.title")}</h2>
      <OnHandPanel view={onHand} lang={lang} />
    </main>
  );
}
