"use client";
/**
 * A person's row on the day timeline (spec §7; mockup v17 person rows): the label (name, role, week hours, overtime risk,
 * the starting-point flag) and the lane with their multi-segment shift bars, coloured by position ROLE (the mockup's
 * station tokens). On an editable day each bar carries handles — the bar itself (move), both edges (start / end) and a
 * divider between each pair of segments — that drag in 15-minute snaps (`useDragSnap`) or step with ArrowLeft /
 * ArrowRight; a past (locked) day renders no handle at all. Tapping a segment opens its reason. `EditNotice` names a
 * refused edit (the bar snaps back) or says the week moved under you.
 *
 * CC chunk H9 (a11y, runbook step 4): a keyboard edit keeps focus on the SAME handle across the re-render. While an edit is in
 * flight the handles stay mounted (`busy`: they ignore input, `aria-disabled`) instead of disappearing; a bar is keyed by its
 * identity (date + person + its place in the row), never its start time; and the handle last used is focused again after the
 * commit or a refusal's remount (`useFocusMemo`), unless the reader has moved focus elsewhere.
 */
import { useCallback, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type MutableRefObject } from "react";
import { formatQ } from "@/lib/scheduling/time-shared";
import type { TranslationKey } from "@/lib/i18n/types";
import type { EditOp } from "@/lib/scheduling/edit-shared";
import type { PersonRowView, ShiftView } from "@/lib/scheduling/board-view-shared";
import type { PositionRole } from "@/lib/scheduling/structure-shared";
import { useTranslation } from "@/lib/i18n/provider";
import { scheduleErrorKey } from "./schedule-errors";
import { useBoardLine } from "./use-board-line";
import { useDragSnap } from "./use-drag-snap";
import { keyToOp, type EditState, type Handle } from "./use-drag-snap-shared";

/** Bar colours per position role (full class names, so Tailwind sees them). */
export const STATION_CLASS: Record<PositionRole | "mod", string> = {
  prep: "bg-co-station-prep border-co-station-prep-edge",
  prep_dish: "bg-co-station-prep-dish border-co-station-prep-dish-edge",
  register: "bg-co-station-register border-co-station-register-edge",
  expo: "bg-co-station-expo border-co-station-expo-edge",
  walk: "bg-co-station-walk border-co-station-walk-edge",
  walk_online: "bg-co-station-walk-online border-co-station-walk-online-edge",
  line_other: "bg-co-station-line border-co-station-line-edge",
  mod: "bg-co-surface-2 border-co-text-dim",
};

export const shiftKeyOf = (s: { ref: { date: string; userId: string; startQ: number } }) => `${s.ref.date}|${s.ref.userId}|${s.ref.startQ}`;

/** CC chunk H9: a bar's IDENTITY across edits — date + person + its place in the row (a start edit changes `shiftKeyOf`). */
export const barKeyOf = (s: { ref: { date: string; userId: string } }, ordinal: number) => `${s.ref.date}|${s.ref.userId}|#${ordinal}`;

/** CC chunk H9: the handle a keyboard edit was made on (its bar's identity + the handle), focused again after the re-render. */
export interface FocusMemo { bar: string; handle: string }
export function useFocusMemo(): MutableRefObject<FocusMemo | null> {
  return useRef<FocusMemo | null>(null);
}

/** CC chunk H9: how the board passes an in-flight edit to the rows — handles stay MOUNTED (busy), never removed (focus would drop to <body>). */
export function rowEditProps(editable: boolean, pending: boolean): { editable: boolean; busy: boolean } {
  return { editable, busy: pending };
}

export function EditNotice({ state }: { state: EditState }) {
  const { t } = useTranslation();
  if (state.notice === "head_moved") return <p role="status" className="rounded-lg border-2 border-co-warning bg-co-warning-surface p-2 text-sm font-bold text-co-warning-text">{t("schedule.board.edit.head_moved")}</p>;
  if (state.error) return <p role="alert" className="text-sm font-bold text-co-cta-text">{t(scheduleErrorKey(state.error))}</p>;
  return null;
}

