import { Suspense } from "react";
import { canDoOperationalTask } from "@/lib/operational-task-access";
import { redirect } from "next/navigation";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { requireSessionFromHeaders } from "@/lib/session";
import { createCountsReadRefs, loadCountFormData, loadCountReferenceData, loadOnHand, COUNT_READ_MIN, COUNT_WRITE_MIN, type OnHandView } from "@/lib/counts";
import { twinVendorLabels } from "@/lib/counts-shared";
import { CountForm } from "@/components/counts/CountForm";
import { OnHandPanel } from "@/components/counts/OnHandPanel";
import { OnHandBoundary } from "@/components/counts/OnHandBoundary";
import { DashboardBackLink } from "@/components/DashboardBackLink";
import { ExportLinks } from "@/components/reports-export/ExportLinks";

/**
 * B9: the on-hand panel STREAMS. Its read starts at the top of the render (beside the count
 * sheet's, sharing one set of reference reads), but the page flushes as soon as the SHEET is
 * ready; the panel arrives behind <Suspense>. A read that fails — or runs past this deadline,
 * which no healthy render approaches (~0.5 s on the sim) — lands in OnHandBoundary's
 * translated notice + retry instead of leaving "Loading…" up forever.
 */
const ON_HAND_DEADLINE_MS = 45_000;

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("on_hand_deadline_exceeded")), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

async function OnHandSection({ view, lang, twinVendorBySkuId }: { view: Promise<OnHandView>; lang: Language; twinVendorBySkuId: Map<string, string> }) {
  return <OnHandPanel view={await view} lang={lang} twinVendorBySkuId={twinVendorBySkuId} />;
}

export default async function CountsPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const auth = await requireSessionFromHeaders("/operations/counts");
  const { location } = await searchParams;
  if (auth.level < COUNT_WRITE_MIN) redirect("/dashboard");
  if (!location) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, location)) redirect("/dashboard");

  const mayCount = await canDoOperationalTask(auth, location, "counts");
  // Assignment governs the operational form. Existing AGM+ history/variance
  // visibility remains read-only when somebody else holds today's count task.
  if (!mayCount && auth.level < COUNT_READ_MIN) redirect("/dashboard");

  const lang = auth.user.language;
  // B9: ONE set of reference reads (roster, vendors, measures, chains, the product index +
  // lots) for the whole render — the count sheet and the on-hand panel share them.
  const refs = createCountsReadRefs(location);
  // Start the panel's read NOW, beside the sheet's. Its outcome belongs to the boundary
  // below; the no-op catch only keeps an early failure from surfacing as unhandled.
  const onHand = auth.level >= COUNT_READ_MIN ? withDeadline(loadOnHand(auth, location, undefined, refs), ON_HAND_DEADLINE_MS) : null;
  onHand?.catch(() => {});
  const formData = await (mayCount ? loadCountFormData(auth, location, refs) : loadCountReferenceData(auth, location, refs));

  return (
    <main className="mx-auto w-full max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <h1 className="mb-1 text-lg font-bold text-co-text">{serverT(lang, "counts.page.title")}</h1>
      <p className="mb-4 text-[11px] text-co-text-muted">{serverT(lang, "counts.page.subtitle")}</p>

      {/* Recomposition PR 3: phone keeps the stack (count form → on-hand); lg+
          puts the ACTION (physical count entry) beside the REFERENCE (computed
          on-hand) — the operator counting a shelf can see the drift math answer
          without scrolling away from the form. Source order unchanged. */}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
      {/* `products` is the C-mode row set (spec option C). It is EMPTY until migration
          0180 applies, and the form then renders exactly as it does on prod today. */}
      {mayCount && <CountForm skus={formData.skus} products={formData.products} locationId={location} requiresPin={auth.level < 6} />}

      {onHand && <div className="lg:min-w-0">
      <h2 className="mt-6 text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim lg:mt-0">{serverT(lang, "counts.onhand.title")}</h2>
      <ExportLinks className="mt-2" family="counts" language={lang} query={{ location }} />
      {/* P8: the ambiguous-name set is derived ONCE, from the count form's option set, and
          shared with the on-hand panel so both halves of this page disambiguate twins the
          same way. An on-hand row for an INACTIVE SKU is not in the option set and simply
          gets no label — honest, since the twin check has no basis to judge it. */}
      <OnHandBoundary message={serverT(lang, "counts.onhand.load_failed")} retryLabel={serverT(lang, "counts.onhand.retry")}>
        <Suspense fallback={<p role="status" className="mt-3 text-sm text-co-text-muted">{serverT(lang, "counts.onhand.loading")}</p>}>
          <OnHandSection view={onHand} lang={lang} twinVendorBySkuId={twinVendorLabels(formData.skus)} />
        </Suspense>
      </OnHandBoundary>
      </div>}
      </div>
    </main>
  );
}
