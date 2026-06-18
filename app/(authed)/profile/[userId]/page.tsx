/** /profile/[userId] — a teammate's positive public profile (shared-location gated). */
import { redirect } from "next/navigation";
import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import { accessibleLocations, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { loadPublicProfile } from "@/lib/profiles";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { LeadershipCard } from "@/components/profile/LeadershipCard";
import { PublicProfileCard } from "@/components/profile/PublicProfileCard";

interface PageProps { params: Promise<{ userId: string }>; }

export default async function PublicProfilePage({ params }: PageProps) {
  const auth = await requireSessionFromHeaders("/profile");
  const { userId } = await params;
  const lang = auth.user.language;
  const sb = getServiceRoleClient();
  const actor: LocationActor = { role: auth.role, locations: auth.locations };
  const profile = await loadPublicProfile(sb, {
    viewerUserId: auth.user.id,
    viewerLocations: accessibleLocations(actor),
    targetUserId: userId,
    today: operationalNow(new Date()).date,
  });
  if (!profile) redirect("/profile"); // not viewable / not found → back to directory

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-xs font-semibold text-co-text-muted transition hover:text-co-text"
        >
          ← {serverT(lang, "profile.back")}
        </Link>
      </div>
      {profile.cardKind === "leadership" ? (
        <div className="flex flex-col gap-4">
          <LeadershipCard profile={profile} language={lang} />
          <PublicProfileCard profile={profile} language={lang} isSelf={profile.userId === auth.user.id} />
        </div>
      ) : (
        <PublicProfileCard profile={profile} language={lang} isSelf={profile.userId === auth.user.id} />
      )}
    </main>
  );
}
