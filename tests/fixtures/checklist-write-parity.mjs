/** One generated case table consumed by Vitest and the offline PGlite harness.
 * Role values deliberately pin the LIVE dump, independently of lib/roles.ts. */
export const PARITY_ROLES = { cgs: 10, owner: 9, moo: 8, gm: 7, agm: 6,
  catering_mgr: 6, prep_mgr: 6, social_media_mgr: 6, shift_lead: 5,
  key_holder: 4, trainer: 4, employee: 3, trainee: 2, hired_not_yet_worked: 1, prospect: 0 };

export const CHECKLIST_PARITY_CASES = [];
function add(input) {
  const c = { member: true, membershipActive: true, active: true, sessionState: "valid", status: "open",
    templateType: "closing", itemMinRoleLevel: 3, itemActive: true,
    itemMatchesTemplate: true, reportReferenceType: null,
    refTrackItemCompletion: false, referencesTemplateItemId: null, ...input };
  const knownRole = Object.hasOwn(PARITY_ROLES, c.role);
  const level = knownRole ? PARITY_ROLES[c.role] : 0;
  const valid = c.sessionState === "valid";
  const liveMember = valid && c.active && c.member;
  const member = liveMember && c.membershipActive;
  const open = member && c.status === "open";
  CHECKLIST_PARITY_CASES.push({ ...c, id: `parity-${CHECKLIST_PARITY_CASES.length}`, level,
    expected: { completion: knownRole && open && level >= c.itemMinRoleLevel,
      liveCompletion: liveMember && c.status === "open" && level >= c.itemMinRoleLevel,
      submission: knownRole && open, confirm: open && level >= 3,
      instanceCreate: member && level >= (["opening", "prep"].includes(c.templateType) ? 4 : 3),
      liveInstanceCreate: liveMember && level >= (["opening", "prep"].includes(c.templateType) ? 4 : 3),
      // The old submission/reason policy did not even reference role/active.
      liveSubmission: valid,
      liveInstanceUpdate: liveMember && level >= 3 } });
}
for (const role of Object.keys(PARITY_ROLES)) {
  for (const member of [true, false]) for (const active of [true, false])
    for (const membershipActive of [true, false])
    for (const sessionState of ["valid", "revoked", "expired", "mismatch", "missing"])
      for (const status of ["open", "confirmed", "incomplete_confirmed"])
        add({ role, member, membershipActive, active, sessionState, status });
  for (const templateType of ["opening", "prep", "closing", "mid_day", "deep_cleaning"])
    for (const itemMinRoleLevel of [0, 3, 4, 11])
      for (const itemActive of [true, false]) for (const report of [true, false])
        for (const tracked of [true, false]) add({ role, templateType, itemMinRoleLevel,
          itemActive, reportReferenceType: report ? "cash_report" : null,
          refTrackItemCompletion: tracked, referencesTemplateItemId: tracked ? "reference" : null });
}

// Exercise every integer floor for every role, including the live helper's
// unknown-role fallback (0), which the verified app actor deliberately refuses.
for (const role of [...Object.keys(PARITY_ROLES), "unknown_role"])
  for (let itemMinRoleLevel = 0; itemMinRoleLevel <= 11; itemMinRoleLevel++)
    add({ role, itemMinRoleLevel });

export function actorForParityCase(c) {
  return c.sessionState !== "valid" || !Object.hasOwn(PARITY_ROLES, c.role) ? null : {
    userId: "actor", level: c.level, active: c.active,
    locations: c.member && c.membershipActive ? ["location"] : [],
  };
}
export function contextForParityCase(c) { return { ...c, locationId: "location" }; }