export function PersonRow({ row, axis, editable, busy = false, focusMemo, positions, names, roleOf, selectedKey, onSelect, onEdit }: {
  row: PersonRowView;
  axis: { fromQ: number; toQ: number };
  editable: boolean;
  /** An edit is in flight: the handles stay mounted but ignore input. */
  busy?: boolean;
  focusMemo?: MutableRefObject<FocusMemo | null>;
  positions: Record<string, { name: string; nameEs: string | null; role: PositionRole }>;
  names: Record<string, string>;
  roleOf: (positionId: string) => PositionRole | "mod";
  selectedKey: string | null;
  onSelect: (shift: ShiftView, segment: number | null) => void;
  onEdit: (op: EditOp) => void;
}) {
  const { t } = useBoardLine({ names, positions });
  const laneRef = useRef<HTMLDivElement>(null);
  const pxPerQ = useCallback(() => {
    const w = laneRef.current?.getBoundingClientRect().width ?? 0;
    return w > 0 ? w / (axis.toQ - axis.fromQ) : 0;
  }, [axis.fromQ, axis.toQ]);
  return (
    <>
      <div className="sticky left-0 z-10 flex min-h-[52px] flex-col justify-center border-r border-t border-co-border bg-co-surface px-2 text-xs" data-person={row.userId}>
        <strong className="truncate text-co-text">{row.name}</strong>
        <small className="truncate text-co-text-muted">{row.role ? t(`role.${row.role}` as TranslationKey) : ""}</small>
        <small className="text-co-text-muted">{t("schedule.board.row.week_hours", { hours: Math.round(row.weekHours * 10) / 10 })}
          {row.otRisk ? <> · <span className="font-bold text-co-cta-text">{t("schedule.board.row.ot_risk")}</span></> : null}</small>
        {row.startingPoint ? <small className="text-co-warning-text">{t("schedule.board.strength.unknown")}</small> : null}
      </div>
      <div ref={laneRef} className="relative min-h-[52px] border-t border-co-border" style={{ gridColumn: "2 / -1" }}>
        {row.shifts.map((sh, i) => (
          <ShiftBar key={barKeyOf(sh, i)} barKey={barKeyOf(sh, i)} busy={busy} focusMemo={focusMemo} shift={sh} axis={axis} editable={editable && !sh.locked} positions={positions} names={names} roleOf={roleOf}
            selected={selectedKey === shiftKeyOf(sh)} onSelect={onSelect} onEdit={onEdit} pxPerQ={pxPerQ} personName={row.name} />
        ))}
      </div>
    </>
  );
}

