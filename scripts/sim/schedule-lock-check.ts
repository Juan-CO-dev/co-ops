/**
 * SIM ONLY — the two-session `head_moved` proof (Scheduling Phase 2, Task 26, runbook step 10). Two managers edit the SAME
 * head at once: both calls go through the real lib (`saveEdit`) with the SAME expected head, concurrently. Exactly one
 * must land; the other must be refused `head_moved` by name (the 0275 commit writer serializes on the week row). Then a
 * third edit against the OLD head is refused `head_moved` too. It WRITES on the sim (one edited revision): CC runs it
 * after a week is built; the builder never ran it.
 *
 *   npx tsx --conditions=react-server --env-file=.env.sim scripts/sim/schedule-lock-check.ts --loc=<shop id> --week=<Monday>
 *
 * The actor is the sim GM persona. Exit 0 = proven; 1 = a check failed; 2 = refused / not runnable. The guard is the
 * seed's (the production ref refused by name, the exact sim origin, a service key), before any client is built.
 */
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { SIM_PERSONAS } from "./personas-shared";
import { seedTarget } from "./seed-scheduling-shared";

export async function main(): Promise<void> {
  const target = seedTarget(process.env);
  if (!target.ok) { console.error(target.reason); process.exit(2); }
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string]));
  if (!args.loc || !/^\d{4}-\d{2}-\d{2}$/.test(args.week ?? "")) { console.error("usage: --loc=<shop id> --week=<Monday YYYY-MM-DD>"); process.exit(2); }
  const service = createClient(target.url, target.key, { auth: { persistSession: false } });
  const { saveEdit } = await import("../../lib/scheduling/schedules");
  const { loadWeekHeads } = await import("../../lib/scheduling/inputs");
  const { ScheduleError } = await import("../../lib/scheduling/errors-shared");
  const { operationalNow } = await import("../../lib/midshift-shared");
  const gmPersona = SIM_PERSONAS.find((p) => p.role === "gm")!;
  const gm = await service.from("users").select("id").ilike("email", gmPersona.email).maybeSingle<{ id: string }>();
  if (gm.error || !gm.data) { console.error("the sim GM persona is missing"); process.exit(2); }
  const actor = { userId: gm.data.id, role: "gm" as const, level: 7, locations: [args.loc] };
  const heads = await loadWeekHeads(service, args.loc, [args.week!]);
  const head = heads[args.week!]?.head;
  if (!head) { console.error("no built week there: build it first (runbook step 2)"); process.exit(2); }
  const today = operationalNow(new Date()).date;
  const sh = head.shifts.find((s) => s.date > today && s.endQ < 96);
  if (!sh) { console.error("no future shift to edit in that week"); process.exit(2); }
  const op = { kind: "end" as const, shift: { date: sh.date, userId: sh.userId, startQ: sh.startQ }, toQ: sh.endQ + 1 };
  const call = () => saveEdit({ service }, { actor, locationId: args.loc!, weekStart: args.week!, expectedHead: head.revision.id, op })
    .then((r) => ({ ok: true as const, id: r.revisionId }), (e: unknown) => ({ ok: false as const, code: e instanceof ScheduleError ? e.code : `throw:${(e as Error).message}` }));
  const [a, b] = await Promise.all([call(), call()]);
  console.log("A:", JSON.stringify(a), " B:", JSON.stringify(b));
  const landed = [a, b].filter((x) => x.ok).length;
  const moved = [a, b].filter((x) => !x.ok && x.code === "head_moved").length;
  const late = await call();
  console.log("late edit on the old head:", JSON.stringify(late));
  const pass = landed === 1 && moved === 1 && !late.ok && late.code === "head_moved";
  console.log(pass ? "PASS: one edit landed, the other was refused head_moved, and the old head stays refused." : "FAIL");
  process.exit(pass ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
