/** /profile — team directory of viewable teammates (shared location). */
import { serverT } from "@/lib/i18n/server";
import { accessibleLocations, type LocationActor } from "@/lib/locations";
import { loadProfileDirectory } from "@/lib/profiles";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { ProfileDirectory } from "@/components/profile/ProfileDirectory";

export default async function ProfilePage() {
  const auth = await requireSessionFromHeaders("/profile");
  const lang = auth.user.language;
  const sb = getServiceRoleClient();
  const actor: LocationActor = { role: auth.role, locations: auth.locations };
  const { staff, leadership } = await loadProfileDirectory(sb, {
    viewer: { userId: auth.user.id, locations: accessibleLocations(actor) },
  });
  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <h1 className="text-lg font-bold text-co-text">{serverT(lang, "profile.directory_title")}</h1>
      <p className="mb-4 text-xs text-co-text-muted">{serverT(lang, "profile.directory_sub")}</p>
      <ProfileDirectory staff={staff} leadership={leadership} viewerUserId={auth.user.id} language={lang} />
    </main>
  );
}
