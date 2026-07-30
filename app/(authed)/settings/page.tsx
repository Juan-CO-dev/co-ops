/**
 * /settings — user preferences.
 *
 * v1 is deliberately thin — it establishes the preferences-page pattern without
 * inventing schema. Today the only self-configurable, schema-backed preference
 * is LANGUAGE (users.language, self-updated via /api/users/me/language). Profile
 * identity (blurb, team directory) lives on /profile; Settings links there
 * rather than duplicating it. Notification preferences (user_notification_prefs
 * table exists but has no data layer yet) are a named follow-up.
 *
 * Moved into the (authed) route group (mirrors the reports hub migration) so it
 * sits behind the authed layout while keeping the /settings URL.
 */

import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { PageHeader } from "@/components/ui/PageHeader";
import { LanguageSettingCard } from "@/components/settings/LanguageSettingCard";

export default async function SettingsPage() {
  const auth = await requireSessionFromHeaders("/settings");
  const lang = auth.user.language;

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <PageHeader
        title={serverT(lang, "settings.page.title")}
        subtitle={serverT(lang, "settings.page.subtitle")}
        className="mb-4"
      />

      <div className="flex flex-col gap-4">
        <LanguageSettingCard />

        {/* Profile — link, not a duplicate. Identity + team directory live there. */}
        <section className="co-card p-4">
          <h2 className="text-base font-extrabold text-co-text">
            {serverT(lang, "settings.profile.title")}
          </h2>
          <p className="mt-0.5 text-sm text-co-text-muted">
            {serverT(lang, "settings.profile.sub")}
          </p>
          <Link
            href="/profile"
            className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border-2 bg-co-surface px-4 text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted transition hover:border-co-text hover:text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          >
            {serverT(lang, "settings.profile.link")}
          </Link>
        </section>

        {/* Honest placeholder for the deferred notification-prefs surface. */}
        <section className="co-card p-4">
          <h2 className="text-base font-extrabold text-co-text">
            {serverT(lang, "settings.more.title")}
          </h2>
          <p className="mt-0.5 text-sm text-co-text-muted">
            {serverT(lang, "settings.more.sub")}
          </p>
        </section>
      </div>
    </main>
  );
}
