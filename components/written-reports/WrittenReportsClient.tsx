"use client";

/**
 * WrittenReportsClient — the list + create/edit surface for Written Reports.
 *
 * Owns the POST /api/written-reports (create) and PATCH /api/written-reports/[id]
 * (self-edit within the 3h window) calls + router.refresh on success. The server
 * page passes the already-authorized list (visibility gated server-side) and the
 * viewer's write capability. Phone-first, i18n'd, append-only (no delete).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { formatTime } from "@/lib/i18n/format";
import type { RoleCode } from "@/lib/roles";
import type { WrittenReportListItem } from "@/lib/written-reports";

import { AlertPill, type AlertPillTone } from "@/components/ui/AlertPill";
import { EmptyState } from "@/components/EmptyState";
import { WrittenReportForm, type WrittenReportFormValues } from "./WrittenReportForm";

/** Category → pill tone (incident = danger; the rest informational/warn). */
function categoryTone(category: string | null): AlertPillTone {
  if (category === "incident") return "danger";
  if (category === "request") return "warn";
  return "info";
}

/** ISO timestamp → localized "date · time" via the shared formatters. */
function stampLabel(iso: string, language: "en" | "es"): string {
  if (!iso) return "";
  const ymd = iso.slice(0, 10);
  const time = formatTime(iso, language);
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return time;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const locale = language === "es" ? "es-US" : "en-US";
  const dateStr = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
  return time ? `${dateStr} · ${time}` : dateStr;
}

export function WrittenReportsClient({
  reports,
  canWrite,
  viewerLevel,
}: {
  reports: WrittenReportListItem[];
  canWrite: boolean;
  viewerLevel: number;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const translateRole = (role: RoleCode) => t(`role.${role}` as TranslationKey);

  const errText = (code: string | undefined): string => {
    const key = `written_reports.error.${code ?? "generic"}`;
    const msg = t(key as TranslationKey);
    // Fall back to a generic message when the key isn't mapped.
    return msg === key ? t("written_reports.error.generic") : msg;
  };

  const doCreate = async (values: WrittenReportFormValues) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/written-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        redirect: "manual",
      });
      if (res.ok) {
        setAdding(false);
        router.refresh();
      } else {
        const body: { code?: string } = await res.json().catch(() => ({}));
        setErrorMsg(errText(body.code));
      }
    } catch {
      setErrorMsg(errText("generic"));
    } finally {
      setBusy(false);
    }
  };

  const doEdit = async (id: string, values: WrittenReportFormValues) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/written-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        redirect: "manual",
      });
      if (res.ok) {
        setEditingId(null);
        router.refresh();
      } else {
        const body: { code?: string } = await res.json().catch(() => ({}));
        setErrorMsg(errText(body.code));
      }
    } catch {
      setErrorMsg(errText("generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Add affordance / add form */}
      {canWrite ? (
        adding ? (
          <WrittenReportForm
            viewerLevel={viewerLevel}
            busy={busy}
            errorMsg={errorMsg}
            submitLabel={t("written_reports.submit_new")}
            translateRole={translateRole}
            onSubmit={doCreate}
            onCancel={() => {
              setAdding(false);
              setErrorMsg(null);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
              setErrorMsg(null);
            }}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          >
            {t("written_reports.new")}
          </button>
        )
      ) : null}

      {reports.length === 0 ? (
        <EmptyState message={t("written_reports.empty")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((r) => {
            const isEditing = editingId === r.id;
            return (
              <li key={r.id} className="co-card p-4">
                {isEditing ? (
                  <WrittenReportForm
                    initial={{
                      title: r.title,
                      body: r.body,
                      category: (r.category as WrittenReportFormValues["category"]) ?? null,
                      visibilityMinLevel: r.visibilityMinLevel,
                    }}
                    viewerLevel={viewerLevel}
                    busy={busy}
                    errorMsg={errorMsg}
                    submitLabel={t("written_reports.submit_edit")}
                    translateRole={translateRole}
                    onSubmit={(values) => void doEdit(r.id, values)}
                    onCancel={() => {
                      setEditingId(null);
                      setErrorMsg(null);
                    }}
                  />
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {r.category ? (
                        <AlertPill tone={categoryTone(r.category)}>
                          {t(`written_reports.category.${r.category}` as TranslationKey)}
                        </AlertPill>
                      ) : null}
                      {r.title ? (
                        <span className="text-base font-extrabold text-co-text">{r.title}</span>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-co-text">{r.body}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-co-text-muted">
                      <span>{r.submittedByName ?? "—"}</span>
                      <span aria-hidden>·</span>
                      <span>{stampLabel(r.submittedAt, language)}</span>
                      {r.editCount > 0 ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>{t("written_reports.edited")}</span>
                        </>
                      ) : null}
                      {r.visibilityMinLevel > 3 ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>{t("written_reports.restricted")}</span>
                        </>
                      ) : null}
                      {r.canEdit ? (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(r.id);
                            setAdding(false);
                            setErrorMsg(null);
                          }}
                          className="ml-auto inline-flex min-h-[44px] items-center rounded-md px-2 text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted transition hover:text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                        >
                          {t("written_reports.edit")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
