import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES, canActOn } from "@/lib/roles";
import { canOpenUserAdmin } from "@/lib/admin/user-access-shared";
import { employmentAvailable } from "@/lib/admin/employment";
import { whosHereEnabled } from "@/lib/whos-here";
import { isAllLocationsAccess } from "@/lib/locations";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listUsers, type ListUsersFilters } from "@/lib/admin/users";
import { UserAdminClient } from "@/components/admin/users/UserAdminClient";
import { PageHeader } from "@/components/ui/PageHeader";
import type { RoleCode } from "@/lib/roles";
import { operationalNow } from "@/lib/midshift-shared";
import { loadUserPositionPickers } from "@/lib/scheduling/user-positions";
import type { ShopPositionPicker } from "@/lib/scheduling/user-positions-shared";

export default async function AdminUsersPage({
  searchParams,
}: { searchParams: Promise<{ role?: string; status?: string; location?: string; q?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin");
  // GM and up (staff separations ADDENDUM, Juan 2026-10-20): a GM sees and manages their own shops' people only.
  if (!canOpenUserAdmin(auth.user.role)) redirect("/admin?denied=users");
  const lang = auth.user.language;
  const sp = await searchParams;

  const filters: ListUsersFilters = {
    role: sp.role && sp.role in ROLES ? (sp.role as RoleCode) : undefined,
    active: sp.status === "active" ? true : sp.status === "inactive" ? false : undefined,
    locationId: sp.location || undefined,
    query: sp.q || undefined,
  };
  const users = await listUsers(filters, { userId: auth.user.id, role: auth.user.role, locations: auth.locations });

  const sb = getServiceRoleClient();
  const { data: locRows } = await sb.from("locations").select("id, name, code").eq("active", true).order("name");
  const allLocations = (locRows ?? []).map((r) => ({ id: (r as { id: string }).id, name: (r as { name: string }).name, code: (r as { code: string }).code }));
  const actorAll = isAllLocationsAccess({ role: auth.user.role, locations: auth.locations });
  const accessibleLocations = actorAll ? allLocations : allLocations.filter((l) => auth.locations.includes(l.id));
  const assignableRoles = Object.values(ROLES).filter((r) => canActOn(auth.user.role, r.code)).map((r) => r.code);

  // Juan 2026-10-20: the primary / secondary pickers (the "Positions" action and the Add user form), for the shops the
  // viewer may assign (a GM: their own; the schedule route re-checks the subject rule). A shop whose scheduling tables are not installed is null (the
  // pickers say "not available"); any other failure must not take user management down with it — the screen then offers
  // no Positions action at all (logged), and everything else on it works as before.
  let positionShops: Record<string, ShopPositionPicker | null> | undefined;
  try {
    positionShops = await loadUserPositionPickers(sb, {
      locationIds: accessibleLocations.map((l) => l.id),
      people: users.map((u) => ({ userId: u.id, role: u.role, locationIds: u.locationIds })),
      today: operationalNow(new Date()).date,
    });
  } catch (e) {
    console.error("admin/users: position pickers unavailable", e instanceof Error ? e.message : e);
    positionShops = undefined;
  }

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.users.title")}
        subtitle={serverT(lang, "admin.users.subtitle")}
      />
      <UserAdminClient
        users={users}
        allLocations={allLocations}
        accessibleLocations={accessibleLocations}
        assignableRoles={assignableRoles}
        actorRole={auth.user.role}
        actorLevel={ROLES[auth.user.role].level}
        actorUserId={auth.user.id}
        actorLocations={auth.locations}
        employmentAvailable={await employmentAvailable(sb).catch(() => false)}
        toastPickerEnabled={whosHereEnabled()}
        today={operationalNow(new Date()).date}
        currentFilters={{ role: sp.role ?? "", status: sp.status ?? "", location: sp.location ?? "", q: sp.q ?? "" }}
        positionShops={positionShops}
      />
    </div>
  );
}
