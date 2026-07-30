/**
 * One-shot backfill of toast_daily_depletion for the banked sales days (drift
 * spec 2026-07-31, adversarial B1). Loads .env.local itself, then runs
 * materializeDailyDepletion (idempotent delete-day + insert) for every ACTIVE
 * location × each date in the range. Run with the react-server condition so the
 * lib's `server-only` guard resolves:
 *   npx tsx --conditions=react-server scripts/backfill-toast-depletion.ts 2026-07-23 2026-07-30
 */
import { readFileSync } from "node:fs";

// Env BEFORE lib imports (dynamic import below) — dotenv isn't installed.
for (const line of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line);
  if (m && m[1] && m[2] !== undefined && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const [fromArg, toArg] = process.argv.slice(2);
if (!fromArg || !toArg || !/^\d{4}-\d{2}-\d{2}$/.test(fromArg) || !/^\d{4}-\d{2}-\d{2}$/.test(toArg)) {
  console.error("Usage: npx tsx --conditions=react-server scripts/backfill-toast-depletion.ts <from YYYY-MM-DD> <to YYYY-MM-DD>");
  process.exit(1);
}

function* dates(from: string, to: string): Generator<string> {
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

async function main() {
  const { materializeDailyDepletion } = await import("@/lib/catering/toast-sales");
  const { getServiceRoleClient } = await import("@/lib/supabase-server");
  const sb = getServiceRoleClient();
  const { data: locs, error } = await sb.from("locations").select("id, name").eq("active", true)
    .returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`locations: ${error.message}`);

  for (const date of dates(fromArg!, toArg!)) {
    for (const loc of locs ?? []) {
      try {
        const { rows } = await materializeDailyDepletion(loc.id, date);
        console.log(`${date}  ${loc.name.padEnd(14)} rows=${rows}`);
      } catch (e) {
        console.log(`${date}  ${loc.name.padEnd(14)} FAILED: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
