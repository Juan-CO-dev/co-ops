/**
 * Scheduling Phase 1 — THE PEOPLE-LAYER EQUIVALENCE FIXTURE (plan Task 1, Step 1).
 *
 * Synthetic rows only. Two shops, LOC_A and LOC_B, by id (never by code). A deterministic
 * seeded generator (no Math.random) builds 70 days of checklist work, so the fixture is the
 * same on every machine and every run.
 *
 * What it carries, and why:
 *   · one person (SL) active at BOTH shops, with oversight rows at each shop — the 2026-08-29
 *     location bind must keep their acts apart;
 *   · every rank the loaders treat differently: employee, trainer, KH, SL, AGM, GM, social media
 *     manager, MoO, owner; plus a DEACTIVATED user and a user whose MEMBERSHIP is inactive;
 *   · checklist instances across 70 days, a few dated BEFORE the window with completions inside
 *     it; completions with duplicates per (instance, item), superseded, revoked, notes and blank
 *     notes; on-day and off-day finalizations; cash reports (signed, superseded, over/short notes);
 *     PM reports in every status (one superseded), MVPs, evals with all three gradients plus
 *     superseded evals; audit rows for all five oversight actions, including one row that cannot
 *     be placed at any shop;
 *   · rows in tables today's loaders NEVER read (station_events, pm_report_copies, pm_copy_grades,
 *     people_skill_adjustments) so Task 23 can prove "switch off ⇒ identical" over a database that
 *     already holds the new facts.
 */

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export const LOC_A = "a0000000-0000-4000-8000-00000000000a";
export const LOC_B = "b0000000-0000-4000-8000-00000000000b";
export const TODAY = "2026-10-14";

export const U = {
  emp: "10000000-0000-4000-8000-000000000001",
  trainer: "10000000-0000-4000-8000-000000000002",
  kh: "10000000-0000-4000-8000-000000000003",
  slBoth: "10000000-0000-4000-8000-000000000004",
  agm: "10000000-0000-4000-8000-000000000005",
  gm: "10000000-0000-4000-8000-000000000006",
  smm: "10000000-0000-4000-8000-000000000007",
  moo: "10000000-0000-4000-8000-000000000008",
  owner: "10000000-0000-4000-8000-000000000009",
  empB: "10000000-0000-4000-8000-000000000010",
  gmB: "10000000-0000-4000-8000-000000000011",
  deactivated: "10000000-0000-4000-8000-000000000012",
  inactiveMember: "10000000-0000-4000-8000-000000000013",
} as const;

/** Every user id in the fixture, in a fixed order (the harness iterates it). */
export const ALL_USERS: readonly string[] = Object.values(U);

