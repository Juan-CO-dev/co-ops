import { scheduleEngine } from "../structure-shared";
import { buildWeek, type GeneratorInput, type GeneratorOutput } from "./build-shared";
import { buildCrewWeek } from "./crew-shared";

/** Pure dispatch only. The persistence entry points switch in chunk 6. */
export function generateWeek(input: GeneratorInput): GeneratorOutput {
  return scheduleEngine(input.structure) === "crew" ? buildCrewWeek(input) : buildWeek(input);
}
