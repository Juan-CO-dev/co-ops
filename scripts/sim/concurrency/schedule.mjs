/**
 * FULL DIRECTED-CREW DAY — schedule + authority-baton model (sim-2, 2026-08-11).
 *
 * Juan's operational model: a busy day is 7am-8:30pm with 8-9 people, and
 * DIRECTED work — a manager assigns, workers execute. AUTHORITY passes down the
 * ladder as the day burns: GM/AGM open and leave early → SL carries midday →
 * a KH closes the store alone. The SEAMS (shift changes) are where two
 * authorities overlap and touches-per-instance peak — the hottest contention.
 *
 * Staggered station closing (Juan): Crunchy Boi ~1:30-2, 3rd Party ~3:30-4,
 * everything else near 8pm close. So the ONE closing instance is written by
 * different people across ~6.5 hours — the marquee multi-writer surface.
 *
 * The runner compresses this to time-BLOCKS; within a block, assigned crew act
 * concurrently. Each block names its authority-holder (the director) and the
 * seam overlaps.
 */

// Crew (the sim roster; PINs are sim-only). role → level.
export const CREW = {
  gm: { name: "Marcus Webb", pin: "9999", level: 7, both: true },
  agm_em: { name: "Priya Shah", pin: "7777", level: 6, loc: "EM" },
  agm_mep: { name: "Nicole Boyd", pin: "8888", level: 6, loc: "MEP" },
  sl_em: { name: "Tommy Nguyen", pin: "6666", level: 5, loc: "EM" },
  kh_em: { name: "Rosa Delgado", pin: "4444", level: 4, loc: "EM" },
  kh_mep: { name: "Angel Reyes", pin: "5555", level: 4, loc: "MEP" },
  emp_maya: { name: "Maya Torres", pin: "1111", level: 3, loc: "EM" },
  emp_deshawn: { name: "Deshawn Carter", pin: "2222", level: 3, loc: "EM" },
  emp_luis: { name: "Luis Herrera", pin: "3333", level: 3, loc: "MEP" },
};

// Time-blocks with the baton-holder (director) and who's concurrently active.
// The SEAM flag marks overlapping-authority handoffs (peak contention).
export const BLOCKS = [
  {
    id: "open", label: "07:00-09:00 open", director: "agm_em", seam: false,
    active: ["agm_em", "kh_em", "emp_maya", "emp_deshawn"],
    work: "opening verification (crew fills, KH/AGM confirms) + AM prep",
  },
  {
    id: "midmorning", label: "09:00-11:30 truck + order", director: "agm_em", seam: false,
    active: ["agm_em", "kh_em", "emp_maya", "emp_deshawn"],
    work: "receiving (truck) + ordering par-walk → draft; concurrent completions",
  },
  {
    id: "seam_midday", label: "11:30-12:30 AGM→SL handoff", director: "sl_em", seam: true,
    active: ["agm_em", "sl_em", "kh_em", "emp_maya"], // AGM overlaps out
    work: "SEAM: AGM finishing counts/place while SL takes over; mid-day prep starts",
  },
  {
    id: "crunchy_close", label: "13:30-14:00 Crunchy Boi closes", director: "sl_em", seam: false,
    active: ["sl_em", "kh_em", "emp_maya", "emp_deshawn"],
    work: "FIRST station close — multiple hands on the ONE closing instance",
  },
  {
    id: "thirdparty_close", label: "15:30-16:00 3rd Party closes", director: "sl_em", seam: false,
    active: ["sl_em", "kh_em", "emp_deshawn"],
    work: "SECOND station close on the same closing instance + PM report",
  },
  {
    id: "seam_evening", label: "16:00-17:00 SL→KH handoff", director: "kh_em", seam: true,
    active: ["sl_em", "kh_em"], // SL overlaps out; KH will close alone
    work: "SEAM: SL leaving, KH takes the close; reconcile (now SL+/KH-adjacent)",
  },
  {
    id: "close", label: "19:00-20:30 the close (KH alone)", director: "kh_em", seam: false,
    active: ["kh_em", "emp_maya", "emp_deshawn"],
    work: "final station closes on the closing instance → cash → walk-out → CONFIRM",
  },
];
