/**
 * REGISTER the demand-signal sources (item 4 PR 2) through 0343's `demand_source_register`.
 *
 *   npx tsx --env-file=.env.local scripts/seed-demand-sources.ts            # dry run: what would be registered
 *   npx tsx --env-file=.env.local scripts/seed-demand-sources.ts --apply    # register (CC: sim first, then prod)
 *
 * What it registers: every source in docs/seed/demand-sources-dc-2026-11-18.json (tenant DATA: the free DC
 * sources researched on 2026-11-18, with the terms page read and a short quote, or "unverified") plus the NWS
 * definition that lives beside its adapter (lib/demand-signals/nws-shared.ts).
 *
 * WHAT IT CANNOT DO: mark anything verified. A registered source is `unverified`, and stays so until a MoO+
 * marks it through POST /api/admin/demand-signals/sources/mark (Tier B, audited who and when). This script
 * calls two functions and writes no table: `demand_source_states` (read) and `demand_source_register`.
 * Re-running registers nothing that is unchanged; a changed definition becomes the source's current one and
 * is unverified again (that is the design: a changed endpoint or terms needs a person to look again).
 *
 * A SCRIPT-LOCAL client from the environment (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY): it never
 * imports lib/supabase-server. Exit 0 = dry run printed, or applied; 1 = a definition was refused; 2 = could not run.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { NWS_SOURCE } from "../lib/demand-signals/nws-shared";
import { definitionAddress, definitionProblem, type SourceDefinition } from "../lib/demand-signals/sources-shared";

export const SEED_FILE = "docs/seed/demand-sources-dc-2026-11-18.json";

export function parseSeedArgs(argv: readonly string[]): { apply: boolean } | { error: string } {
  const out = { apply: false };
  for (const a of argv) {
    if (a === "--apply") out.apply = true;
    else return { error: `unknown argument ${a}` };
  }
  return out;
}

/** Every definition to register: the adapter's own (NWS) first, then the seed file, in file order. */
export function seedDefinitions(): SourceDefinition[] {
  const file = JSON.parse(readFileSync(SEED_FILE, "utf8")) as { sources: SourceDefinition[] };
  return [NWS_SOURCE, ...file.sources];
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseSeedArgs(argv);
  if ("error" in args) { console.error(args.error); return 2; }
  const definitions = seedDefinitions();
  const problems = definitions.map((d) => [d.sourceId, definitionProblem(d)] as const).filter(([, p]) => p !== null);
  if (problems.length) { for (const [id, p] of problems) console.error(`${id}: ${p}`); console.error("Nothing was read or written."); return 1; }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (e.g. npx tsx --env-file=.env.local ...). Nothing was read.");
    return 2;
  }
  const sb = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const current = await sb.rpc("demand_source_states");
  if (current.error) { console.error(`demand_source_states (is 0343 applied?): ${current.error.message}`); return 2; }
  const live = new Map(((current.data ?? []) as Array<{ source_id: string; definition_hash: string; status: string }>).map((r) => [r.source_id, r]));
  let refused = 0;
  for (const d of definitions) {
    const { hash, text } = definitionAddress(d);
    const now = live.get(d.sourceId);
    const plan = !now ? "register" : now.definition_hash === hash ? "unchanged" : `REDEFINE (now ${now.status}; becomes unverified)`;
    if (!args.apply || plan === "unchanged") { console.log(`${plan.padEnd(12)} ${d.sourceId.padEnd(32)} gate=${d.gate} terms=${d.termsStatus}`); continue; }
    const res = await sb.rpc("demand_source_register", { p_definition: text });
    if (res.error) { refused += 1; console.error(`REFUSED      ${d.sourceId}: ${res.error.message}`); continue; }
    console.log(`${String((res.data as { result: string }).result).padEnd(12)} ${d.sourceId.padEnd(32)} gate=${d.gate} terms=${d.termsStatus}`);
  }
  console.log(args.apply ? `Applied. Every registered source is unverified until a MoO+ marks it.` : `Dry run: nothing was written. Add --apply (CC: sim first, then prod).`);
  return refused ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(2); });
}
