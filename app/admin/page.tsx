/**
 * /admin hub (C.44 Module 1) — card grid of admin sections the viewer can
 * reach. Renders inside app/admin/layout.tsx (auth + role gate + chrome).
 * Re-calls requireSessionFromHeaders for typed auth access (the C.39 pattern;
 * ~5ms duplicate cost is accepted vs prop-drilling from the layout).
 */

import { adminSectionsFor } from "@/lib/admin/sections";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function AdminHubPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const lang = auth.user.language;
  const sections = adminSectionsFor(auth.level);

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
          </a>
        ))}
      </div>
    </div>
  );
}
