/** /profile/[userId] — a teammate's positive public profile (shared-location gated). */
import { redirect } from "next/navigation";

import { accessibleLocations, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { loadPublicProfile } from "@/lib/profiles";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
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
      <div className="mb-3"><DashboardBackLink /></div>
      <PublicProfileCard profile={profile} language={lang} isSelf={profile.userId === auth.user.id} />
    </main>
  );
}
