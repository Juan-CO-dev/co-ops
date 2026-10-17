"use client";
/**
 * The reason panel (spec §7; mockup v17 `renderDetail`): why this person, this shape, this segment, this budget — the
 * stored reasons of the shift and of each segment, as the generator recorded them (i18n keys, en / es); the worked
 * skill profile as BANDS (never a number); who else on shift could cover; and the flags (availability assumed from
 * Toast punches, a starting-point skill). No wage and no per-person $ ever appear here (J9).
 *
 * The keyboard / a11y twin of dragging: on an editable day the selected shift carries −15 / +15 min buttons (44 px)
 * for the whole bar, each edge and each divider, so nothing requires a pointer.
 */
import { formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import type { EditOp } from "@/lib/scheduling/edit-shared";
import type { PersonRowView, ShiftView } from "@/lib/scheduling/board-view-shared";
import type { Reason } from "@/lib/scheduling/reasons-shared";
import { formatQ } from "@/lib/scheduling/time-shared";
import { useBoardLine } from "./use-board-line";
import { stepOp, type Handle } from "./use-drag-snap-shared";

const BAND_KEY = { strong: "people.skills.band.strong", solid: "people.skills.band.solid", building: "people.skills.band.building", unproven: "schedule.board.strength.unknown" } as const;

export function ReasonPanel({ row, shift, segment, editable, busy = false, names, positions, onEdit }: {
  row: PersonRowView;
  shift: ShiftView;
  segment: number | null;
  editable: boolean;
  /** CC chunk H9 (a11y): an edit is in flight — the nudges stay MOUNTED (focus stays on them) but ignore presses. */
  busy?: boolean;
  names: Record<string, string>;
  positions: Record<string, { name: string; nameEs: string | null }>;
  onEdit: (op: EditOp) => void;
}) {
  const { t, language, name, position } = useBoardLine({ names, positions });
  const reason = (r: Reason, i: number) => (
    <li key={i} data-reason={r.key}>{t(`schedule.reason.${r.key}` as TranslationKey)}</li>
  );
  const range = (a: number, b: number) => `${formatQ(a, language)}–${formatQ(b, language)}`;
  const focus = segment !== null ? shift.segments[segment] : undefined;
  const nudge = (handle: Handle, label: string, id: string) => (
    <div key={id} className="flex flex-wrap items-center gap-2">
      <span className="min-w-[7rem] text-xs font-bold text-co-text-muted">{label}</span>
      {([-1, 1] as const).map((dq) => {
        const op = stepOp(dq, handle, shift);
        return (
          <button key={dq} type="button" data-nudge={`${id}:${dq}`} disabled={!op} aria-disabled={busy || undefined} onClick={() => op && !busy && onEdit(op)}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm font-bold tracking-[0.1em] text-co-text disabled:opacity-60">
            {dq < 0 ? t("schedule.board.nudge.earlier") : t("schedule.board.nudge.later")}
          </button>
        );
      })}
    </div>
  );
  return (
    <section data-section="reason" aria-labelledby="schedule-reason-title" className="co-card grid gap-2 p-4">
      <p className="text-[11px] font-bold tracking-[0.14em] text-co-gold-text">{t(focus ? "schedule.board.reason.why_segment" : "schedule.board.reason.why_shift")}</p>
      <h3 id="schedule-reason-title" className="text-base font-bold text-co-text">
        {row.name} · {formatDateLabel(shift.ref.date, language)} · {range(shift.startQ, shift.endQ)}
      </h3>
      <p className="text-sm text-co-text-muted">
        {t("schedule.board.reason.shape", { hours: (shift.endQ - shift.startQ) / 4, n: shift.segments.length })}{" "}
        {shift.segments.map((g) => `${position(g.positionId)} ${range(g.startQ, g.endQ)}`).join(" → ")}
      </p>
      {shift.reasons.length > 0 ? <ul className="grid list-disc gap-1 pl-5 text-sm text-co-text">{shift.reasons.map(reason)}</ul> : null}
      <ul className="grid gap-2">
        {shift.segments.map((g, i) => (
          <li key={i} className={`grid gap-0.5 rounded-lg border p-2 text-sm ${segment === i ? "border-co-text" : "border-co-border"}`}>
            <span className="font-bold text-co-text">{position(g.positionId)} · {range(g.startQ, g.endQ)}{g.lastResort ? ` · ${t("schedule.board.reason.last_resort")}` : ""}</span>
            {g.reasons.length > 0 ? <ul className="grid list-disc gap-0.5 pl-5 text-co-text-muted">{g.reasons.map(reason)}</ul> : null}
          </li>
        ))}
      </ul>
      {row.profile.length > 0 ? (
        <div className="grid gap-1">
          <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("schedule.board.reason.profile")}</h4>
          <p className="text-sm text-co-text">{row.profile.map((x) => `${position(x.positionId)}: ${t(BAND_KEY[x.band] as TranslationKey)}`).join(" · ")}</p>
        </div>
      ) : null}
      <div className="grid gap-1">
        <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("schedule.board.reason.who_else")}</h4>
        <p className="text-sm text-co-text">{shift.alternates.length > 0
          ? shift.alternates.map((a) => `${name(a.userId)} (${t(BAND_KEY[a.band] as TranslationKey)})`).join(" · ")
          : t("schedule.board.reason.nobody_else")}</p>
      </div>
      {row.assumedAvailability ? <p className="text-xs text-co-warning-text">{t("schedule.board.flag.assumed_availability")}</p> : null}
      {row.startingPoint ? <p className="text-xs text-co-warning-text">{t("schedule.board.flag.starting_point")}</p> : null}
      {editable ? (
        <div className="grid gap-2 border-t border-co-border pt-2" aria-label={t("schedule.board.nudge.label")}>
          {nudge({ kind: "move" }, t("schedule.board.nudge.move"), "move")}
          {nudge({ kind: "start" }, t("schedule.board.nudge.start"), "start")}
          {nudge({ kind: "end" }, t("schedule.board.nudge.end"), "end")}
          {shift.segments.slice(1).map((g, i) => nudge({ kind: "divider", index: i + 1 },
            t("schedule.board.nudge.divider", { from: position(shift.segments[i]!.positionId), to: position(g.positionId) }), `divider${i + 1}`))}
        </div>
      ) : null}
    </section>
  );
}
