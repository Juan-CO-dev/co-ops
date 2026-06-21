import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES, canActOn } from "@/lib/roles";
import { isAllLocationsAccess } from "@/lib/locations";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listUsers, type ListUsersFilters } from "@/lib/admin/users";
import { UserAdminClient } from "@/components/admin/users/UserAdminClient";
import type { RoleCode } from "@/lib/roles";

export default async function AdminUsersPage({
  searchParams,
}: { searchParams: Promise<{ role?: string; status?: string; location?: string; q?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 8) redirect("/dashboard");
  const lang = auth.user.language;
  const sp = await searchParams;

  const filters: ListUsersFilters = {
    role: sp.role && sp.role in ROLES ? (sp.role as RoleCode) : undefined,
    active: sp.status === "active" ? true : sp.status === "inactive" ? false : undefined,
    locationId: sp.location || undefined,
    query: sp.q || undefined,
  };
  const users = await listUsers(filters);

  const sb = getServiceRoleClient();
  const { data: locRows } = await sb.from("locations").select("id, name, code").eq("active", true).order("name");
  const allLocations = (locRows ?? []).map((r) => ({ id: (r as { id: string }).id, name: (r as { name: string }).name, code: (r as { code: string }).code }));
  const actorAll = isAllLocationsAccess({ role: auth.user.role, locations: auth.locations });
  const accessibleLocations = actorAll ? allLocations : allLocations.filter((l) => auth.locations.includes(l.id));
  const assignableRoles = Object.values(ROLES).filter((r) => canActOn(auth.user.role, r.code)).map((r) => r.code);

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">{serverT(lang, "admin.users.title")}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.users.subtitle")}</p>
      <UserAdminClient
        users={users}
        allLocations={allLocations}
        accessibleLocations={accessibleLocations}
        assignableRoles={assignableRoles}
        actorRole={auth.user.role}
        actorLevel={ROLES[auth.user.role].level}
        currentFilters={{ role: sp.role ?? "", status: sp.status ?? "", location: sp.location ?? "", q: sp.q ?? "" }}
      />
    </div>
  );
}
