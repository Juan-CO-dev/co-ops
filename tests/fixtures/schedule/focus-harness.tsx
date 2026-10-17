/**
 * CC chunk H9 fix 1 — a browser harness for the board's keyboard editing (bundled by tests/schedule-h9-focus.test.ts with
 * esbuild and run in headless Chromium). It mounts the REAL `PersonRow` the way `ScheduleBoard` does: one edit in flight
 * (`busy`), the answer arriving later as a NEW row from the server (the shift's times move; a start edit changes its key),
 * and a refusal remounting the timeline (the board's snap-back key). `window.__h9.refuseNext = true` makes the next edit
 * refused. No server, no network.
 */
import { useRef, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { TranslationProvider } from "@/lib/i18n/provider";
import * as Row from "@/components/schedule/PersonRow";
import type { PersonRowView, ShiftView } from "@/lib/scheduling/board-view-shared";
import type { EditOp } from "@/lib/scheduling/edit-shared";

const DATE = "2026-10-26";
const REG = "pos-reg";
const WALK = "pos-walk";
const positions = { [REG]: { name: "Register", nameEs: "Caja", role: "register" as const }, [WALK]: { name: "Walk-ins", nameEs: "Tienda", role: "walk" as const } };
const names = { "u-1": "Bea" };

function shiftAt(startQ: number, mid: number, endQ: number): ShiftView {
  return {
    ref: { date: DATE, userId: "u-1", startQ }, startQ, endQ, closingManager: false, flex: false, pinned: false, locked: false, reasons: [], alternates: [],
    segments: [
      { positionId: REG, startQ, endQ: mid, mod: false, lastResort: false, reasons: [] },
      { positionId: WALK, startQ: mid, endQ, mod: false, lastResort: false, reasons: [] },
    ],
  };
}

function rowOf(sh: ShiftView): PersonRowView {
  return { userId: "u-1", name: "Bea", role: "key_holder", salaried: false, presenceOnly: false, weekHours: (sh.endQ - sh.startQ) / 4, otRisk: false, shifts: [sh], assumedAvailability: false, startingPoint: false, profile: [] };
}

function apply(sh: ShiftView, op: EditOp): ShiftView {
  const mid = sh.segments[1]!.startQ;
  if (op.kind === "end") return shiftAt(sh.startQ, mid, op.toQ);
  if (op.kind === "start") return shiftAt(op.toQ, mid, sh.endQ);
  if (op.kind === "move") return shiftAt(sh.startQ + op.deltaQ, mid + op.deltaQ, sh.endQ + op.deltaQ);
  if (op.kind === "divider") return shiftAt(sh.startQ, op.toQ, sh.endQ);
  return sh;
}

declare global { interface Window { __h9: { refuseNext: boolean; edits: number } } }
window.__h9 = { refuseNext: false, edits: 0 };

function Harness() {
  const [shift, setShift] = useState(() => shiftAt(40, 56, 72));
  const [busy, setBusy] = useState(false);
  const [snapBack, setSnapBack] = useState(0);
  // (Read off the module so the harness also bundles against a PersonRow without the hook — the failing-first run.)
  const focusMemo = ((Row as Record<string, unknown>).useFocusMemo as (() => unknown) | undefined ?? (() => useRef(null)))();
  const PersonRow = Row.PersonRow as unknown as (p: Record<string, unknown>) => ReactElement;
  // The board's own wiring of an in-flight edit (`rowEditProps`); before H9 the board passed `editable && !pending`.
  const rowEdit = (Row as Record<string, unknown>).rowEditProps as ((editable: boolean, pending: boolean) => Record<string, unknown>) | undefined;
  const editProps = rowEdit ? rowEdit(true, busy) : { editable: !busy };
  const pending = useRef(false);
  const onEdit = (op: EditOp) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    window.__h9.edits++;
    setTimeout(() => {
      pending.current = false;
      setBusy(false);
      if (window.__h9.refuseNext) { window.__h9.refuseNext = false; setSnapBack((n) => n + 1); return; }
      setShift((sh) => apply(sh, op));
    }, 60);
  };
  return (
    <div key={snapBack} style={{ display: "grid", gridTemplateColumns: "7rem 1fr", width: 900 }}>
      <PersonRow row={rowOf(shift)} axis={{ fromQ: 24, toQ: 88 }} {...editProps} focusMemo={focusMemo} positions={positions} names={names}
        roleOf={(id: string) => (id === "mod" ? "mod" : positions[id as keyof typeof positions]?.role ?? "line_other")} selectedKey={null} onSelect={() => {}} onEdit={onEdit} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<TranslationProvider initialLanguage="en"><Harness /></TranslationProvider>);
