import { ROLES, type RoleCode } from "../../lib/roles";

/** Fixed sim fixture identities, verified 2026-09-09. No runtime configuration. */
export const SIM_LOCATIONS = {
  EM: { code: "EM", name: "P Street", id: "d2cced11-b167-49fa-bab6-86ec9bf4ff09" },
  MEP: { code: "MEP", name: "Capitol Hill", id: "54ce1029-400e-4a92-9c2b-0ccb3b031f0a" },
} as const;
export type LocationCode = keyof typeof SIM_LOCATIONS;
export type SimPersona = Readonly<{
  email: string; name: string; role: RoleCode; level: number;
  language: "en" | "es"; locations: readonly LocationCode[];
}>;
function persona(first: string, name: string, role: RoleCode, language: "en" | "es", locations: LocationCode[]): SimPersona {
  return Object.freeze({ email: `${first}@sim.co-ops`, name, role, level: ROLES[role].level, language, locations: Object.freeze(locations) });
}
export const SIM_PERSONAS: readonly SimPersona[] = Object.freeze([
  persona("maya", "Maya Torres", "employee", "en", ["EM"]),
  persona("deshawn", "Deshawn Carter", "employee", "en", ["EM"]),
  persona("luis", "Luis Herrera", "employee", "es", ["MEP"]),
  persona("rosa", "Rosa Delgado", "key_holder", "es", ["EM"]),
  persona("angel", "Angel Reyes", "key_holder", "en", ["MEP"]),
  persona("tommy", "Tommy Nguyen", "shift_lead", "en", ["EM"]),
  persona("priya", "Priya Shah", "agm", "en", ["EM"]),
  persona("nicole", "Nicole Boyd", "agm", "en", ["MEP"]),
  persona("marcus", "Marcus Webb", "gm", "en", ["EM", "MEP"]),
]);
function exactlyOne(matches: readonly SimPersona[], label: string): SimPersona {
  if (matches.length !== 1 || !matches[0]) throw new Error(`${label}: expected exactly one persona`);
  return matches[0];
}
export function personaByEmail(email: string, roster = SIM_PERSONAS): SimPersona {
  return exactlyOne(roster.filter(p => p.email === email), email);
}
export function personaFor({ locationCode, role, name }: { locationCode: LocationCode; role: RoleCode; name: string }, roster = SIM_PERSONAS): SimPersona {
  return exactlyOne(roster.filter(p => p.name === name && p.role === role && p.locations.includes(locationCode)), `${name} / ${role} / ${locationCode}`);
}
export function expectedMemberships() {
  return SIM_PERSONAS.flatMap(p => p.locations.map(code => ({ email: p.email, location_id: SIM_LOCATIONS[code].id, active: true as const })));
}

/** Non-secret readback contract, shared by the seed and the driver. */
export function assertPersonaRow(persona: SimPersona, row: { id: string; email: string; name: string; role: string; active: boolean; language: string }, memberships: readonly { location_id: string; active: boolean }[]): void {
  const fail = (field: string): never => { throw new Error(`${persona.email}: ${field} mismatch; full fixture restore required`); };
  if (!row.id) fail("id");
  for (const field of ["email", "name", "role", "language"] as const) if (row[field] !== persona[field]) fail(field);
  if (row.active !== true) fail("active");
  const expected = persona.locations.map(code => SIM_LOCATIONS[code].id).sort();
  const actual = memberships.filter(m => m.active === true).map(m => m.location_id).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("user_locations");
}
