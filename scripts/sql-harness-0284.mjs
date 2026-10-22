/** Replays every unchanged 0275 harness assertion under 0284, then exercises crew admission. Synthetic PGlite only. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const read = (p) => readFileSync(p, "utf8");
const require = createRequire(import.meta.url);
let source = read("scripts/sql-harness-0275.mjs");
source = source.replace('"../lib/scheduling/rpc-args-shared.ts"', JSON.stringify(pathToFileURL(resolve("lib/scheduling/rpc-args-shared.ts")).href));
source = source.replace('"@electric-sql/pglite"', JSON.stringify(pathToFileURL(require.resolve("@electric-sql/pglite")).href));
// The legacy harness still applies 0275 itself; only augment the successful main application.
source = source.replace('  check(true, "0275 applied with every SQL guard");', `
  const m0284 = read("supabase/migrations/0284_schedule_crew_gaps.sql");
  await refuses(() => db.exec(m0284), "0284: 0275 and 0283 must be applied first", "0284 prerequisite");
  await db.exec("rollback");
  await db.exec(read("supabase/migrations/0283_schedule_crew_structure.sql"));
  await db.exec(m0284);
  await refuses(() => db.exec(m0284), "0284: already applied", "0284 repeat apply");
  await db.exec("rollback");
  check(true, "0284 applied with every SQL guard");`);
const extra = `
 {
  // Isolated week preserves every unchanged legacy assertion and its fixture counts.
  await db.exec("reset role");
  await setToday(MON);
  const crewWeek = "2026-11-09";
  const dates = Array.from({length:7}, (_, i) => addDays(crewWeek, i));
  const item = {typeId:"mid",fromQ:40,toQ:60,required:2,placed:1,missing:1,rejected:[{userId:E1,codes:["off"]}]};
  const open = {date:crewWeek,code:"open_shift",positionId:null,fromQ:40,toQ:64,cause:"crew_shortfall",
    certificate:{kind:"open_shifts",items:[item,{...item,typeId:"pm",toQ:64}]}};
  const station = {date:crewWeek,code:"coverage_gap",positionId:WALK,fromQ:44,toQ:48,cause:"crew_shortfall",
    certificate:{kind:"station_short",required:2,assigned:1,onShiftUserIds:[E1]}};
  const shape = async (value) => (await db.query("select public.valid_gap_certificate('crew_shortfall',$1::jsonb) ok",[JSON.stringify(value)])).rows[0].ok;
  for (const value of [open.certificate, station.certificate]) check(await shape(value), "0284 valid certificate shape");
  const malformed = [null, [], {}, {...station.certificate,required:null}, {...station.certificate,onShiftUserIds:{}},
    {...station.certificate,onShiftUserIds:["b","a"]}, {...station.certificate,assigned:2}, {...station.certificate,extra:1},
    {...open.certificate,items:[]}, {...open.certificate,items:[{...item,missing:2}]},
    {...open.certificate,items:[{...item,rejected:[{userId:E1,codes:[]}]}]},
    {...open.certificate,items:[{...item,rejected:[{userId:E1,codes:["invented"]}]}]},
    {...open.certificate,items:[{...item,rejected:[{userId:E1,codes:["off","off"]}]}]},
    {...open.certificate,items:[item,item]}, {...open.certificate,items:[{...item,typeId:"z"},item]},
    {...open.certificate,items:[item,{...item,typeId:"pm",fromQ:41}]},
    {...open.certificate,items:[{...item,rejected:[{userId:"b",codes:["off"]},{userId:"a",codes:["off"]}]}]}];
  for (const value of malformed) check(await shape(value) === false,"0284 malformed crew shape refused");
  const crewCtx = ctx(SA, dates, 10.5, crewWeek);
  for (const d of dates) Object.assign(crewCtx.days[d], {structure:{...crewCtx.days[d].structure,engine:"crew"},crew:{version:1,shifts:[],manualOverrides:[],notes:[]}});
  const args = {week:crewWeek,days:dates.map(d=>dayRec(d)),context:crewCtx};
  await db.exec("set role service_role");
  for (const bad of [{...open,toQ:65},{...open,fromQ:39},{...open,certificate:station.certificate},
    {...station,certificate:open.certificate},{...station,code:"mod_missing",positionId:null},
    {...open,cause:"eligibility",certificate:{positionId:null,eligibleCount:0}}])
    await refuses(()=>commit({...args,gaps:[bad]}),"gap_certificate_invalid","0284 row/certificate mismatch");
  await refuses(()=>commit({...args,context:ctx(SA,dates,10.5,crewWeek),gaps:[open]}),"gap_certificate_invalid","0284 new crew gap refuses station context");
  const built = await commit({...args,gaps:[open,station]});
  const got = await carry(built.revision_id,dates);
  check(canon(got.gaps.map(g=>g.certificate).sort((a,b)=>a.kind.localeCompare(b.kind))) === canon([open.certificate,station.certificate]),"0284 both variants round-trip");
  const inherited = await commit({...args,kind:"regenerated",head:built.revision_id,...got,context:ctx(SA,[],10.5,crewWeek)});
  await refuses(()=>commit({...args,kind:"regenerated",head:inherited.revision_id,...got,gaps:[{...got.gaps[0],toQ:63},got.gaps[1]],context:ctx(SA,[],10.5,crewWeek)}),"history_changed","0284 inherited crew gap mutation refused");
  await rpc(approveWeekCall({actorId:gmA,locationId:SA,weekStart:crewWeek,expectedHead:inherited.revision_id}));
  check((await head(SA,crewWeek)).a === inherited.revision_id,"0284 certified crew gaps approvable under unchanged approval");
  const unresolvedOpen = {...open,cause:"unresolved_search",certificate:unresolved(crewWeek,EXPO,40,64).certificate};
  const unresolvedRev = await commit({...args,head:inherited.revision_id,kind:"regenerated",gaps:[unresolvedOpen]});
  await refuses(()=>rpc(approveWeekCall({actorId:gmA,locationId:SA,weekStart:crewWeek,expectedHead:unresolvedRev.revision_id})),"unresolved_gaps","0284 unresolved open shift still blocks approval");
 }
`;
source = source.replace('} catch (e) {\n  failures++;', extra + '\n} catch (e) {\n  failures++;');
source = source.replace('PASS 0275: ${checks} checks', 'PASS 0284: ${checks} checks (including unchanged 0275 assertions)');
await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
