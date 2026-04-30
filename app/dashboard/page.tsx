/**
 * /dashboard — Phase 2 Session 4 placeholder.
 *
 * Authenticated landing surface after sign-in. Phase 4+ replaces the body
 * with the real shell (announcements, handoff card, today's open artifacts,
 * role-gated module grid) — for now, just enough to confirm sign-in worked
 * and to host the IdleTimeoutWarning client component.
 *
 * Server Component. Calls requireSessionFromHeaders('/dashboard') for the
 * full session check (sessions row, token_hash dual verify, idle, revoked,
 * deactivated user, step-up auto-clear). On any denial it redirects to
 * /?next=/dashboard so the user lands back here after re-auth.
 *
 * Note: proxy.ts already validated JWT signature + exp at the edge before
 * this handler runs. requireSessionFromHeaders is the second layer (database
 * checks) — both layers are required.
 */

import { AuthShell } from "@/components/auth/AuthShell";
import { IdleTimeoutWarning } from "@/components/auth/IdleTimeoutWarning";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { ROLES } from "@/lib/roles";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

interface LocationLite {
  id: string;
  name: string;
  code: string;
}

async function loadLocationNames(ids: string[]): Promise<LocationLite[]> {
  if (ids.length === 0) return [];
  const sb = getServiceRoleClient();
  const { data } = await sb
    .from("locations")
    .select("id, name, code")
    .in("id", ids)
    .order("name", { ascending: true });
  return (data ?? []) as LocationLite[];
}

export default async function DashboardPage() {
  const auth = await requireSessionFromHeaders("/dashboard");
  const role = ROLES[auth.role];
  const locations = await loadLocationNames(auth.locations);

  // Level 7+ (Owner, CGS) have all-locations override; if their assignment
  // list is empty, surface that instead of "no locations" — they intentionally
  // aren't bound to a specific row in user_locations.
  const allLocations = auth.level >= 7 && locations.length === 0;

  return (
    <AuthShell>
      <div className="mt-2 flex flex-col gap-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
            Dashboard
          </p>
          <h2 className="mt-1 text-3xl font-extrabold leading-tight text-co-text">
            Hi, {auth.user.name}.
          </h2>
          <p className="mt-1 text-sm text-co-text-muted">
            You're signed in. Real dashboard lands in Phase 4.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span
            className="
              inline-flex items-center gap-2 rounded-full px-3 py-1.5
              text-xs font-bold uppercase tracking-[0.14em] text-co-text
            "
            style={{
              background: role.color + "33",
              border: `1px solid ${role.color}`,
            }}
          >
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: role.color }}
            />
            {role.label}
          </span>

          {allLocations ? (
            <span
              className="
                inline-flex items-center rounded-full border-2 border-co-border-2
                bg-co-surface px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em]
                text-co-text-muted
              "
            >
              All locations
            </span>
          ) : locations.length === 0 ? (
            <span
              className="
                inline-flex items-center rounded-full border-2 border-co-border
                bg-co-surface px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em]
                text-co-text-faint
              "
            >
              No locations
            </span>
          ) : (
            locations.map((loc) => (
              <span
                key={loc.id}
                className="
                  inline-flex items-center rounded-full border-2 border-co-border-2
                  bg-co-surface px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em]
                  text-co-text-muted
                "
              >
                {loc.code} · {loc.name}
              </span>
            ))
          )}
        </div>

        <div className="rounded-2xl border-2 border-co-border bg-co-surface p-5 shadow-sm sm:p-6">
          <p className="text-sm text-co-text-muted">
            Phase 4 will replace this card with the announcements banner, the
            handoff flag, today's open checklist instances, and the role-gated
            module grid.
          </p>
        </div>

        <div className="flex justify-center">
          <LogoutButton />
        </div>
      </div>

      <IdleTimeoutWarning />
    </AuthShell>
  );
}