/** mulberry32 — a tiny seeded PRNG so the fixture is identical everywhere. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(yyyymmdd: string, n: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A UTC instant on `date` at `hh:mm` UTC (16:00Z is noon ET in EDT). */
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00Z`;
const pad = (n: number, w = 6) => String(n).padStart(w, "0");

export function buildPeopleLayerFixture(): Tables {
  const r = rng(20261015);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

  const locations: Row[] = [
    { id: LOC_A, code: "SA", name: "Shop A", active: true },
    { id: LOC_B, code: "SB", name: "Shop B", active: true },
  ];

  const users: Row[] = [
    { id: U.emp, name: "Ana Employee", role: "employee", active: true, created_at: "2026-03-01T14:00:00Z", email: null, phone: null, profile_blurb: null },
    { id: U.trainer, name: "Beto Trainer", role: "trainer", active: true, created_at: "2025-11-12T14:00:00Z", email: null, phone: null, profile_blurb: null },
    { id: U.kh, name: "Cata Keyholder", role: "key_holder", active: true, created_at: "2025-06-20T14:00:00Z", email: null, phone: null, profile_blurb: null },
    { id: U.slBoth, name: "Dani Shiftlead", role: "shift_lead", active: true, created_at: "2025-01-05T14:00:00Z", email: null, phone: null, profile_blurb: "Works both shops." },
    { id: U.agm, name: "Eli Assistant", role: "agm", active: true, created_at: "2024-09-01T14:00:00Z", email: "eli@example.test", phone: "+15550000005", profile_blurb: "AGM blurb." },
    { id: U.gm, name: "Fer General", role: "gm", active: true, created_at: "2024-02-01T14:00:00Z", email: "fer@example.test", phone: "+15550000006", profile_blurb: "GM blurb." },
    { id: U.smm, name: "Gabi Social", role: "social_media_mgr", active: true, created_at: "2025-08-01T14:00:00Z", email: "gabi@example.test", phone: null, profile_blurb: "Social blurb." },
    { id: U.moo, name: "Hugo Operations", role: "moo", active: true, created_at: "2023-05-01T14:00:00Z", email: "hugo@example.test", phone: "+15550000008", profile_blurb: "MoO blurb." },
    { id: U.owner, name: "Ines Owner", role: "owner", active: true, created_at: "2022-01-01T14:00:00Z", email: "ines@example.test", phone: "+15550000009", profile_blurb: "Owner blurb." },
    { id: U.empB, name: "Juli EmployeeB", role: "employee", active: true, created_at: "2026-09-20T14:00:00Z", email: null, phone: null, profile_blurb: null },
    { id: U.gmB, name: "Kiko GeneralB", role: "gm", active: true, created_at: "2024-04-01T14:00:00Z", email: "kiko@example.test", phone: null, profile_blurb: null },
    { id: U.deactivated, name: "Lalo Gone", role: "employee", active: false, created_at: "2025-02-01T14:00:00Z", email: null, phone: null, profile_blurb: null },
    { id: U.inactiveMember, name: "Mimi Moved", role: "employee", active: true, created_at: "2025-03-01T14:00:00Z", email: null, phone: null, profile_blurb: null },
  ];

  const ul = (user_id: string, location_id: string, active = true): Row => ({ user_id, location_id, active });
  const user_locations: Row[] = [
    ul(U.emp, LOC_A), ul(U.trainer, LOC_A), ul(U.kh, LOC_A), ul(U.slBoth, LOC_A), ul(U.slBoth, LOC_B),
    ul(U.agm, LOC_A), ul(U.gm, LOC_A), ul(U.smm, LOC_A), ul(U.moo, LOC_A), ul(U.moo, LOC_B),
    ul(U.empB, LOC_B), ul(U.gmB, LOC_B), ul(U.deactivated, LOC_A), ul(U.inactiveMember, LOC_B, false),
    ul(U.inactiveMember, LOC_A, false),
  ];

  // Who works at each shop (completers). The inactive member still has old completions at B.
  const crew: Record<string, readonly string[]> = {
    [LOC_A]: [U.emp, U.trainer, U.kh, U.slBoth, U.agm, U.gm, U.smm, U.deactivated, U.moo],
    [LOC_B]: [U.empB, U.slBoth, U.gmB, U.inactiveMember],
  };
  const closers: Record<string, readonly string[]> = {
    [LOC_A]: [U.kh, U.slBoth, U.agm, U.gm],
    [LOC_B]: [U.slBoth, U.gmB],
  };

  const checklist_instances: Row[] = [];
  const checklist_completions: Row[] = [];
  const cash_reports: Row[] = [];
  const pm_reports: Row[] = [];
  const pm_employee_evals: Row[] = [];
  const audit_log: Row[] = [];
  let nInst = 0, nComp = 0, nCash = 0, nPm = 0, nEval = 0, nAudit = 0;

  const start = "2026-08-06"; // 70 days through TODAY
  const gradients = ["great", "good", "needs_work"] as const;
  const notes = ["Restocked the line", "  ", "", null, null, "Walk-in temp ok"] as const;

  for (let d = 0; d < 70; d++) {
    const date = addDays(start, d);
    for (const loc of [LOC_A, LOC_B]) {
      const tag = loc === LOC_A ? "a" : "b";
      for (const kind of ["opening", "closing"] as const) {
        const instId = `ci-${tag}-${pad(++nInst)}`;
        const closer = pick(closers[loc]!);
        // Finalization: mostly on-day; some off-day (next morning); some never confirmed.
        const roll = r();
        const confirmed_by = roll < 0.12 ? null : closer;
        const confirmed_at = confirmed_by == null ? null
          : roll < 0.8 ? at(date, kind === "opening" ? "15:30" : "23:30")
          : at(addDays(date, 1), "13:15");
        checklist_instances.push({ id: instId, location_id: loc, date, kind, confirmed_by, confirmed_at });
        for (let item = 1; item <= 3; item++) {
          if (r() < 0.15) continue;
          const by = pick(crew[loc]!);
          const time = kind === "opening" ? `1${3 + item}:${pad(Math.floor(r() * 60), 2)}` : `2${item}:${pad(Math.floor(r() * 60), 2)}`;
          const base = { instance_id: instId, template_item_id: `ti-${kind}-${item}`, completed_by: by, superseded_at: null, revoked_at: null };
          checklist_completions.push({ id: `cc-${pad(++nComp)}`, ...base, completed_at: at(date, time), notes: pick(notes) });
          const extra = r();
          if (extra < 0.08) {
            // A duplicate live completion of the same (instance, item) by the same person, later.
            checklist_completions.push({ id: `cc-${pad(++nComp)}`, ...base, completed_at: at(date, kind === "opening" ? "17:59" : "23:59"), notes: "second pass" });
          } else if (extra < 0.14) {
            checklist_completions.push({ id: `cc-${pad(++nComp)}`, ...base, completed_at: at(date, "18:00"), notes: "superseded", superseded_at: at(date, "18:05") });
          } else if (extra < 0.19) {
            checklist_completions.push({ id: `cc-${pad(++nComp)}`, ...base, completed_at: at(date, "18:10"), notes: null, revoked_at: at(date, "18:20") });
          }
        }
        // Oversight acts at this instance, now and then.
        if (r() < 0.1) {
          const actor = pick(closers[loc]!);
          const action = pick(["checklist_completion.revoke", "checklist_completion.revoke_by_authority", "checklist_completion.tag_actual_completer"] as const);
          audit_log.push({ id: `al-${pad(++nAudit)}`, actor_id: actor, action, occurred_at: at(date, "19:00"), resource_table: "checklist_completions", resource_id: `cc-x-${nAudit}`, metadata: { instance_id: instId, template_item_id: "ti-x" } });
        }
        if (r() < 0.05) {
          audit_log.push({ id: `al-${pad(++nAudit)}`, actor_id: pick(closers[loc]!), action: "report.update", occurred_at: at(date, "20:00"), resource_table: "checklist_submissions", resource_id: `cs-${nAudit}`, metadata: { report_type: `${kind}_report`, report_instance_id: instId, edit_count: 2 } });
        }
      }

      // Cash: one live report most days, some superseded, some notes.
      if (r() < 0.85) {
        const signer = pick(closers[loc]!);
        const note = pick(["Over by $2", "", "  ", null, null] as const);
        if (r() < 0.15) cash_reports.push({ id: `cash-${pad(++nCash)}`, location_id: loc, report_date: date, signed_by: signer, signed_at: at(date, "23:40"), over_short_note: "first try", superseded_at: at(date, "23:50") });
        const offDay = r() < 0.2;
        cash_reports.push({ id: `cash-${pad(++nCash)}`, location_id: loc, report_date: date, signed_by: signer, signed_at: offDay ? at(addDays(date, 1), "14:00") : at(date, "23:55"), over_short_note: note, superseded_at: null });
      }

      // PM report: every status appears; MVPs; evals with all three gradients.
      if (r() < 0.75) {
        const s = r();
        const status = s < 0.6 ? "submitted" : s < 0.75 ? "incomplete_confirmed" : s < 0.88 ? "auto_finalized" : "open";
        const submitter = pick(closers[loc]!);
        const submitted = status === "submitted" || status === "incomplete_confirmed";
        const pmId = `pm-${tag}-${pad(++nPm)}`;
        const crewHere = crew[loc]!.filter((u) => u !== submitter);
        const mvp = status === "open" ? null : r() < 0.7 ? pick(crewHere) : null;
        pm_reports.push({
          id: pmId, location_id: loc, report_date: date, status,
          submitted_by: submitted ? submitter : null,
          submitted_at: submitted ? (r() < 0.85 ? at(date, "23:58") : at(addDays(date, 1), "12:30")) : null,
          mvp_user_id: mvp, superseded_at: null,
        });
        const evaluated = crewHere.filter(() => r() < 0.5);
        for (const emp of evaluated) {
          const g = () => pick(gradients);
          const area = pick(["Speed on the line", "", "  ", null, null] as const);
          const note = pick(["Great with guests", "", null, "Late twice"] as const);
          if (r() < 0.1) {
            pm_employee_evals.push({ id: `ev-${pad(++nEval)}`, pm_report_id: pmId, location_id: loc, employee_id: emp, arrived_ready: g(), attitude: g(), production: g(), team_player: g(), area_to_improve: "old", note: "old", superseded_at: at(date, "23:00") });
          }
          pm_employee_evals.push({ id: `ev-${pad(++nEval)}`, pm_report_id: pmId, location_id: loc, employee_id: emp, arrived_ready: g(), attitude: g(), production: g(), team_player: g(), area_to_improve: area, note, superseded_at: null });
        }
      }
    }
  }

  // ── Hand-placed rows the generator may not produce ────────────────────────────────────────
  // Instances dated BEFORE the window with completions inside it.
  for (const [loc, tag, by] of [[LOC_A, "a", U.emp], [LOC_B, "b", U.empB]] as const) {
    const oldId = `ci-${tag}-old-1`;
    checklist_instances.push({ id: oldId, location_id: loc, date: "2026-06-30", kind: "deep_clean", confirmed_by: null, confirmed_at: null });
    checklist_completions.push({ id: `cc-old-${tag}-1`, instance_id: oldId, template_item_id: "ti-deep-1", completed_by: by, completed_at: at("2026-10-10", "16:00"), notes: "late finish", superseded_at: null, revoked_at: null });
    checklist_completions.push({ id: `cc-old-${tag}-2`, instance_id: oldId, template_item_id: "ti-deep-2", completed_by: U.slBoth, completed_at: at("2026-10-12", "16:00"), notes: null, superseded_at: null, revoked_at: null });
  }
  // The both-shops SL: oversight at EACH shop, through every action shape.
  const firstA = checklist_instances.find((i) => i.location_id === LOC_A && i.date === "2026-10-08")!.id as string;
  const firstB = checklist_instances.find((i) => i.location_id === LOC_B && i.date === "2026-10-09")!.id as string;
  audit_log.push(
    { id: `al-${pad(++nAudit)}`, actor_id: U.slBoth, action: "checklist_completion.revoke", occurred_at: at("2026-10-08", "19:10"), resource_table: "checklist_completions", resource_id: "cc-sl-1", metadata: { instance_id: firstA } },
    { id: `al-${pad(++nAudit)}`, actor_id: U.slBoth, action: "checklist_completion.revoke_by_authority", occurred_at: at("2026-10-09", "19:10"), resource_table: "checklist_completions", resource_id: "cc-sl-2", metadata: { instance_id: firstB } },
    { id: `al-${pad(++nAudit)}`, actor_id: U.slBoth, action: "checklist_completion.tag_actual_completer", occurred_at: at("2026-10-09", "19:20"), resource_table: "checklist_completions", resource_id: "cc-sl-3", metadata: { instance_id: firstB } },
    { id: `al-${pad(++nAudit)}`, actor_id: U.slBoth, action: "report.update", occurred_at: at("2026-10-08", "20:10"), resource_table: "checklist_submissions", resource_id: "cs-sl-1", metadata: { report_instance_id: firstA, edit_count: 1 } },
    { id: `al-${pad(++nAudit)}`, actor_id: U.slBoth, action: "report.drop", occurred_at: at("2026-10-09", "20:10"), resource_table: "checklist_instances", resource_id: firstB, metadata: { location_id: LOC_B, dropped_reason: "shift_change" } },
    // report.drop naming a LOCATION but no instance: placed by metadata.location_id.
    { id: `al-${pad(++nAudit)}`, actor_id: U.slBoth, action: "report.drop", occurred_at: at("2026-10-10", "20:10"), resource_table: "checklist_instances", resource_id: null, metadata: { location_id: LOC_A } },
    // UNATTRIBUTABLE: no instance, no location — counted at neither shop.
    { id: `al-${pad(++nAudit)}`, actor_id: U.slBoth, action: "report.update", occurred_at: at("2026-10-11", "20:10"), resource_table: "checklist_submissions", resource_id: "cs-sl-2", metadata: { edit_count: 3 } },
    // A non-oversight action by the same actor: never counted.
    { id: `al-${pad(++nAudit)}`, actor_id: U.slBoth, action: "user.update", occurred_at: at("2026-10-11", "20:20"), resource_table: "users", resource_id: U.emp, metadata: { instance_id: firstA } },
  );
  // A superseded PM report (the live one for that day stays separate).
  pm_reports.push({ id: "pm-a-superseded", location_id: LOC_A, report_date: "2026-10-01", status: "submitted", submitted_by: U.gm, submitted_at: at("2026-10-01", "23:00"), mvp_user_id: U.emp, superseded_at: at("2026-10-01", "23:30") });
  pm_employee_evals.push({ id: "ev-on-superseded", pm_report_id: "pm-a-superseded", location_id: LOC_A, employee_id: U.emp, arrived_ready: "great", attitude: "great", production: "great", team_player: "great", area_to_improve: null, note: "on a superseded report", superseded_at: null });
  // Every status at least once, at a fixed spot (independent of the generator's luck).
  for (const [i, status] of (["open", "submitted", "incomplete_confirmed", "auto_finalized"] as const).entries()) {
    const date = addDays("2026-10-02", i);
    const submitted = status === "submitted" || status === "incomplete_confirmed";
    const id = `pm-b-fixed-${i}`;
    pm_reports.push({ id, location_id: LOC_B, report_date: `${date}`, status, submitted_by: submitted ? U.gmB : null, submitted_at: submitted ? at(date, "23:45") : null, mvp_user_id: status === "open" ? null : U.empB, superseded_at: null });
    pm_employee_evals.push({ id: `ev-b-fixed-${i}`, pm_report_id: id, location_id: LOC_B, employee_id: U.empB, arrived_ready: gradients[i % 3], attitude: gradients[(i + 1) % 3], production: gradients[(i + 2) % 3], team_player: "good", area_to_improve: i === 1 ? "Ask for help sooner" : null, note: "manager-only note", superseded_at: null });
  }

  // ── Rows in the NEW tables (today's loaders never read them) ──────────────────────────────
  const station_events: Row[] = [
    { id: "se-1", location_id: LOC_A, business_date: "2026-10-13", user_id: U.emp, station_id: "st-a-1", position_id: "pos-a-walkins", kind: "assign", actor_id: U.gm, at: at("2026-10-13", "14:00"), source: "board", reason_code: null, effective_at: null },
    { id: "se-2", location_id: LOC_A, business_date: "2026-10-13", user_id: U.emp, station_id: "st-a-1", position_id: "pos-a-walkins", kind: "release", actor_id: U.gm, at: at("2026-10-13", "20:00"), source: "board", reason_code: "shift_end", effective_at: at("2026-10-13", "19:45") },
  ];
  const pm_report_copies: Row[] = [
    { id: "copy-1", pm_report_id: "pm-b-fixed-1", location_id: LOC_B, author_id: U.gmB, status: "sealed" },
  ];
  const pm_copy_grades: Row[] = [
    { id: "grade-1", copy_id: "copy-1", location_id: LOC_B, subject_id: U.empB, position_id: "pos-b-expo", criterion_id: "crit-1", grade: "great", superseded_at: null },
  ];
  const people_skill_adjustments: Row[] = [
    { id: "adj-1", location_id: LOC_A, user_id: U.emp, position_id: "pos-a-walkins", delta: 0.1, reason_code: "observed_on_floor", actor_id: U.gm, created_at: at("2026-10-12", "15:00") },
  ];

  return {
    locations, users, user_locations, checklist_instances, checklist_completions, cash_reports,
    pm_reports, pm_employee_evals, audit_log,
    station_events, pm_report_copies, pm_copy_grades, people_skill_adjustments,
  };
}