function ShiftBar({ barKey, busy, focusMemo, shift, axis, editable, positions, names, roleOf, selected, onSelect, onEdit, pxPerQ, personName }: {
  barKey: string;
  busy: boolean;
  focusMemo?: MutableRefObject<FocusMemo | null>;
  shift: ShiftView;
  axis: { fromQ: number; toQ: number };
  editable: boolean;
  positions: Record<string, { name: string; nameEs: string | null; role: PositionRole }>;
  names: Record<string, string>;
  roleOf: (positionId: string) => PositionRole | "mod";
  selected: boolean;
  onSelect: (shift: ShiftView, segment: number | null) => void;
  onEdit: (op: EditOp) => void;
  pxPerQ: () => number;
  personName: string;
}) {
  const { t, language, position } = useBoardLine({ names, positions });
  const drag = useDragSnap(shift, pxPerQ, onEdit, editable && !busy);
  const box = useRef<HTMLDivElement>(null);
  // CC chunk H9: after every render, put focus back on the handle the last keyboard edit used — only when focus was lost
  // (the re-render or a remount dropped it to <body>), never stealing it from wherever the reader moved.
  useLayoutEffect(() => {
    const m = focusMemo?.current;
    if (!m || m.bar !== barKey) return;
    const now = document.activeElement;
    if (now && now !== document.body) return;
    box.current?.querySelector<HTMLElement>(`[data-focus-id="${m.handle}"]`)?.focus();
  });
  const leave = (e: FocusEvent<HTMLButtonElement>) => {
    const to = e.relatedTarget as Node | null;
    if (to && focusMemo && !box.current?.contains(to)) focusMemo.current = null;
  };
  const p = drag.preview;
  const span = axis.toQ - axis.fromQ;
  const start = shift.startQ + (p && (p.handle.kind === "move" || p.handle.kind === "start") ? p.dq : 0);
  const end = shift.endQ + (p && (p.handle.kind === "move" || p.handle.kind === "end") ? p.dq : 0);
  const left = `${((start - axis.fromQ) / span) * 100}%`;
  const width = `${(Math.max(1, end - start) / span) * 100}%`;
  const key = shiftKeyOf(shift);
  const onKey = (handle: Handle, focusId: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!editable) return;
    const op = keyToOp(e.key, handle, shift);
    if (!op) return;
    e.preventDefault();
    if (busy) return; // one edit at a time; the handle stays where it is
    if (focusMemo) focusMemo.current = { bar: barKey, handle: focusId };
    onEdit(op);
  };
  const first = shift.segments[0];
  const tone = STATION_CLASS[first ? roleOf(first.positionId) : "mod"];
  const range = `${formatQ(shift.startQ, language)}–${formatQ(shift.endQ, language)}`;
  const handleClass = "inline-flex min-h-[44px] w-3 shrink-0 cursor-ew-resize items-center justify-center bg-co-text/10 text-[10px] text-co-text";
  return (
    <div ref={box} data-shift={key} data-bar={barKey} className={`absolute top-1 bottom-1 flex overflow-hidden rounded-md border-2 ${tone} ${selected ? "outline outline-2 outline-co-text" : ""} ${shift.locked ? "opacity-75" : ""}`}
      style={{ left, width, touchAction: editable ? "none" : undefined }}
      onPointerMove={drag.onPointerMove} onPointerUp={drag.onPointerUp} onPointerCancel={drag.onPointerCancel}>
      {editable ? (
        <button type="button" data-handle="start" data-focus-id="start" className={handleClass} aria-label={t("schedule.board.handle.start", { name: personName, range })}
          aria-disabled={busy || undefined} onBlur={leave} onPointerDown={drag.onPointerDown({ kind: "start" })} onKeyDown={onKey({ kind: "start" }, "start")}>│</button>
      ) : null}
      {shift.segments.map((g, i) => (
        <span key={i} className="flex min-w-0" style={{ flexGrow: g.endQ - g.startQ, flexBasis: 0 }}>
          {i > 0 && editable ? (
            <button type="button" data-handle="divider" data-index={i} data-focus-id={`divider-${i}`} className={handleClass} aria-disabled={busy || undefined} onBlur={leave}
              aria-label={t("schedule.board.handle.divider", { from: position(shift.segments[i - 1]!.positionId), to: position(g.positionId), time: formatQ(g.startQ, language) })}
              onPointerDown={drag.onPointerDown({ kind: "divider", index: i })} onKeyDown={onKey({ kind: "divider", index: i }, `divider-${i}`)}>┃</button>
          ) : null}
          <button type="button" data-segment={i} data-focus-id={`segment-${i}`} onBlur={leave}
            className={`inline-flex min-h-[44px] min-w-0 flex-1 items-center truncate px-1 text-left text-[11px] font-bold text-co-text ${g.mod ? "bg-co-surface-2" : ""} ${editable ? "cursor-grab" : ""}`}
            aria-label={t("schedule.board.handle.segment", { position: position(g.positionId), range: `${formatQ(g.startQ, language)}–${formatQ(g.endQ, language)}` })}
            onClick={() => onSelect(shift, i)} onPointerDown={editable ? drag.onPointerDown({ kind: "move" }) : undefined} onKeyDown={onKey({ kind: "move" }, `segment-${i}`)}>
            {position(g.positionId)}
          </button>
        </span>
      ))}
      {shift.closingManager ? <span className="inline-flex shrink-0 items-center bg-co-text px-1 text-[10px] font-bold text-co-surface">{t("schedule.board.row.cm")}</span> : null}
      {editable ? (
        <button type="button" data-handle="end" data-focus-id="end" className={handleClass} aria-label={t("schedule.board.handle.end", { name: personName, range })}
          aria-disabled={busy || undefined} onBlur={leave} onPointerDown={drag.onPointerDown({ kind: "end" })} onKeyDown={onKey({ kind: "end" }, "end")}>│</button>
      ) : null}
      <span data-shift-end={key} hidden />
    </div>
  );
}
