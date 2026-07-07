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
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.hub.heading")}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">
        {serverT(lang, "admin.hub.subtitle")}
      </p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sections.map((s) => (
          <a
            key={s.id}
            href={s.href}
            className="rounded-xl border-2 border-co-border bg-co-surface p-4 text-base font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          >
            {serverT(lang, s.i18nKey)}
            {(counts[s.id] ?? 0) > 0 ? (
              <span className="ml-2 rounded bg-co-cta/15 px-2 py-0.5 text-xs font-bold text-co-cta">
                {serverT(lang, "readiness.hub.count", { count: counts[s.id]! })}
              </span>
            ) : null}
          </a>
        ))}
      </div>
    </div>
  );
}
