import { getServiceRoleClient } from "@/lib/supabase-server";

const EXPECTED_AFTER: Record<string, number> = {
  trainee: 2, employee: 3, trainer: 4, key_holder: 4, shift_lead: 5,
  agm: 6, catering_mgr: 6, gm: 7, moo: 8, owner: 9, cgs: 10,
  prospect: 0, hired_not_yet_worked: 1, prep_mgr: 6, social_media_mgr: 6,
};

// Probe-user ids recorded in Step 1.
const PROBE_USERS = {
  employee: "1a21ef12-6cb1-489f-87c2-0deee2157f54",   // null/synthetic if no employee-role user exists (Step 1 note)
  key_holder: "00b317a8-7041-4369-b8db-8f81f38b15d7",
} as const;

const KH_GATES = ["revoke", "finalize", "am_prep_authority", "tag"] as const;
const BEFORE_THRESHOLD = 3; // every KH+ gate today
const AFTER_THRESHOLD = 4;  // post-renumber

// Pre-renumber CASE (mirrors current_user_role_level() BEFORE the migration).
const BEFORE_CASE: Record<string, number> = {
  cgs: 8, owner: 7, moo: 6.5, gm: 6, agm: 5, catering_mgr: 5, shift_lead: 4,
  key_holder: 3, trainer: 3, employee: 3, trainee: 2,
};

async function gateMatrix(svc: ReturnType<typeof getServiceRoleClient>) {
  for (const [label, id] of Object.entries(PROBE_USERS)) {
    if (!id) { console.log(`${label}: no live user — synthetic level from registry`); continue; }
    // current_user_role_level() reads request.jwt claims, so for an out-of-request
    // probe read the user's role and map through the SAME CASE the function uses.
    const { data, error } = await svc.from("users").select("role").eq("id", id).single<{ role: string }>();
    if (error) throw error;
    const lvlBefore = BEFORE_CASE[data.role] ?? 0;   // BEFORE_CASE = the Step 3 pre-renumber map
    const rows = KH_GATES.map((g) => ({
      gate: g,
      before_pass: lvlBefore >= BEFORE_THRESHOLD,
      // AFTER is filled by Task 10's re-run against the post-migration level:
      after_threshold: AFTER_THRESHOLD,
    }));
    console.log(`\n${label} (role=${data.role}, before_level=${lvlBefore}):`);
    console.table(rows);
  }
}

async function main() {
  const svc = getServiceRoleClient();
  // Live DB CASE output for every role code (mirrors current_user_role_level CASE).
  const { data, error } = await svc.rpc("debug_role_levels"); // see Step 3
  if (error) throw error;
  console.table(data);
  console.log("EXPECTED_AFTER (post-renumber):", EXPECTED_AFTER);
  await gateMatrix(svc);
}
main().catch((e) => { console.error(e); process.exit(1); });
