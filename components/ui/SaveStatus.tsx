"use client";

import type { ReactNode } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { SavePhase } from "@/lib/save-status-shared";

/** A reserved row height so a status change does not move controls under a finger. */
export function SaveStatusFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex min-h-[44px] flex-wrap items-center gap-2 text-[11px] ${className}`.trim()}>{children}</div>;
}

export function SaveStatus({ phase, onRetry, detail, className = "" }: {
  phase: SavePhase | "retrying";
  onRetry?: () => void;
  detail?: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  if (phase === "idle") return null;
  const label = phase === "retrying" ? t("save_status.retrying")
    : phase === "saving" ? t("save_status.saving")
      : phase === "saved" ? t("save_status.saved") : t("save_status.failed");
  return <SaveStatusFrame className={className}>
    <span role={phase === "failed" ? "alert" : "status"} className={phase === "failed" ? "font-bold text-co-cta-text" : "text-co-text-muted"}>
      {detail ?? label}
    </span>
    {phase === "failed" && onRetry ? <button type="button" onClick={onRetry}
      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta-text bg-co-surface px-3 font-bold text-co-cta-text focus-visible:ring-4 focus-visible:ring-co-gold/60">
      {t("save_status.retry")}
    </button> : null}
  </SaveStatusFrame>;
}
