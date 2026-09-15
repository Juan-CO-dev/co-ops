/**
 * access-shared — who sees which guide, and which one opens first.
 *
 * PURE (the `*-shared.ts` pattern): the page runs it on the server to decide
 * what to load, and it is testable without a session. lib/roles.ts is itself a
 * pure registry, so importing it here keeps this module client-safe.
 *
 * THE FLOORS ARE THE JOB, NOT THE SECRET. A guide is a manual, not data — the
 * gate is "is this written for you", not "may you see this". Someone on the line
 * gets the staff guide; a key holder and up also gets the manager guide, because
 * a key holder confirms closings and receives deliveries; level 6 and up (AGM,
 * catering manager, prep manager, GM, MoO, owner) also gets the catering guide,
 * which matches the catering surfaces' own floor (reading the pipeline is shift
 * lead and up, but AUTHORING — the whole subject of that guide — is AGM and up).
 *
 * Levels 0–1 (prospect, hired-not-yet-worked) are below every floor and see the
 * empty note. That is deliberate: they have not worked a shift, so no guide is
 * written for them yet.
 */

import { getRoleLevel, type RoleCode } from "@/lib/roles";

import { GUIDE_SLUGS, isGuideSlug, type GuideSlug } from "./markdown-shared";

/** Minimum role level that sees each guide. */
export const GUIDE_MIN_LEVEL: Record<GuideSlug, number> = {
  staff: 2,
  manager: 4,
  catering: 6,
};

/** The guides this level may read, in reading order (staff → manager → catering). */
export function guidesForLevel(level: number): GuideSlug[] {
  return GUIDE_SLUGS.filter((slug) => level >= GUIDE_MIN_LEVEL[slug]);
}

/**
 * The tab that opens first: the highest guide that matches the person's own job.
 *
 * The catering manager is the one role whose job IS the catering guide, so they
 * land there rather than on the manager guide they also hold. Everyone else at
 * key-holder and up lands on the manager guide; everyone else on staff. The
 * result is always clamped to what the person can actually see.
 */
export function defaultGuideFor(role: RoleCode, available: readonly GuideSlug[]): GuideSlug | null {
  if (available.length === 0) return null;
  const level = getRoleLevel(role);
  const wanted: GuideSlug = role === "catering_mgr" ? "catering" : level >= 4 ? "manager" : "staff";
  return available.includes(wanted) ? wanted : (available[available.length - 1] ?? null);
}

/**
 * `?guide=` wins when it names a guide this person may read — that is what makes
 * a section link a manager sends ("/training?guide=manager#receiving-a-delivery")
 * land where they meant. An unknown or out-of-reach value falls back to the
 * default rather than erroring: a bad link should open the page, not break it.
 */
export function resolveInitialGuide(
  role: RoleCode,
  available: readonly GuideSlug[],
  requested: string | undefined,
): GuideSlug | null {
  if (requested && isGuideSlug(requested) && available.includes(requested)) return requested;
  return defaultGuideFor(role, available);
}
