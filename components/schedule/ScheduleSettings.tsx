"use client";
/**
 * THE SCHEDULE SETTINGS PAGE (Scheduling Phase 2, chunk F, Task 24; spec §5.3–5.7): one section per editor, each shown
 * only to who may use it (the loader sends no data otherwise) — the schedule structure, the station-column advisory,
 * staff settings, presence and Add to schedule, and for MoO+ the shop card (switch, wage estimates, AGM access) and the
 * skill tunables; the prep evidence position for GM / MoO+. Each section is a full-row toggle (D8), open by default (the
 * editors ARE the work, D3), with its count where it has one (D5), and locked OPEN while its editor holds unsaved work
 * (D10). useState only.
 */
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import type { ScheduleSettingsView } from "@/lib/scheduling/settings-view-shared";
import { PrepPositionCard } from "@/components/people/PrepPositionCard";
import { SkillTunablesEditor } from "@/components/people/SkillTunablesEditor";
import { PresenceAndAdd } from "./PresenceAndAdd";
import { ShopSettingsCard } from "./ShopSettingsCard";
import { StaffSettings } from "./StaffSettings";
import { StructureEditor } from "./StructureEditor";
import { useBoardLine } from "./use-board-line";

export type SettingsPageView = { state: "not_installed" } | ({ state: "ready" } & ScheduleSettingsView);

/**
 * A full-row toggle section. Collapsing HIDES the panel and never unmounts it (Astra chunk F P2-5): an editor's local
 * draft (a wage estimate, a tunable) survives a collapse and is there on reopen, so D10 holds for every section, the
 * ones whose editors do not report dirtiness included. A section whose editor reports unsaved work is also locked open.
 */
export function Section({ title, count, locked, children, id, defaultOpen = true }: { title: string; count?: string | null; locked: boolean; children: ReactNode; id: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const panel = useId();
  const isOpen = open || locked;
  return (
    <section className="co-card" data-settings-section={id}>
      <button type="button" aria-expanded={isOpen} aria-controls={panel} onClick={() => { if (!locked) setOpen((o) => !o); }}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 text-left">
        <span className="text-base font-bold text-co-text">{title}{count ? <span className="ml-2 text-xs font-bold text-co-text-muted">{count}</span> : null}</span>
        <span aria-hidden="true" className="text-co-text-dim">{isOpen ? "⌃" : "⌄"}</span>
      </button>
      <div id={panel} hidden={!isOpen} className="grid gap-3 px-4 pb-4">{children}</div>
    </section>
  );
}

export function ScheduleSettings({ view, initialStructureError = null, initialSaved = false, initialPerson = null }: {
  view: SettingsPageView;
  /** SSR tests only. */
  initialStructureError?: string | null;
  initialSaved?: boolean;
  initialPerson?: string | null;
}) {
  const ready = view.state === "ready" ? view : null;
  const { t, line } = useBoardLine({ names: ready?.names ?? {}, positions: ready?.positions ?? {} });
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const mark = (k: string) => (d: boolean) => setDirty((x) => ({ ...x, [k]: d }));
  if (!ready) return <p className="co-card p-4 text-sm font-bold text-co-text" role="status">{t("schedule.error.inputs_unavailable")}</p>;
  const v = ready;
  const nothing = !Object.values(v.perms).some(Boolean);
  const block = v.structure ? { startQ: v.structure.value.shopDay.serviceStartQ, endQ: v.structure.value.shopDay.serviceCloseQ } : { startQ: 42, endQ: 80 };
  return (
    <div className="grid min-w-0 gap-3" data-state="settings">
      <Link href={`/schedule?loc=${v.locationId}`} className="inline-flex min-h-[44px] items-center text-sm font-bold text-co-text underline">{t("schedule.settings.back_to_board")}</Link>
      {nothing ? <p className="co-card p-4 text-sm text-co-text-muted">{t("schedule.settings.read_only")}</p> : null}
      {v.structure ? (
        <Section id="structure" title={t("schedule.settings.structure_title")} locked={!!dirty.structure}>
          <p className="text-sm text-co-text-muted">{t(v.structure.source === "saved" ? "schedule.settings.structure_saved" : "schedule.settings.structure_seeded")}</p>
          {v.stationAdvisory.length > 0 ? (
            <ul className="grid gap-1 rounded-lg border-2 border-co-warning bg-co-warning-surface p-3 text-sm text-co-warning-text" data-section="station-advisory">
              {v.stationAdvisory.map((l, i) => <li key={i}>{line(l)}</li>)}
            </ul>
          ) : null}
          <StructureEditor locationId={v.locationId} structure={v.structure} timeProvenance={v.timeProvenance} closing={v.closing} positions={v.positions} names={v.names}
            onDirty={mark("structure")} initialError={initialStructureError} initialSaved={initialSaved} />
        </Section>
      ) : null}
      {v.perms.people ? (
        <Section id="staff" title={t("schedule.settings.staff.title")} count={t("schedule.settings.count", { n: v.members.length })} locked={!!dirty.staff}>
          <StaffSettings locationId={v.locationId} members={v.members} livePositionIds={v.livePositionIds} positions={v.positions} names={v.names} rolesKnown={v.positionRolesKnown ?? false} initialPerson={initialPerson} onDirty={mark("staff")} />
        </Section>
      ) : null}
      {v.perms.presence ? (
        <Section id="presence" title={t("schedule.settings.presence.section")} locked={false}>
          <PresenceAndAdd locationId={v.locationId} dates={v.dates} presencePeople={v.presencePeople} people={[...v.members.map((m) => ({ userId: m.userId, name: m.name })), ...v.presencePeople]}
            pins={v.pins} livePositionIds={v.livePositionIds} positions={v.positions} names={v.names} defaultBlock={block} />
        </Section>
      ) : null}
      {v.shop ? (
        <Section id="shop" title={t("schedule.settings.shop.title")} locked={false}>
          <ShopSettingsCard locationId={v.locationId} shop={v.shop} />
        </Section>
      ) : null}
      {v.tunables ? (
        <Section id="tunables" title={t("schedule.settings.tunables.title")} locked={false}>
          <SkillTunablesEditor locationId={v.locationId} tunables={v.tunables} />
        </Section>
      ) : null}
      {v.prep ? (
        <Section id="prep" title={t("schedule.settings.prep.title")} locked={false}>
          <PrepPositionCard locationId={v.locationId} prep={v.prep} positions={v.positions} />
        </Section>
      ) : null}
    </div>
  );
}
