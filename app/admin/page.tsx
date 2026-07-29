/**
 * /admin hub (C.44 Module 1) — card grid of admin sections the viewer can
 * reach. Renders inside app/admin/layout.tsx (auth + role gate + chrome).
 * Re-calls requireSessionFromHeaders for typed auth access (the C.39 pattern;
 * ~5ms duplicate cost is accepted vs prop-drilling from the layout).
 */

import { countNotReady } from "@/lib/admin/readiness-load";
import { adminSectionsFor } from "@/lib/admin/sections";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { AlertPill } from "@/components/ui/AlertPill";

export default async function AdminHubPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const lang = auth.user.language;
  const sections = adminSectionsFor(auth.level);

  const wantsCounts = sections.some(
    (s) => s.id === "skus" || s.id === "recipes" || s.id === "items",
  );
  let counts: Record<string, number> = {};
  if (wantsCounts) {
    try {
      const c = await countNotReady(auth);
      counts = { skus: c.skus, recipes: c.recipes, items: c.items };
    } catch (e) {
      console.error("hub readiness counts failed (rendering without pills)", e);
    }
  }

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.hub.heading")}
        subtitle={serverT(lang, "admin.hub.subtitle")}
      />

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
          <a
            key={s.id}
            href={s.href}
            className="co-card co-card-interactive p-4 text-base font-bold text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          >
            {serverT(lang, s.i18nKey)}
            {(counts[s.id] ?? 0) > 0 ? (
              <AlertPill tone="danger" uppercase={false} className="ml-2">
                {serverT(lang, "readiness.hub.count", { count: counts[s.id]! })}
              </AlertPill>
            ) : null}
          </a>
        ))}
      </div>
    </div>
  );
}
