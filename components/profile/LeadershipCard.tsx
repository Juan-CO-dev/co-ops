/**
 * Leadership identity/contact card — pure presentational Server Component
 * (no client hooks). Renders a single leadership-tier user (MoO+): name, role,
 * a leadership tag, the oversight line, location scope, and contact links.
 *
 * The PublicProfile contract carries cardKind: "leadership" plus contact +
 * locationScope for these users (see lib/profiles.ts). The stats fields the
 * staff card uses are deliberately ignored here.
 */

import type { Language, TranslationKey } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import type { PublicProfile } from "@/lib/profiles";
import { ROLES } from "@/lib/roles";

export function LeadershipCard({
  profile,
  language,
}: {
  profile: PublicProfile;
  language: Language;
}) {
  const initial = (profile.name.charAt(0) || "?").toUpperCase();
  const email = profile.contact?.email ?? null;
  const phone = profile.contact?.phone ?? null;
  const scope =
    profile.locationScope === "all"
      ? serverT(language, "profile.leadership.all_locations")
      : (profile.locationScope ?? []).join(" · ");

  return (
    <div className="rounded-2xl border-2 border-co-border bg-co-warning-surface p-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-co-gold text-lg font-extrabold text-co-text">
          {initial}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-extrabold text-co-text">{profile.name}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-co-text-muted"
              style={{ backgroundColor: "#f1ede0" }}
            >
              {ROLES[profile.role].shortLabel}
            </span>
            <span className="rounded-full bg-co-gold/20 px-2 py-0.5 text-[10px] font-bold uppercase text-co-text-dim">
              {serverT(language, "profile.leadership.tag")}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-co-text-muted">
            {serverT(language, `profile.leadership.oversees.${profile.role}` as TranslationKey)}
          </p>
        </div>
      </div>

      {/* Location scope */}
      <p className="mt-1 text-xs text-co-text-muted">📍 {scope}</p>

      {/* Contact block */}
      {(email || phone) && (
        <div className="mt-4">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
            {serverT(language, "profile.leadership.contact")}
          </p>
          {email && (
            <a
              href={`mailto:${email}`}
              className="flex items-center gap-2 text-sm text-co-text underline-offset-2 hover:underline"
            >
              <span aria-hidden>✉</span>
              {email}
            </a>
          )}
          {phone && (
            <a
              href={`tel:${phone}`}
              className="flex items-center gap-2 text-sm text-co-text underline-offset-2 hover:underline"
            >
              <span aria-hidden>📞</span>
              {phone}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
