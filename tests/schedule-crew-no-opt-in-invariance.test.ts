import { afterAll, expect, vi } from "vitest";
import type { GeneratorInput } from "@/lib/scheduling/generator/build-shared";
import baseline from "./fixtures/schedule/crew-no-opt-in-dc022f26.json";
import { captureCrewInput, crewInputs, replayCounts, resultDigest } from "./fixtures/schedule/crew-no-opt-in";

vi.mock("@/lib/scheduling/generator/crew-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scheduling/generator/crew-shared")>();
  return { ...actual, buildCrewWeek: (input: GeneratorInput) => {
    captureCrewInput(input);
    return actual.buildCrewWeek(input);
  } };
});

// Reuse the actual fixture factories, including every seeded/random property case.
// Capture only during these tests; replay after their spies have been restored.
import "./schedule-crew-generator.test";
import "./schedule-crew-integration.test";
import "./schedule-crew-acceptance.test";
import "./schedule-inputs.test";
import "./schedule-backup-cover.test";

afterAll(async () => {
  vi.restoreAllMocks();
  const actual = await vi.importActual<typeof import("@/lib/scheduling/generator/crew-shared")>("@/lib/scheduling/generator/crew-shared");
  const expected: Record<string, string> = baseline.hashes;
  expect([...crewInputs.keys()].sort(), "Every current crew fixture must have a dc022f26 baseline").toEqual(Object.keys(expected).sort());
  for (const [id, input] of crewInputs) {
    expect(resultDigest(actual.buildCrewWeek, input), `no-opt-in fixture ${id}`).toBe(expected[id]);
  }
  process.stdout.write(`No-opt-in invariance: ${crewInputs.size} unique crew inputs match ${baseline.commit} (${replayCounts.outputs} outputs, ${replayCounts.refusals} refusals).\n`);
}, 180000);
