/** Operator: SUPABASE_ACCESS_TOKEN in environment, node scripts/preflight-0276-management.mjs --ref=<ref>.
 * Any project allowed. One READ ONLY transaction, no .env, no writes. */
import { pathToFileURL } from 'node:url';
import { signatures } from './preflight-0276.mjs';
import { literal, managementQuery, projectRef } from './supabase-management-query.mjs';
export async function preflightManagement(query) {
  const rows = await query(`begin read only; set local statement_timeout = '10s';
    select signature, to_regprocedure(signature) is not null as present,
      coalesce(has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE'), false) as executable
    from unnest(array[${signatures.map(literal).join(',')}]::text[]) as required(signature); commit;`);
  if (signatures.some(signature => !rows.some(row => row.signature === signature && row.present === true && row.executable === true))) {
    throw new Error('0276 preflight: required function or service_role EXECUTE missing');
  }
  return rows;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(async () => {
    const ref = projectRef(process.argv.slice(2));
    await preflightManagement(managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN));
    console.log('PASS 0276 Management API preflight');
  }).catch(() => { console.error('FAIL 0276 Management API preflight: check arguments, token, connectivity and required grants'); process.exitCode = 1; });
}
