/** Explicit role membership; a level floor would admit other admin roles. */
export const MARKETING_SCORECARD_ROLES = ["moo", "owner", "cgs"] as const;
export const canReadMarketing = (role: string): boolean => MARKETING_SCORECARD_ROLES.some(value => value === role);
export const marketingTileVisible = (role: string, flag: string | undefined): boolean => flag === "1" && canReadMarketing(role);
