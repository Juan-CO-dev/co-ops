/**
 * Role-model renumber — session-revocation cutover (Task 9, migration 0058).
 *
 * WHY THIS EXISTS
 * ---------------
 * Migration 0058 renumbered the role-level scale 0-10 (employee stays 3;
 * key_holder/trainer rose 3→4; +4 new roles). The DB RLS layer
 * (current_user_role_level()) and the app lib gates (requireSession recomputes
 * AuthContext.level fresh from the DB role string on every request) are BOTH
 * already on the new scale the moment the new lib/roles.ts deploys.
 *
 * The ONE thing that stays stale across the renumber is the JWT-baked
 * `role_level` claim (lib/session.ts:184 mints it from getRoleLevel() at LOGIN
 * time, frozen into the token). Audit (2026-06-04) confirmed that claim is
 * consumed by exactly one site — proxy.ts:82 writes it into the x-co-role-level
 * header — and NOTHING reads that header for authorization. So the stale claim
 * is inert, not a security hole. This revoke is therefore CLEANUP: it flushes
 * stale-scale tokens so every active session re-mints against the deployed
 * new-scale lib, and makes the 4 new roles loginable.
 *
 * RUN-TIMING IS LOAD-BEARING
 * --------------------------
 * Run this ONLY AFTER the new lib/roles.ts is deployed to production. A
 * re-login bakes whatever the *deployed* lib says into the fresh token —
 * revoking before deploy would force re-logins that re-bake stale-scale
 * claims (reverse split-brain). Sequence: migrate (done) → merge+deploy lib/UI
 * → THIS revoke at a quiet window → Commit B rebases onto corrected main.
 *
 * BLAST RADIUS
 * ------------
 * Revokes ALL active sessions across ALL users (no exclude-self). That is
 * deliberate: every stale-scale token must flush, including the operator's own.
 * Running it logs the operator out; their next request hits requireSession,
 * sees revoked_at set, returns 401 + clears the cookie + redirects to login;
 * re-login mints a fresh new-scale token. That re-login is the live proof the
 * deployed scale works end-to-end.
 *
 * SAFETY: defaults to DRY-RUN. It prints what WOULD be revoked and writes
 * nothing. Pass --execute to actually revoke + emit the audit row. This makes
 * the staged-but-not-run requirement safe: an accidental invocation is a no-op.
 *
 * Invoke (dry-run):  npx tsx --env-file=.env.local scripts/role-renumber-revoke-sessions.ts
 * Invoke (execute):  npx tsx --env-file=.env.local scripts/role-renumber-revoke-sessions.ts --execute
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";

// Juan's CGS user id — same literal actor used by migration 0058's audit row.
const ACTOR_ID = "16329556-900e-4cbb-b6e0-1829c6f4a6ed";

interface ActiveSessionRow {
  id: string;
  user_id: string;
  created_at: string;
  last_activity_at: string | null;
}

async function loadActiveSessions(
  svc: ReturnType<typeof getServiceRoleClient>,
): Promise<ActiveSessionRow[]> {
  const { data, error } = await svc
    .from("sessions")
    .select("id, user_id, created_at, last_activity_at")
    .is("revoked_at", null)
    .order("user_id", { ascending: true });
  if (error) throw new Error(`load active sessions: ${error.message}`);
  return (data ?? []) as ActiveSessionRow[];
}

function summarize(rows: ActiveSessionRow[]): void {
  const byUser = new Map<string, number>();
  for (const r of rows) byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + 1);
  console.log(`\nActive sessions: ${rows.length} across ${byUser.size} user(s)`);
  console.table(
    [...byUser.entries()].map(([user_id, count]) => ({ user_id, active_sessions: count })),
  );
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const svc = getServiceRoleClient();

  const active = await loadActiveSessions(svc);
  summarize(active);

  if (!execute) {
    console.log(
      "\nDRY-RUN — nothing revoked. Re-run with --execute to flush these " +
        "sessions (only AFTER the new-scale lib is deployed to production).",
    );
    return;
  }

  if (active.length === 0) {
    console.log("\nNo active sessions to revoke. Nothing to do.");
    return;
  }

  const revokedAt = new Date().toISOString();
  const { data: revoked, error } = await svc
    .from("sessions")
    .update({ revoked_at: revokedAt })
    .is("revoked_at", null)
    .select("id, user_id");
  if (error) throw new Error(`revoke sessions: ${error.message}`);

  const revokedRows = (revoked ?? []) as Array<{ id: string; user_id: string }>;
  console.log(`\nRevoked ${revokedRows.length} session(s) at ${revokedAt}.`);

  await audit({
    actorId: ACTOR_ID,
    actorRole: "cgs",
    action: "role_model.renumber",
    resourceTable: "sessions",
    resourceId: null,
    metadata: {
      actor_context: "script_apply",
      script: "role-renumber-revoke-sessions",
      cutover_phase: "session_revocation",
      migration: "0058_role_model_renumber",
      reason:
        "Flush stale-scale JWT role_level claims after new-scale lib deploy; " +
        "forces re-mint against deployed lib/roles.ts.",
      revoked_at: revokedAt,
      sessions_revoked: revokedRows.length,
      revoked_session_ids: revokedRows.map((r) => r.id),
      affected_user_ids: [...new Set(revokedRows.map((r) => r.user_id))],
    },
    ipAddress: null,
    userAgent: null,
  });

  console.log("Audit row emitted (action=role_model.renumber, cutover_phase=session_revocation).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
