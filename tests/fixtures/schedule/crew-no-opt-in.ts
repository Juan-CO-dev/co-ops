import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/scheduling/context-shared";
import type { GeneratorInput, GeneratorOutput } from "@/lib/scheduling/generator/build-shared";
import { person } from "./fixtures";

export const crewInputs = new Map<string, GeneratorInput>();
export const replayCounts = { outputs: 0, refusals: 0 };
export const digest = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");

/** Keep all fixture variants, including seeded/property permutations and inherited heads. */
export function captureCrewInput(raw: GeneratorInput): void {
  const input = structuredClone(raw);
  for (const p of input.people) p.backupCover = false;
  // The weekly setting cannot affect a no-opt-in build; retain the pre-0286 input identity.
  delete input.structure.roster.backupCoverPerPersonWeek;
  // PR SCH: a head committed by SCH's code carries the context marker `cateringRule` (D9); the pre-SCH input identity has none.
  if (input.crew?.headContext) delete input.crew.headContext.cateringRule;
  for (const role of ["moo", "owner"] as const) {
    if (input.people.some((p) => p.role === role)) continue;
    const added = person({ id: `invariance-${role}`, role }, input.days.map((d) => d.date));
    added.workModes = Object.fromEntries(input.days.map((d) => [d.date, "works" as const]));
    input.people.push(added);
  }
  crewInputs.set(digest(input), input);
}

/**
 * PR SCH: the output as the pre-SCH code wrote it. SCH changes exactly two things in a no-opening crew output — the version
 * string (`crew.2`, was `crew.1`) and the new context marker `cateringRule` (ruling D9) — so mapping those two back must
 * reproduce the pinned bytes; anything else SCH changed would fail the pin.
 */
export function preSchView<T extends Pick<GeneratorOutput, "version" | "context">>(output: T): T {
  const out = structuredClone(output);
  if (out.version === "crew.2") out.version = "crew.1";
  else if (out.version === "p2.20") out.version = "p2.19";
  delete out.context.cateringRule;
  return out;
}

/** Exact complete output (in its pre-SCH view, `preSchView`), or the same named refusal for deliberately invalid fixtures. */
export function resultDigest(build: (input: GeneratorInput) => GeneratorOutput, input: GeneratorInput): string {
  try { const output = build(input); replayCounts.outputs++; return digest({ output: preSchView(output) }); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    replayCounts.refusals++;
    return digest({ error: Object.assign({ name: error.name, message: error.message }, error) });
  }
}
