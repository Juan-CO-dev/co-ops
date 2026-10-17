"use client";
/**
 * Presence and Add to schedule (spec §5.4, §7; mockup v17 presence toggles + "Add to schedule"): for a chosen day,
 * "Cristian in today" toggles for the MoO / Owner (presence only — never auto-scheduled) and Add to schedule (anyone, a
 * block, the positions they can flex across). Both write PINS (`{action: pin}`), which the next build honours; a toggle
 * off or a remove RETIRES the pin (append-only). Past days are not offered. No step-up (audited); refusals named.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { formatDateLabel } from "@/lib/i18n/format";
import { pinBody, retirePinBody, type SettingsPin } from "@/lib/scheduling/settings-view-shared";
import { formatQ } from "@/lib/scheduling/time-shared";
import { scheduleErrorKey } from "./schedule-errors";
import { BUTTON, Check, Fields, GHOST, SelectField, TimeField } from "./settings-fields";
import { useBoardLine } from "./use-board-line";

export function PresenceAndAdd({ locationId, dates, presencePeople, people, pins, positions, names, defaultBlock }: {
  locationId: string;
  dates: string[];
  presencePeople: Array<{ userId: string; name: string }>;
  people: Array<{ userId: string; name: string }>;
  pins: SettingsPin[];
  positions: Record<string, { name: string; nameEs: string | null }>;
  names: Record<string, string>;
  defaultBlock: { startQ: number; endQ: number };
}) {
  const { t, language, name, position } = useBoardLine({ names, positions });
  const router = useRouter();
  const post = useStepUpPost();
  const [date, setDate] = useState(dates[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState("");
  const [block, setBlock] = useState(defaultBlock);
  const [chosen, setChosen] = useState<string[]>([]);
  const send = async (body: unknown) => {
    setBusy(true); setError(null);
    const r = await post("/api/schedule", body);
    setBusy(false);
    if (!r.ok) { setError(r.code); return false; }
    router.refresh();
    return true;
  };
  const dayPins = pins.filter((p) => p.date === date);
  return (
    <div className="grid gap-4" data-section="presence-add">
      <SelectField name="pinDate" label={t("schedule.settings.presence.day")} value={date} onChange={setDate}
        options={dates.map((d) => ({ value: d, label: formatDateLabel(d, language) }))} />
      {presencePeople.length > 0 ? (
        <div className="grid gap-1">
          <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("schedule.settings.presence.title")}</h4>
          <div className="flex flex-wrap gap-x-4">
            {presencePeople.map((p) => {
              const pin = dayPins.find((x) => x.userId === p.userId && x.kind === "presence");
              return (
                <Check key={p.userId} data={{ "data-presence": p.userId }} label={t("schedule.settings.presence.in_today", { name: p.name })} checked={!!pin}
                  onChange={(on) => { void send(on ? pinBody(locationId, { date, userId: p.userId, startQ: defaultBlock.startQ, endQ: defaultBlock.endQ, positions: [], kind: "presence" }) : retirePinBody(locationId, pin!.id)); }} />
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="grid gap-2 rounded-lg border border-co-border bg-co-surface-inset p-3" data-section="add-to-schedule">
        <h4 className="text-sm font-bold text-co-text">{t("schedule.settings.add.title")}</h4>
        <Fields>
          <SelectField name="addPerson" label={t("schedule.settings.add.person")} value={who} onChange={setWho}
            options={[{ value: "", label: t("schedule.settings.add.pick") }, ...people.map((p) => ({ value: p.userId, label: p.name }))]} />
          <TimeField name="addStart" label={t("schedule.settings.add.start")} q={block.startQ} onChange={(q) => setBlock((b) => ({ ...b, startQ: q }))} />
          <TimeField name="addEnd" label={t("schedule.settings.add.end")} q={block.endQ} onChange={(q) => setBlock((b) => ({ ...b, endQ: q }))} />
        </Fields>
        <div className="flex flex-wrap gap-x-3">
          <span className="w-full text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("schedule.settings.add.positions")}</span>
          {Object.keys(positions).map((id) => (
            <Check key={id} label={position(id)} checked={chosen.includes(id)} onChange={(on) => setChosen((c) => (on ? [...c, id] : c.filter((x) => x !== id)))} />
          ))}
        </div>
        <button type="button" className={BUTTON} disabled={busy || !who || block.endQ <= block.startQ}
          onClick={async () => { if (await send(pinBody(locationId, { date, userId: who, startQ: block.startQ, endQ: block.endQ, positions: chosen, kind: "added" }))) { setWho(""); setChosen([]); } }}>
          {t("schedule.settings.add.button")}
        </button>
      </div>
      {dayPins.filter((p) => p.kind === "added").length > 0 ? (
        <ul className="grid gap-1 text-sm">
          {dayPins.filter((p) => p.kind === "added").map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 text-co-text">
              <span className="flex-1">{name(p.userId)} · {formatQ(p.startQ, language)}–{formatQ(p.endQ, language)}{p.positions.length ? ` · ${p.positions.map((x) => position(x)).join(", ")}` : ""}</span>
              <button type="button" className={GHOST} disabled={busy} onClick={() => { void send(retirePinBody(locationId, p.id)); }}>{t("schedule.settings.add.remove")}</button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p role="alert" className="text-sm font-bold text-co-cta-text">{t(scheduleErrorKey(error))}</p> : null}
    </div>
  );
}
