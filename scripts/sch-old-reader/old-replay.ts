/**
 * PR SCH (plan r5 20.9, ruling D9) — DEV ONLY, offline: run by scripts/sch-old-reader-check.mjs from a temp directory that
 * holds the PRE-SCH `lib` (git archive of the merge base). Its `@/lib/...` imports therefore resolve to the OLD code: the old
 * snapshot decoder, the old `checkScheduleRules` replay, the old `referenceStructureOf` and `structureDeltaHours`.
 * Usage: tsx old-replay.ts <snapshots.json> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { referenceStructureOf, structureDeltaHours } from "@/lib/scheduling/budget-shared";
import { canonicalJson, digest64, ruleContextFromSnapshot } from "@/lib/scheduling/context-shared";
import { checkScheduleRules } from "@/lib/scheduling/rules-shared";

type Case = {
  name: string; refDate: string; schedule: Parameters<typeof checkScheduleRules>[0]; stored: unknown;
  live: Parameters<typeof structureDeltaHours>[0]["live"]; needDay: Parameters<typeof structureDeltaHours>[0]["day"];
};
const cases = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as Case[];
const out = cases.map((c) => {
  const ctx = ruleContextFromSnapshot(c.stored);
  const day = ctx.days[c.refDate]!;
  const days = Object.fromEntries(Object.entries(ctx.days).filter(([d]) => d >= c.refDate));
  const ref = referenceStructureOf({ revision: { structureVersionId: day.structureVersionId }, context: { days } }, {})!;
  return { name: c.name, oldReplay: checkScheduleRules(c.schedule, ctx), oldRefDigest: digest64(canonicalJson(ref)), oldDelta: structureDeltaHours({ live: c.live, ref, day: c.needDay }) };
});
writeFileSync(process.argv[3]!, JSON.stringify(out));
