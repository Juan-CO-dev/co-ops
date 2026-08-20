import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import { loadPackageLocations } from "@/lib/admin/catering/packages";
import { loadPerishableSurplus, SURPLUS_READ_MIN } from "@/lib/catering/surplus";
import { listLtoEvents } from "@/lib/catering/lto";
import { etCalendarDate } from "@/lib/operational-day";
import { BackLink } from "@/components/nav/BackLink";
import { PlaceholderCard } from "@/components/PlaceholderCard";
import { AlertPill } from "@/components/ui/AlertPill";

export const dynamic = "force-dynamic";

/** Add `days` calendar days to a YYYY-MM-DD string. */
function addDays(yyyymmdd: string, days: number): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  if (!y || !m || !d) return yyyymmdd;
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export default async function LtoPage() {
  const auth = await requireSessionFromHeaders("/lto");
  const level = ROLES[auth.user.role].level;
  const lang = auth.user.language;

  const from = etCalendarDate(new Date().toISOString());
  const to = addDays(from, 14);

  // Perishable surplus teaser — only for catering_mgr+ (level >= SURPLUS_READ_MIN)
  let surplusItems: Array<{ name: string; qty: number; portion: string | null; locationName: string; needDate: string }> = [];
  // Active LTO/discount events across actor's locations — level >= SURPLUS_READ_MIN gated same as surplus
  let activeLtoItems: Array<{
    id: string;
    name: string;
    kind: string;
    discountBps: number | null;
    promoPriceCents: number | null;
    startsOn: string;
    endsOn: string;
    items: { name: string; qty: number }[];
    locationName: string;
  }> = [];

  if (level >= SURPLUS_READ_MIN) {
    const locations = await loadPackageLocations(auth);
    if (locations.length > 0) {
      const [perLocationResults, perLocationLto] = await Promise.all([
        Promise.all(
          locations.map(async (loc) => {
            const lines = await loadPerishableSurplus(auth, { locationId: loc.id, from, to });
            return lines.map((l) => ({
              name: l.name,
              qty: l.qty,
              portion: l.portion,
              locationName: loc.name,
              needDate: l.needDate,
            }));
          }),
        ),
        Promise.all(
          locations.map(async (loc) => {
            const events = await listLtoEvents(auth, { locationId: loc.id, activeOnly: true });
            return events.map((ev) => ({
              id: ev.id,
              name: ev.name,
              kind: ev.kind,
              discountBps: ev.discountBps,
              promoPriceCents: ev.promoPriceCents,
              startsOn: ev.startsOn,
              endsOn: ev.endsOn,
              items: ev.items,
              locationName: loc.name,
            }));
          }),
        ),
      ]);
      surplusItems = perLocationResults.flat();
      activeLtoItems = perLocationLto.flat();
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl flex-col gap-5 px-4 py-6">
      <BackLink />
      {/* ─── Active LTOs & discounts (catering_mgr+ only) ───────────── */}
      {level >= SURPLUS_READ_MIN && (
        <section className="co-card p-4">
          <h2 className="mb-2 text-base font-extrabold text-co-text">
            {serverT(lang, "lto.active_title" as TranslationKey)}
          </h2>
          {activeLtoItems.length === 0 ? (
            <p className="text-sm text-co-text-muted">
              {serverT(lang, "lto.active_empty" as TranslationKey)}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {activeLtoItems.map((ev) => {
                const terms =
                  ev.discountBps != null && ev.promoPriceCents != null
                    ? `${(ev.discountBps / 100).toFixed(0)}% off · $${(ev.promoPriceCents / 100).toFixed(2)}`
                    : ev.discountBps != null
                      ? `${(ev.discountBps / 100).toFixed(0)}% off`
                      : ev.promoPriceCents != null
                        ? `$${(ev.promoPriceCents / 100).toFixed(2)}`
                        : "";
                return (
                  <li
                    key={ev.id}
                    className="co-card flex flex-wrap items-start gap-2 px-3 py-2 text-sm text-co-text"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{ev.name}</span>
                        <AlertPill tone="warn">{ev.kind}</AlertPill>
                        {terms && (
                          <span className="text-xs font-medium text-co-text-muted">{terms}</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-co-text-muted">
                        {formatDateLabel(ev.startsOn, lang)} – {formatDateLabel(ev.endsOn, lang)} · {ev.locationName}
                      </p>
                      {ev.items.length > 0 && (
                        <p className="mt-0.5 text-xs text-co-text-muted">
                          {ev.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* ─── Perishable surplus teaser (catering_mgr+ only) ──────────── */}
      {level >= SURPLUS_READ_MIN && (
        <section className="co-card p-4">
          <h2 className="mb-2 text-base font-extrabold text-co-text">
            {serverT(lang, "lto.surplus_title" as TranslationKey)}
          </h2>
          {surplusItems.length === 0 ? (
            <p className="text-sm text-co-text-muted">
              {serverT(lang, "lto.surplus_empty" as TranslationKey)}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {surplusItems.map((item, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text"
                >
                  <span className="font-medium text-co-cta-text">
                    {item.qty}
                    {" × "}
                    {item.portion ? `${item.portion} ` : ""}
                    {item.name}
                  </span>
                  <span className="text-xs text-co-text-muted">{item.locationName}</span>
                  <span className="text-xs text-co-text-muted">{formatDateLabel(item.needDate, lang)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ─── Module #17 placeholder ──────────────────────────────────── */}
      <PlaceholderCard
        showBackLink={false}
        title={serverT(lang, "lto.ph.title")}
        description={serverT(lang, "lto.ph.description")}
        features={[
          serverT(lang, "lto.ph.feature.units_revenue"),
          serverT(lang, "lto.ph.feature.food_cost"),
          serverT(lang, "lto.ph.feature.rating"),
          serverT(lang, "lto.ph.feature.compare"),
        ]}
        shippingIn={serverT(lang, "lto.ph.shipping")}
      />
    </main>
  );
}
