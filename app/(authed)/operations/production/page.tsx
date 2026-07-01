import { redirect } from "next/navigation";
import { serverT } from "@/lib/i18n/server";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { requireSessionFromHeaders } from "@/lib/session";
import { loadProductionFormData, loadRecentProductions } from "@/lib/production";
import { ProductionForm } from "@/components/production/ProductionForm";
import { DashboardBackLink } from "@/components/DashboardBackLink";

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const auth = await requireSessionFromHeaders("/operations/production");
  const { location } = await searchParams;
  if (auth.level < 4) redirect("/dashboard");
  if (!location) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, location)) redirect("/dashboard");
  const lang = auth.user.language;
  const [formData, recent] = await Promise.all([loadProductionFormData(auth, location), loadRecentProductions(auth, location, 20)]);
  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(lang, "production.page.title")}</h1>
      <ProductionForm formData={formData} locationId={location} />
      <h2 className="mt-6 text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{serverT(lang, "production.page.recent")}</h2>
      {recent.length === 0 ? (
        <p className="mt-2 text-[11px] italic text-co-text-muted">{serverT(lang, "production.page.none")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {recent.map((p) => (
            <li key={p.id} className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-co-text">{serverT(lang, "production.recent.line", { input: `${p.inputQty} ${p.skuName}`, output: `${p.outputQty} ${p.itemName}` })}</span>
                <span className="text-xs text-co-text-muted">{p.producedAt.slice(0, 10)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
