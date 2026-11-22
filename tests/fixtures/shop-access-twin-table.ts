/**
 * The all-shops role set AS DATA (all-shops access plan r15, PR 1): role x surface -> "holds every active shop".
 *
 * Written out cell by cell on purpose, so a change to lib/shop-access-shared.ts cannot pass by re-deriving itself.
 * tests/shop-access-twin.test.ts pins `holdsAllShops` to this table today; PR 2's tests/all-shops-migration.test.ts
 * pins the SQL twin `public.all_shops_role(role, surface)` to the same table, so TS = table = SQL at every PR.
 *
 * Editing a cell is a ruling (plan section 6): PR 5 flips catering_mgr x tasks, PR 8 adds the `schedule` surface. Each
 * such PR changes this table, the TS module and the SQL function together.
 */
export const ALL_SHOPS_TWIN_TABLE = {
  cgs:                  { ops: true,  tasks: true,  catering: true,  report_read: true },
  owner:                { ops: true,  tasks: true,  catering: true,  report_read: true },
  moo:                  { ops: true,  tasks: true,  catering: true,  report_read: true },
  gm:                   { ops: false, tasks: false, catering: false, report_read: false },
  agm:                  { ops: false, tasks: false, catering: false, report_read: false },
  catering_mgr:         { ops: false, tasks: false, catering: true,  report_read: false },
  prep_mgr:             { ops: false, tasks: false, catering: false, report_read: false },
  social_media_mgr:     { ops: false, tasks: false, catering: false, report_read: false },
  shift_lead:           { ops: false, tasks: false, catering: false, report_read: false },
  key_holder:           { ops: false, tasks: false, catering: false, report_read: false },
  trainer:              { ops: false, tasks: false, catering: false, report_read: false },
  employee:             { ops: false, tasks: false, catering: false, report_read: false },
  trainee:              { ops: false, tasks: false, catering: false, report_read: false },
  hired_not_yet_worked: { ops: false, tasks: false, catering: false, report_read: false },
  prospect:             { ops: false, tasks: false, catering: false, report_read: false },
} as const;
