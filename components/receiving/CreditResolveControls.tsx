"use client";

/**
 * CreditResolveControls — the delivery-detail vendor-credits section (spec D3, Task 7).
 *
 * Renders every credit filed against this delivery (identity + reason + status are
 * always visible — Disclosure Doctrine D1/D2: a credit is an alert, never collapsed).
 * For AGM+ (level ≥ 6) each still-open credit exposes a resolve affordance: three
 * terminal outcomes (credit / refund / write-off) behind a second-tap inline confirm
 * (the ContactsCard `confirmRemoveId` pattern — no modal), with an optional note. On
 * success it PATCHes /api/operations/receiving/credits and router.refresh()es so the
 * server re-loads the now-resolved row.
 *
 * GATE: the resolve UI is app-layer convenience only — the API re-checks AGM+ and
 * location-binds. We inline the threshold 6 (the CREDIT_RESOLVE_MIN constant lives in
 * lib/credits.ts, which is server-only — `import "server-only"` via supabase-server —
 * so it can't be imported into a client island). Keep the two in sync.
 *
 * MONEY LAW: a null amount renders an em-dash, never $0.00.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents } from "@/lib/i18n/format";
import { ActionButton } from "@/components/ActionButton";
import { AlertPill, type AlertPillTone } from "@/components/ui/AlertPill";
import type { TranslationKey } from "@/lib/i18n/types";
import type { CreditRow } from "@/lib/credits";

/** AGM+ resolves. Mirror of lib/credits.ts CREDIT_RESOLVE_MIN (server-only module). */
const CREDIT_RESOLVE_MIN = 6;

type Outcome = "resolved_credit" | "resolved_refund" | "written_off";
const OUTCOMES: readonly Outcome[] = ["resolved_credit", "resolved_refund", "written_off"] as const;

const OUTCOME_KEY: Record<Outcome, TranslationKey> = {
  resolved_credit: "receiving.credits.outcome.credit",
  resolved_refund: "receiving.credits.outcome.refund",
  written_off: "receiving.credits.outcome.written_off",
};

/** open|in_progress = warn (still owed); a terminal outcome = neutral info. */
function statusTone(status: string): AlertPillTone {
  return status === "open" || status === "in_progress" ? "warn" : "info";
}
function statusKey(status: string): TranslationKey {
  switch (status) {
    case "open": return "receiving.credits.status.open";
    case "in_progress": return "receiving.credits.status.in_progress";
    case "resolved_credit": return "receiving.credits.status.resolved_credit";
    case "resolved_refund": return "receiving.credits.status.resolved_refund";
    case "written_off": return "receiving.credits.status.written_off";
    default: return "receiving.credits.status.open";
  }
}
function reasonKey(reason: string): TranslationKey {
  switch (reason) {
    case "short": return "receiving.flag.short";
    case "over": return "receiving.flag.over";
    case "damaged": return "receiving.flag.damaged";
    case "substitution": return "receiving.flag.sub";
    case "price_discrepancy": return "receiving.credits.reason.price";
    default: return "receiving.flag.short";
  }
}

export function CreditResolveControls({
  credits,
  actorLevel,
}: {
  credits: CreditRow[];
  actorLevel: number;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const canResolve = actorLevel >= CREDIT_RESOLVE_MIN;

  // Second-tap inline confirm: the credit id whose outcome buttons are showing.
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (credits.length === 0) return null;

  const beginResolve = (id: string) => {
    setResolvingId(id);
    setNote("");
    setErr(null);
  };
  const cancelResolve = () => {
    setResolvingId(null);
    setNote("");
    setErr(null);
  };

  const resolve = async (creditId: string, outcome: Outcome) => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    const res = await fetch("/api/operations/receiving/credits", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creditId, outcome, notes: note.trim() || null }),
    });
    setBusy(false);
    if (res.ok) {
      cancelResolve();
      router.refresh();
      return;
    }
    const j = (await res.json().catch(() => ({}))) as { code?: string };
    setErr(t(("receiving.credits.error." + (j?.code ?? "generic")) as never));
  };

  return (
    <div className="mt-5">
      <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">
        {t("receiving.credits.section_title")}
      </h2>
      <ul className="mt-2 flex flex-col gap-1.5">
        {credits.map((c) => {
          const isOpen = c.status === "open" || c.status === "in_progress";
          const resolving = resolvingId === c.id;
          return (
            <li key={c.id} className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                {/* Reason + amount = identity, always visible (D1). */}
                <span className="font-semibold text-co-text">
                  {t(reasonKey(c.reason))}
                  {c.qty != null ? ` · ${t("receiving.credits.qty", { n: c.qty })}` : ""}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-bold text-co-text">
                    {c.amountCents != null ? formatCents(c.amountCents, language) : "—"}
                  </span>
                  {/* Status = alert, always visible (D2). */}
                  <AlertPill tone={statusTone(c.status)}>{t(statusKey(c.status))}</AlertPill>
                </span>
              </div>
              {c.notes ? <p className="mt-1 text-[11px] text-co-text-dim">{c.notes}</p> : null}

              {canResolve && isOpen ? (
                resolving ? (
                  <div className="mt-2 flex flex-col gap-2 rounded-lg border-2 border-dashed border-co-border p-2">
                    <input
                      className="min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60"
                      value={note}
                      disabled={busy}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t("receiving.credits.note_placeholder")}
                      aria-label={t("receiving.credits.note_placeholder")}
                    />
                    <div className="flex flex-wrap gap-2">
                      {OUTCOMES.map((o) => (
                        <ActionButton key={o} disabled={busy} onClick={() => void resolve(c.id, o)}>
                          {t(OUTCOME_KEY[o])}
                        </ActionButton>
                      ))}
                      <ActionButton variant="secondary" disabled={busy} onClick={cancelResolve}>
                        {t("receiving.credits.cancel")}
                      </ActionButton>
                    </div>
                    {err ? <p className="text-xs text-co-cta-text">{err}</p> : null}
                  </div>
                ) : (
                  <div className="mt-2">
                    <ActionButton variant="secondary" onClick={() => beginResolve(c.id)}>
                      {t("receiving.credits.resolve")}
                    </ActionButton>
                  </div>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
