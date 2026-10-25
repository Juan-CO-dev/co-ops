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
  for (const role of ["moo", "owner"] as const) {
    if (input.people.some((p) => p.role === role)) continue;
    const added = person({ id: `invariance-${role}`, role }, input.days.map((d) => d.date));
    added.workModes = Object.fromEntries(input.days.map((d) => [d.date, "works" as const]));
    input.people.push(added);
  }
  crewInputs.set(digest(input), input);
}

/** Exact complete output, or the same named refusal for deliberately invalid fixtures. */
export function resultDigest(build: (input: GeneratorInput) => GeneratorOutput, input: GeneratorInput): string {
  try { const output = build(input); replayCounts.outputs++; return digest({ output }); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    replayCounts.refusals++;
    return digest({ error: Object.assign({ name: error.name, message: error.message }, error) });
  }
}
