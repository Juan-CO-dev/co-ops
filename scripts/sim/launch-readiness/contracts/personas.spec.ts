/** F4-only integration contracts. Importing this skeleton performs no I/O. */
// TODO: seed twice; identical full user/membership readback and persona-to-id map.
export async function seedTwiceHasIdenticalReadback(): Promise<void> {
  throw new Error("F4 runner required");
}
// TODO: exactly nine active baseline users, exact roles/languages/locations,
// ten active memberships, no extra active memberships.
export async function exactBaselineRoster(): Promise<void> {
  throw new Error("F4 runner required");
}
// TODO: inactive/missing membership fixture refused BEFORE any seed mutation.
export async function inactiveMembershipRefusedBeforeMutation(): Promise<void> {
  throw new Error("F4 runner required");
}
// TODO: real PIN login for all nine; password path where ROLES permits it.
// Compare authenticated claims and DB session identity, report only booleans.
export async function authenticatedIdentityMatchesRoster(): Promise<void> {
  throw new Error("F4 runner required");
}
