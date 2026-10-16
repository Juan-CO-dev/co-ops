"use client";
/**
 * The rules badge (spec §6.5; mockup v15 `renderRules`): "Schedule rules: all checks pass" or "N problems", opening the
 * named problems (rule key + params, en / es), each with its day, person, position and time. Problems NEW on this
 * version come first; problems carried from an earlier version wear "Earlier problem" and sit apart (they never block
 * Approve, except an unresolved gap). The count stays on the closed header (D2, D5); the list is a full-row toggle (D8).
 */
import { useId, useState } from "react";
import { formatDateLabel } from "@/lib/i18n/format";
import type { ProblemLine } from "@/lib/scheduling/board-view-shared";
import { formatQ } from "@/lib/scheduling/time-shared";
import { useBoardLine } from "./use-board-line";

export function RulesBadge({ fresh, inherited, names, positions, defaultOpen = false }: {
  fresh: ProblemLine[];
  inherited: ProblemLine[];
  names: Record<string, string>;
  positions: Record<string, { name: string; nameEs: string | null }>;
  defaultOpen?: boolean;
}) {
  const { t, language, line, name, position } = useBoardLine({ names, positions });
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const n = fresh.length + inherited.length;
  const failing = fresh.some((p) => p.severity === "error");
  const where = (p: ProblemLine) => [formatDateLabel(p.date, language), p.userId ? name(p.userId) : null, p.positionId ? position(p.positionId) : null, p.q !== null ? formatQ(p.q, language) : null]
    .filter(Boolean).join(" · ");
  const item = (p: ProblemLine, earlier: boolean, i: number) => (
    <li key={`${earlier ? "e" : "n"}${i}`} className="grid gap-0.5" data-problem={p.code} data-severity={p.severity}>
      <span className="text-xs text-co-text-dim">{where(p)}{earlier ? <> · <span className="rounded bg-co-surface-2 px-1 font-bold text-co-text-muted">{t("schedule.board.problem.earlier")}</span></> : null}</span>
      <span className={p.severity === "error" ? "font-bold text-co-cta-text" : p.severity === "gap" ? "text-co-warning-text" : "text-co-text"}>{line(p.line)}</span>
    </li>
  );
  return (
    <section className={`co-card ${failing ? "border-2 border-co-cta-text" : ""}`} data-section="rules">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 text-left">
        <span className={`font-bold ${n === 0 ? "text-co-confirm-text" : failing ? "text-co-cta-text" : "text-co-warning-text"}`}>
          {n === 0 ? t("schedule.board.rules.pass") : t("schedule.board.rules.problems", { n })}
        </span>
        <span aria-hidden="true" className="text-co-text-dim">{open ? "⌃" : "⌄"}</span>
      </button>
      {open ? (
        <div id={id} className="grid gap-3 px-4 pb-4">
          {n === 0 ? <p className="text-sm text-co-confirm-text">{t("schedule.board.rules.pass_detail")}</p> : null}
          {fresh.length > 0 ? <ul className="grid gap-2 text-sm">{fresh.map((p, i) => item(p, false, i))}</ul> : null}
          {inherited.length > 0 ? (
            <div className="grid gap-1">
              <h3 className="text-xs font-bold tracking-wide text-co-text-muted">{t("schedule.board.rules.earlier_title", { n: inherited.length })}</h3>
              <ul className="grid gap-2 text-sm">{inherited.map((p, i) => item(p, true, i))}</ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
