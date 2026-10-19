/** Read-only deployment preflight; CC runs before promoting the app.
 * Set CHECKLIST_PREFLIGHT_DATABASE_URL in the process environment explicitly.
 * Never loads .env, calls a writer RPC, or prints connection details.
 * Requires pg installed by the operator. Catalog reads only, READ ONLY txn.
 */
import { pathToFileURL } from "node:url";

export const signatures = [
  "public.checklist_write_completion(uuid,uuid,uuid,numeric,uuid,text)",
  "public.checklist_submit_batch(uuid,uuid,uuid[])",
  "public.checklist_confirm_instance(uuid,uuid,timestamp with time zone,jsonb,uuid[])",
  // Chunk 3 added this writer and the checklist RPCs depend on both helpers.
  "public.written_report_update_self(uuid,uuid,text,text,text,integer)",
  "public.checklist_actor_level(uuid,uuid)",
  "public.assignment_author_level(uuid)",
];

export async function preflight(client) {
  await client.query("begin read only");
  try {
    await client.query("set local statement_timeout = '10s'");
    const { rows } = await client.query(`
      select signature, to_regprocedure(signature) is not null as present,
        coalesce(has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE'), false) as executable
      from unnest($1::text[]) as required(signature)`, [signatures]);
    const failures = signatures.filter(signature => {
      const row = rows.find(row => row.signature === signature);
      return !row?.present || !row.executable;
    });
    if (failures.length) throw new Error(`0276_missing: missing function or service_role EXECUTE: ${failures.join(", ")}`);
    return rows;
  } finally {
    await client.query("rollback");
  }
}

async function main() {
  const connectionString = process.env.CHECKLIST_PREFLIGHT_DATABASE_URL;
  if (!connectionString) throw new Error("Set CHECKLIST_PREFLIGHT_DATABASE_URL explicitly; no .env is loaded");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    await preflight(client);
    console.log(`PASS 0276 preflight: ${signatures.length} required functions exist with service_role EXECUTE`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Connection errors can contain connection details; print only known catalog failures.
    console.error(error.message.startsWith("0276_missing:") || error.message.startsWith("Set CHECKLIST_")
      ? error.message : "0276 preflight failed; check connectivity and catalog access");
    process.exitCode = 1;
  });
}
