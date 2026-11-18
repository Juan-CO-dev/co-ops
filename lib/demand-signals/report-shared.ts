/**
 * Demand signals (item 4 PR 1): the report Juan reads. Pure text from a `ReplayReport`.
 *
 * It OPENS with how each number is computed today (the smart-scheduling spec, section 11: "First step: write
 * up exactly how depletion and dynamic pars are computed today so Juan can examine and refine it"). The
 * figures in that walkthrough are read from the code's own constants, so the text cannot drift from the engine.
 * English only: it is a script artifact for the owner, not an app surface.
 */
import { CUSHION_BY_CLASS, CUSHION_DEFAULT, DYNAMIC_PARS } from "@/lib/dynamic-pars-shared";
import { SCHEDULE_STRUCTURE_DEFAULTS } from "@/lib/scheduling/structure-shared";
import type { CandidateKey, ReplayReport } from "./backtest";
import { SIGNAL_BOUNDS } from "./candidates-shared";
import { TARGET_FREEZE_LAG_DAYS } from "./ledger-shared";
import { PASS_RULE, type DemandTarget, type QualificationFailure, type ShopScore } from "./scoring-shared";

const DASH = "—";
const pct = (v: number | null | undefined, digits = 1): string => (v === null || v === undefined || !Number.isFinite(v) ? DASH : `${(v * 100).toFixed(digits)}%`);
const signed = (v: number | null): string => (v === null ? DASH : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const whole = (v: number): string => Math.round(v).toLocaleString("en-US");
const dollars = (cents: number): string => `$${whole(cents / 100)}`;
const row = (cells: ReadonlyArray<string | number>): string => `| ${cells.join(" | ")} |`;
const table = (head: string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): string[] => [row(head), row(head.map(() => "---")), ...rows.map(row), ""];

const TARGET_LABEL: Record<DemandTarget, string> = {
  labor_day_cents: "Sales for the day (dollars)", labor_hour_cents: "Sales by hour (dollars)",
  par_product_day_oz: "Use per product per day (ounces)", prep_item_day_units: "Prep use per item per day (par units)",
};
const CANDIDATE_LABEL: Record<CandidateKey, string> = { trend: "Trend (last 7 days against the 7 before)", calendar_holiday: "Federal holidays (calendar)" };
const FAILURE_LABEL: Record<QualificationFailure, string> = {
  evidence_not_e2: "retrospective evidence only", holdout_missing: "no holdout read", score_undefined: "no score",
  gain_below_min: "gain under 5%", bootstrap_lower_not_above_zero: "gain not reliably above zero", shop_worse: "one shop got worse",
  bias_worse: "bias got worse", sign_mismatch: "development and holdout disagree", episodes_below_min: "fewer than 8 episodes",
};

function walkthrough(): string[] {
  const p = DYNAMIC_PARS;
  const cushions = Object.entries(CUSHION_BY_CLASS).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(", ");
  const t = SCHEDULE_STRUCTURE_DEFAULTS.dayTypes;
  return [
    "## 1. How each number is computed today",
    "",
    "### Ordering pars (Dynamic Pars v1, running in shadow)",
    "",
    "Shadow means it works out a suggestion every night and writes it to a ledger. It does not change a par.",
    "",
    `1. **Use.** For each par'd product at each shop it reads the last ${p.BASE_WINDOW_DAYS} days of use: ounces sold directly plus ounces used in production. Two vendors' versions of one product are added together.`,
    "2. **Two kinds of day.** Mon to Thu are weekday days. Fri, Sat and Sun are weekend days. Each kind gets its own average ounces per day.",
    `3. **Missing days.** A day with no data from the shop is left out. A day the register ran and the product did not sell counts as zero. With fewer than ${p.MIN_OBSERVED_DAYS.weekday} weekday days or ${p.MIN_OBSERVED_DAYS.weekend} weekend days it gives no number and says "thin history".`,
    `4. **Momentum.** If the last ${p.VELOCITY_MIN_PERSISTENCE_DAYS} days all ran more than ${Math.round(p.VELOCITY_DEADBAND * 100)}% above (or all below) the average, the rate moves the same way, by at most ${Math.round(p.VELOCITY_CAP * 100)}%.`,
    "5. **Days to cover.** It adds the daily rate for every day the order has to last: from the walk until the truck after the next one.",
    `6. **Cushion.** It adds a margin by product class (${cushions}; ${Math.round(CUSHION_DEFAULT * 100)}% when the class is not set).`,
    "7. **Peak floor.** The result is never below the busiest comparable stretch the shop actually had in the window. Comparable means like-for-like: the same number of days in a row, with the same count of weekend days. A stretch that crosses a missing day is not used.",
    `8. **Rounding and guards.** The result is rounded to the par's step. A target under ${Math.round(p.UNIT_SUSPECT_LOW * 100)}% or over ${Math.round(p.UNIT_SUSPECT_HIGH * 100)}% of the standing par is treated as a unit problem and gives no number. A move bigger than ${Math.round(p.BAND_PCT * 100)}% of the par (or one step) is only ever a suggestion. Two nights in a row must agree on the direction. One machine move per par per ${p.BUDGET_WINDOW_DAYS} days. A manager's revert pins the par.`,
    "",
    "### Labor (the schedule's sales forecast)",
    "",
    "1. **The forecast.** For a future date it is the average of the same weekday over the 28 days before the schedule is built, hour by hour, from Toast check totals by the hour the check was opened.",
    "2. **Nothing else.** No trend, holiday, event or weather adjustment. Booked catering is named on the day and not added.",
    `3. **Day type.** The manager's choice for a date wins. Otherwise the shop's weekend days are "weekend". Otherwise the day is slow under ${dollars(t.slowBelowCents)}, busy over ${dollars(t.busyAboveCents)} and normal in between (each shop can change both amounts).`,
    "4. **Thin.** With two or fewer captured weeks of that weekday the forecast is marked thin.",
    "",
    "### Prep pars",
    "",
    "A prep par is a fixed number: the shop's manual par for that day of the week when one is set, otherwise the item's default par. Nothing is computed from sales.",
    "",
  ];
}

function evidenceSection(r: ReplayReport): string[] {
  return [
    "## 2. What this report can and cannot do",
    "",
    ...table(["Kind of evidence", "What it means", "What it can unlock"], [
      ["Hindsight (E0)", "Uses something nobody knew on the day (the weather that actually happened)", "Nothing"],
      ["Retrospective (E1)", "Knowable in advance, but tested on today's copy of old data", "Shown on the page, labelled"],
      ["Point-in-time (E2)", "Forecast recorded on the day, from inputs stored on the day, against a result frozen 4 days later", "A suggestion a manager can act on"],
    ]),
    `**Everything in this report is retrospective (E1).** It cannot turn anything on. Old orders, pars and settings are read as they are now, not as they were on the day.`,
    "",
    `Point-in-time evidence starts the night the forecast ledger is switched on, and a result only counts once it has been frozen ${TARGET_FREEZE_LAG_DAYS} days after the date. Expect months before any outside signal can qualify.`,
    "",
    `Period: ${r.from} to ${r.to}. Shops: ${r.shops.map((s) => s.name).join(", ")}. Nights replayed: ${r.counts.parNights} for pars, ${r.counts.laborDays} for labor, ${r.counts.prepDays} for prep.`,
    "",
  ];
}

function baselineSection(r: ReplayReport): string[] {
  const out = [
    "## 3. How far off today's numbers are",
    "",
    "WAPE is the total miss divided by the total that really happened: 10% means the forecasts, added up, were off by a tenth. Bias shows the direction: negative means the forecasts ran low. Lead is how many days ahead the forecast was made (0 is the same morning).",
    "",
    "A day with no captured data is left out and counted in the last column. It is never scored as zero.",
    "",
  ];
  const name = new Map(r.shops.map((s) => [s.id, s.name]));
  for (const target of ["labor_day_cents", "labor_hour_cents", "par_product_day_oz", "prep_item_day_units"] as const) {
    const lines = r.baselines.filter((b) => b.scope.target === target).sort((a, b) => a.scope.leadDays - b.scope.leadDays);
    out.push(`### ${TARGET_LABEL[target]}`, "");
    if (lines.length === 0) {
      out.push(target === "prep_item_day_units"
        ? "No score yet: there is no reviewed reading of how much of a prep item was used in a day. The prep pars themselves are recorded from the first night."
        : "No rows in this period.", "");
      continue;
    }
    const rows: Array<Array<string | number>> = [];
    for (const b of lines) {
      const line = (label: string, s: ShopScore, left: string) => [b.scope.leadDays, label, pct(s.baseline.wape), signed(s.baseline.bias), s.n, left];
      rows.push(line("All", b.result, String(b.result.excluded.missingActual)));
      if (target !== "labor_hour_cents") for (const [shopId, s] of Object.entries(b.result.byShop)) rows.push(line(name.get(shopId) ?? shopId, s, ""));
    }
    out.push(...table(["Lead", "Shop", "WAPE", "Bias", "Rows", "Left out (no data)"], rows));
  }
  if (r.classCalls.length > 0) {
    out.push("### The slow / normal / busy call", "",
      "How often the forecast put a day in the class it turned out to be. Weekend days are their own class. Days the manager set by hand are not counted.", "",
      ...table(["Lead", "Days", "Right", "Share right"], r.classCalls.map((c) => [c.leadDays, c.n, c.correct, pct(c.value, 0)])));
  }
  return out;
}

function candidateSection(r: ReplayReport): string[] {
  const out = [
    "## 4. Two signals that need no outside feed",
    "",
    "Each signal is tried on top of today's number and nothing else changes. A signal can move a forecast by at most "
      + `${Math.round((SIGNAL_BOUNDS.perSignal[1] - 1) * 100)}% either way, and it can never take a par below its peak floor or past a guard.`,
    "",
    "To be allowed to act, a signal must clear every one of these, for one target at one lead, on point-in-time evidence:",
    "",
    `- at least ${Math.round(PASS_RULE.minRelGain * 100)}% lower WAPE`,
    "- the gain holds when whole weeks are resampled (the low bound is above zero)",
    `- neither shop more than ${Math.round(PASS_RULE.shopMaxRelLoss * 100)}% worse`,
    "- bias no further from zero",
    "- the same direction on the development weeks and on the held-back weeks",
    `- at least ${PASS_RULE.minEpisodes} separate episodes (several days of one event count once)`,
    "",
    "A pass at one lead says nothing about another lead. Dollars and ounces are never added together.",
    "",
  ];
  for (const surface of ["labor", "pars"] as const) {
    for (const candidate of ["trend", "calendar_holiday"] as const) {
      for (const target of ["labor_day_cents", "labor_hour_cents", "par_product_day_oz"] as const) {
        const lines = r.candidates.filter((c) => c.surface === surface && c.candidate === candidate && c.scope.target === target).sort((a, b) => a.scope.leadDays - b.scope.leadDays);
        if (lines.length === 0) continue;
        out.push(`### ${CANDIDATE_LABEL[candidate]}: ${TARGET_LABEL[target]}`, "");
        out.push(...table(["Lead", "Today", "With the signal", "Gain", "Low bound", "Episodes", "Result"], lines.map((c) => [
          c.scope.leadDays, pct(c.result.baseline.wape), pct(c.result.candidate.wape), signed(c.result.relGain), signed(c.result.bootstrapLower), c.result.episodes,
          `Shown only: ${c.qualification.failures.map((f) => FAILURE_LABEL[f]).join("; ")}`,
        ])));
      }
    }
  }
  out.push("Prep has no engine, so there is no signal to try on it. It gets the baseline score above only.", "");
  return out;
}

function coverageSection(r: ReplayReport): string[] {
  const name = new Map(r.shops.map((s) => [s.id, s.name]));
  const arm = (a: "baseline" | CandidateKey) => (a === "baseline" ? "Today" : CANDIDATE_LABEL[a]);
  return [
    "## 5. Par coverage, simulated",
    "",
    "For each par the engine spoke for: the ounces it would have covered against the ounces actually used over the days that order had to last. Short is use above the cover. Over is cover above the use. This is a simulation from recorded use. It is not a count of times a shop ran out.",
    "",
    ...table(["Shop", "Number", "Pars checked", "Left out", "Used (oz)", "Short (oz)", "Over (oz)"],
      r.coverage.map((c) => [name.get(c.shopId) ?? c.shopId, arm(c.arm), c.units, c.skippedUnits, whole(c.actualOz), whole(c.shortfallOz), whole(c.overCoverOz)])),
  ];
}

function leftOutSection(r: ReplayReport): string[] {
  const reasons = Object.entries(r.silentPars).sort((a, b) => b[1] - a[1]);
  return [
    "## 6. Pars the engine did not speak for",
    "",
    "These got no suggestion on a replayed night, so they are not in the scores above. Counts are par slots times nights.",
    "",
    ...(reasons.length === 0 ? ["None.", ""] : table(["Reason", "Count"], reasons.map(([k, n]) => [k.replace(/_/g, " "), n]))),
  ];
}

/** The whole report as Markdown. */
export function renderReplayReport(r: ReplayReport): string {
  return [
    "# Demand signals: how today's numbers are made, and how far off they are",
    "",
    ...walkthrough(), ...evidenceSection(r), ...baselineSection(r), ...candidateSection(r), ...coverageSection(r), ...leftOutSection(r),
  ].join("\n");
}
