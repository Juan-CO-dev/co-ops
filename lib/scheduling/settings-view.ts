/**
 * `loadScheduleSettings` — the schedule SETTINGS page's one loader (Scheduling Phase 2, chunk F, Task 24). Server-only,
 * service role, read-only.
 *
 * The permission rule first (`gate` "view", before any I/O: the social media manager by ROLE, the catering / prep
 * managers forbidden, below MoO own shops only); a missing 0274 / 0275 / 0270 table is NOT INSTALLED. Then each section
 * by its own rule (access-shared): the structure (GM own / MoO+), person settings and presence (GM / MoO+ / an AGM whose
 * shop grants edit), the shop switch + wage estimates + AGM access and the skill tunables (MoO+ only), the prep evidence
 * position (GM own / MoO+). A section the actor may not touch carries NO data (null). The page works with the shop
 * switched OFF — that is where MoO+ turns it on. No write, no email, no notification.
 */
import { canEditSkillTunables, type PeopleActor } from "@/lib/people/access-shared";
import { loadPeopleShopSettings } from "@/lib/people/settings";
import { loadShopTunables } from "@/lib/people/skills";
import { operationalNow } from "@/lib/midshift-shared";
import { selectAllRows } from "@/lib/supabase-paginate";
import { canEditStructure, canManageShopSwitch, scheduleActRefusal } from "./access-shared";
import type { PositionLabel } from "./board-view-shared";
import { loadPositionLabelRows } from "./board";
import { ScheduleError } from "./errors-shared";
import { loadScheduleShopSettings, loadSchedulingInputs, loadStationSeedRows } from "./inputs";
import { gate, type ScheduleDeps } from "./schedules";
import { presenceDates, presenceWeekStarts, stationAdvisory, type ScheduleSettingsView, type SettingsMember } from "./settings-view-shared";
import { structureFromStations, type PositionRole } from "./structure-shared";

const notInstalled = (e: unknown) => e instanceof ScheduleError && e.code === "inputs_unavailable";
/** Roles that are never put on the floor schedule, so never offered "Include on the schedule" (R6). */
const NEVER_INCLUDED = ["cgs", "social_media_mgr"];

/** The MoO / Owner (presence only: the "in today" toggles), active, by id. */
export async function loadPresencePeople(service: ScheduleDeps["service"]): Promise<Array<{ userId: string; name: string }>> {
  const rows = await selectAllRows<{ id: string; name: string; role: string }>((f, t) => service.from("users")
    .select("id, name, role").in("role", ["moo", "owner"]).eq("active", true).order("id", { ascending: true }).range(f, t));
  return rows.map((r) => ({ userId: r.id, name: r.name }));
}

export type SettingsLoad = { state: "not_installed" } | ({ state: "ready" } & ScheduleSettingsView);

export async function loadScheduleSettings(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string }): Promise<SettingsLoad> {
  const { actor, locationId } = args;
  await gate(deps.service, actor, locationId, "view");
  let shopSettings;
  try { shopSettings = await loadScheduleShopSettings(deps.service, locationId); } catch (e) { if (notInstalled(e)) return { state: "not_installed" }; throw e; }
  const now = deps.now ?? new Date();
  const today = operationalNow(now).date;
  let inputs;
  try {
    inputs = await (deps.loadInputs ?? loadSchedulingInputs)(deps.service, { locationId, weekStarts: presenceWeekStarts(today), now });
  } catch (e) {
    if (notInstalled(e)) return { state: "not_installed" };
    throw e;
  }
  const access = { agmAccess: shopSettings.agmAccess };
  const perms = {
    structure: canEditStructure(actor, locationId),
    people: scheduleActRefusal(actor, locationId, "person_settings", access) === null,
    presence: scheduleActRefusal(actor, locationId, "presence", access) === null,
    shopSwitch: canManageShopSwitch(actor),
    tunables: canEditSkillTunables(actor),
    prepCard: canEditStructure(actor, locationId),
  };
  const live = inputs.structure.structure;
  // The station-column advisory: only once a structure is SAVED (before that the editor opens on the seeded values).
  let advisory: ScheduleSettingsView["stationAdvisory"] = [];
  if (perms.structure && inputs.structure.source === "saved") {
    const rows = await loadStationSeedRows(deps.service, locationId);
    const roles: Record<string, PositionRole> = Object.fromEntries(Object.entries(live.positions).map(([id, p]) => [id, p.role]));
    const seeded = structureFromStations(rows.stations, rows.positions, roles, live);
    if (seeded.ok) advisory = stationAdvisory(live, seeded.structure, seeded.seededFrom);
  }
  const positions: Record<string, PositionLabel> = {};
  for (const r of await loadPositionLabelRows(deps.service, locationId)) {
    positions[r.id] = { name: r.name, nameEs: r.name_es, role: live.positions[r.id]?.role ?? "line_other" };
  }
  const latest = new Map(inputs.personSettings.map((s) => [s.userId, s]));
  const members: SettingsMember[] = perms.people ? inputs.members.filter((m) => !NEVER_INCLUDED.includes(m.role)).map((m) => ({
    userId: m.userId, name: m.name, role: m.role, settings: latest.get(m.userId) ?? null,
    includeOffered: live.roster.excludedRoles.includes(m.role),
  })) : [];
  let presencePeople: ScheduleSettingsView["presencePeople"] = [];
  if (perms.presence) presencePeople = await loadPresencePeople(deps.service);
  const names: Record<string, string> = Object.fromEntries([...inputs.members.map((m) => [m.userId, m.name] as const), ...presencePeople.map((p) => [p.userId, p.name] as const)]);
  const dates = presenceDates(today);
  return {
    state: "ready", locationId, today, dates, perms,
    structure: perms.structure ? { id: inputs.structure.source === "saved" ? inputs.structure.id : null, source: inputs.structure.source, value: live } : null,
    closing: { measuredMinutes: inputs.closing.basis === "measured" ? inputs.closing.minutes : null, samples: inputs.closing.samples },
    stationAdvisory: advisory, positions, names, members, presencePeople,
    pins: perms.presence ? inputs.pins.filter((p) => p.date >= today).map((p) => ({ id: p.id, date: p.date, userId: p.userId, startQ: p.startQ, endQ: p.endQ, positions: [...p.positions], kind: p.kind })) : [],
    shop: perms.shopSwitch ? shopSettings : null,
    tunables: perms.tunables ? await loadShopTunables(deps.service, locationId) : null,
    prep: perms.prepCard ? await loadPeopleShopSettings(deps.service, locationId) : null,
  };
}
