/** Real migration chain, synthetic PGlite only; preserves every 0275 assertion. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { crewStructureCases, loadStructureCases, materializeStructureCase } from "./schedule-structure-cases.mjs";
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const require = createRequire(import.meta.url);
let source = read("scripts/sql-harness-0275.mjs");
source = source.replace('"../lib/scheduling/rpc-args-shared.ts"', JSON.stringify(pathToFileURL(resolve("lib/scheduling/rpc-args-shared.ts")).href));
source = source.replace('"@electric-sql/pglite"', JSON.stringify(pathToFileURL(require.resolve("@electric-sql/pglite")).href));
const cases = [...loadStructureCases().map(c => ({name:c.name,value:materializeStructureCase(c),valid:c.valid})),
  ...crewStructureCases().map(c => ({...c,valid:c.key === null}))];
for (const engine of ["stations", "crew"]) {
  const base = structuredClone(crewStructureCases().find(c => c.name === "crew").value);
  base.engine = engine;
  for (const cap of [undefined, 0, 1, 2, 3, 4, -1, 1.5, "1", null]) {
    const value = structuredClone(base);
    if (cap !== undefined) value.roster.backupCoverPerDay = cap;
    cases.push({name:`${engine} backup cover ${JSON.stringify(cap)}`,value,
      valid:cap === undefined || Number.isInteger(cap) && cap >= 0 && cap <= 3});
  }
  cases.push({name:`${engine} unknown roster key`,value:{...base,roster:{...base.roster,unknown:1}},valid:false});
}
source = source.replace('  check(true, "0275 applied with every SQL guard");', `
  const m0285 = read("supabase/migrations/0285_schedule_backup_cover.sql");
  await refuses(() => db.exec(m0285), "0285: 0283 and 0284 must be applied first", "0285 prerequisites");
  await db.exec("rollback");
  await db.exec(read("supabase/migrations/0283_schedule_crew_structure.sql"));
  await refuses(() => db.exec(m0285), "0285: 0283 and 0284 must be applied first", "0285 requires 0284");
  await db.exec("rollback");
  await db.exec(read("supabase/migrations/0284_schedule_crew_gaps.sql"));
  const capCertificate = {kind:"open_shifts",items:[{typeId:"mid",fromQ:40,toQ:60,required:1,placed:0,missing:1,
    rejected:[{userId:"backup-person",codes:["backup_cover_cap"]}]}]};
  const validCertificate = async value => (await db.query("select public.valid_gap_certificate('crew_shortfall',$1::jsonb) ok",[JSON.stringify(value)])).rows[0].ok;
  check(await validCertificate(capCertificate) === false,"0284 rejects backup_cover_cap before migration");
  await db.exec(m0285);
  check(await validCertificate(capCertificate) === true,"0285 admits backup_cover_cap");
  for (const codes of [["off"],["off","backup_cover_cap"],["invented"],["backup_cover_cap","backup_cover_cap"]]) {
    const value = structuredClone(capCertificate);
    value.items[0].rejected[0].codes = codes;
    check(await validCertificate(value) === (codes[0] === "off"),"0285 bounded rejection vocabulary " + codes.join(","));
  }
  for (const c of ${JSON.stringify(cases)}) {
    const result = (await db.query("select public.valid_schedule_structure($1::jsonb) ok",[JSON.stringify(c.value)])).rows[0].ok;
    check(result === c.valid,"0285 structure: " + c.name);
  }
  for (const signature of ["public.valid_schedule_structure(jsonb)","public.valid_gap_certificate(text,jsonb)"]) {
    const props = (await db.query("select provolatile, proconfig, has_function_privilege('anon',oid,'EXECUTE') a, has_function_privilege('authenticated',oid,'EXECUTE') u, has_function_privilege('service_role',oid,'EXECUTE') s from pg_proc where oid=$1::regprocedure",[signature])).rows[0];
    check(props.provolatile === "i" && JSON.stringify(props.proconfig) === JSON.stringify(["search_path=pg_catalog, public"]) && !props.a && !props.u && props.s,"0285 immutability/search_path/grants " + signature);
  }
  check((await db.query("select strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure),'0285 backup cover') > 0 ok")).rows[0].ok,"0285 marker");
  await refuses(() => db.exec(m0285), "0285: already applied", "0285 repeat apply");
  await db.exec("rollback");
  check(true, "0285 applied with every SQL guard");`);
source = source.replace('PASS 0275: ${checks} checks', 'PASS 0285: ${checks} checks (including unchanged 0275 assertions)');
await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
