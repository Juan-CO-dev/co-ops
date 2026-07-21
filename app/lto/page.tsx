import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { loadPackageLocations } from "@/lib/admin/catering/packages";
import { loadPerishableSurplus, SURPLUS_READ_MIN } from "@/lib/catering/surplus";
import { PlaceholderCard } from "@/components/PlaceholderCard";

export const dynamic = "force-dynamic";

/** YYYY-MM-DD of today (request-time) in operational TZ. */
function todayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

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

  const from = todayYmd();
  const to = addDays(from, 14);

  // Perishable surplus teaser — only for catering_mgr+ (level >= SURPLUS_READ_MIN)
  let surplusItems: Array<{ name: string; qty: number; portion: string | null; locationName: string; needDate: string }> = [];

  if (level >= SURPLUS_READ_MIN) {
    const locations = await loadPackageLocations(auth);
    if (locations.length > 0) {
      const perLocationResults = await Promise.all(
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
      );
      surplusItems = perLocationResults.flat();
    }
  }

  return (
    <div className="flex flex-col gap-5">
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
                  <span className="font-medium text-co-cta">
                    {item.qty}
                    {" × "}
                    {item.portion ? `${item.portion} ` : ""}
                    {item.name}
                  </span>
                  <span className="text-xs text-co-text-muted">{item.locationName}</span>
                  <span className="text-xs text-co-text-muted">{item.needDate}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ─── Module #17 placeholder ──────────────────────────────────── */}
      <PlaceholderCard
        title="LTO Performance"
        description="Per-LTO sales, food cost, and customer rating tracking."
        features={[
          "Units sold + revenue per LTO",
          "Food cost % calculation",
          "Customer rating average",
          "Compare across locations and time windows",
        ]}
        shippingIn="Module #17 (LTO Performance)"
      />
    </div>
  );
}
