"use client";
/**
 * The pointer half of the board's drag (Task 22): a pointer down on a bar, an edge or a divider captures the pointer;
 * moving previews the change in whole 15-minute steps (`dragToOp`'s rounding); letting go commits ONE edit op through
 * `onCommit`; a cancelled pointer (or an Escape) drops the preview. The pure maths is `use-drag-snap-shared`; the
 * keyboard path (ArrowLeft / ArrowRight on the same handles, and the −15 / +15 min buttons) needs no pointer at all.
 */
import { useCallback, useRef, useState, type PointerEvent } from "react";
import type { EditOp } from "@/lib/scheduling/edit-shared";
import { dragToOp, type Handle, type HandleShift } from "./use-drag-snap-shared";

export interface DragPreview { handle: Handle; dq: number }

export function useDragSnap(shift: HandleShift, pxPerQ: () => number, onCommit: (op: EditOp) => void, enabled: boolean) {
  const start = useRef<{ x: number; handle: Handle; pointerId: number } | null>(null);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const onPointerDown = useCallback((handle: Handle) => (e: PointerEvent<HTMLElement>) => {
    if (!enabled || e.button !== 0) return;
    e.stopPropagation();
    start.current = { x: e.clientX, handle, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [enabled]);
  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const per = pxPerQ();
    const raw = per > 0 ? (e.clientX - s.x) / per : 0;
    const dq = Math.sign(raw) * Math.round(Math.abs(raw));
    setPreview(dq === 0 ? null : { handle: s.handle, dq });
  }, [pxPerQ]);
  const onPointerUp = useCallback((e: PointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s || e.pointerId !== s.pointerId) return;
    start.current = null;
    setPreview(null);
    const op = dragToOp(e.clientX - s.x, pxPerQ(), s.handle, shift);
    if (op) onCommit(op);
  }, [onCommit, pxPerQ, shift]);
  const onPointerCancel = useCallback(() => { start.current = null; setPreview(null); }, []);
  return { preview, onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
