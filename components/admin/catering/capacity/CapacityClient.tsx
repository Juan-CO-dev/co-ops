"use client";

/**
 * CapacityClient — per-location capacity policy + blackout dates editor
 * (Catering KB, DOMAIN=capacity). Feeds the Wave-1B capacity gate.
 *
 * Renders one card per location the actor manages. Each card shows:
 *   (a) the active capacity policy (three nullable integer caps; null = no
 *       cap) with a Configure/Edit form — save is Tier B (create when
 *       unconfigured, in-place edit of the one active row otherwise);
 *   (b) the location's active blackout dates beneath it — add (date +
 *       optional reason) at Tier A, deactivate at Tier A.
 *
 * Every mutation calls requestStepUp(tier) first and bails if not "ok"; on a
 * failed postJson it resolves the machine code via resolveErrorKey.
 *
 * Authority mirrors the routes: MIN = 7 (catering.kb.capacity.write). All
 * write affordances are gated on actorLevel >= MIN.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { formatDateLabel } from "@/lib/i18n/format";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { CapacityPolicyView, BlackoutDateView } from "@/lib/admin/catering/capacity";
import { postJson, resolveErrorKey } from "@/components/admin/catering/shared";
import { CapacityPolicyForm, type CapacityPolicyFormValues } from "./CapacityPolicyForm";

// Route/lib floor for catering.kb.capacity.write.
const CAPACITY_MIN = 7;

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

const secondaryBtnCls =
  "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50";

export function CapacityClient({
  policies,
  blackouts,
  actorLevel,
}: {
  policies: CapacityPolicyView[];
  blackouts: BlackoutDateView[];
  actorLevel: number;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const canManage = actorLevel >= CAPACITY_MIN;
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const blackoutsByLocation = new Map<string, BlackoutDateView[]>();
  for (const b of blackouts) {
    const arr = blackoutsByLocation.get(b.locationId) ?? [];
    arr.push(b);
    blackoutsByLocation.set(b.locationId, arr);
  }

  /** Policy save — Tier B. Create when unconfigured (id=null), else in-place PATCH. */
  const savePolicy = async (policy: CapacityPolicyView, values: CapacityPolicyFormValues) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = policy.id
      ? await postJson(
          `/api/admin/catering/capacity/${policy.id}`,
          { locationId: policy.locationId, ...values },
          "PATCH",
        )
      : await postJson("/api/admin/catering/capacity", {
          locationId: policy.locationId,
          ...values,
        });
    setBusy(false);
    if (result.ok) {
      setEditingLocationId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  /** Blackout add — Tier A. Returns true on success so the row can clear its inputs. */
  const addBlackout = async (locationId: string, blackoutDate: string, reason: string): Promise<boolean> => {
    if (busy) return false;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return false;
    setBusy(true);
    const result = await postJson("/api/admin/catering/capacity", {
      locationId,
      blackoutDate,
      reason: reason.trim() || null,
    });
    setBusy(false);
    if (result.ok) {
      router.refresh();
      return true;
    }
    setErrorMsg(t(resolveErrorKey(result.code)));
    return false;
  };

  /** Blackout deactivate — Tier A. Append-only: flips active=false. */
  const removeBlackout = async (blackout: BlackoutDateView) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(
      `/api/admin/catering/capacity/${blackout.id}`,
      { locationId: blackout.locationId, active: false },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) {
      setConfirmRemoveId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const capLabel = (v: number | null): string =>
    v != null ? String(v) : t("admin.catering.capacity.no_cap" as TranslationKey);

  if (policies.length === 0) {
    return (
      <div className="mt-5 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
        {t("admin.catering.capacity.empty" as TranslationKey)}
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-3">
      {policies.map((policy) => {
        const editing = editingLocationId === policy.locationId;
        const configured = policy.id !== null;
        const locationBlackouts = blackoutsByLocation.get(policy.locationId) ?? [];
        return (
          <div key={policy.locationId} className="co-card p-4">
            {/* ── Capacity policy ─────────────────────────────────────── */}
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="text-sm text-co-text">
                <div className="flex items-center gap-2 font-bold">
                  {policy.locationName}
                  {!configured ? (
                    <span className="inline-flex items-center rounded-full bg-co-text/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text-muted">
                      {t("admin.catering.capacity.status.unconfigured" as TranslationKey)}
                    </span>
                  ) : null}
                </div>
                {!editing ? (
                  <div className="mt-1 text-co-text-muted">
                    {[
                      `${t("admin.catering.capacity.field.max_covers" as TranslationKey)}: ${capLabel(policy.maxCoversPerDay)}`,
                      `${t("admin.catering.capacity.field.max_events" as TranslationKey)}: ${capLabel(policy.maxEventsPerDay)}`,
                      `${t("admin.catering.capacity.field.min_lead_time" as TranslationKey)}: ${capLabel(policy.minLeadTimeHours)}`,
                    ].join(" · ")}
                  </div>
                ) : null}
              </div>

              {canManage && !editing ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingLocationId(policy.locationId);
                    setErrorMsg(null);
                  }}
                  className={secondaryBtnCls}
                >
                  {configured
                    ? t("admin.catering.capacity.edit" as TranslationKey)
                    : t("admin.catering.capacity.configure" as TranslationKey)}
                </button>
              ) : null}
            </div>

            {canManage && editing ? (
              <CapacityPolicyForm
                initial={policy}
                busy={busy}
                errorMsg={errorMsg}
                submitLabel={
                  configured
                    ? t("admin.catering.capacity.save" as TranslationKey)
                    : t("admin.catering.capacity.create" as TranslationKey)
                }
                onSubmit={(values) => void savePolicy(policy, values)}
                onCancel={() => {
                  setEditingLocationId(null);
                  setErrorMsg(null);
                }}
              />
            ) : null}

            {/* ── Blackout dates ──────────────────────────────────────── */}
            <div className="mt-4 border-t-2 border-co-border pt-3">
              <h3 className="text-sm font-bold text-co-text">
                {t("admin.catering.capacity.blackouts.heading" as TranslationKey)}
              </h3>

              {locationBlackouts.length === 0 ? (
                <p className="mt-1 text-sm text-co-text-muted">
                  {t("admin.catering.capacity.blackouts.empty" as TranslationKey)}
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {locationBlackouts.map((b) => {
                    const dateLabel = formatDateLabel(b.blackoutDate, language);
                    const confirming = confirmRemoveId === b.id;
                    return (
                      <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="text-co-text">
                          <span className="font-bold">{dateLabel}</span>
                          {b.reason ? <span className="text-co-text-muted"> · {b.reason}</span> : null}
                        </span>
                        {canManage ? (
                          confirming ? (
                            <span className="flex gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmRemoveId(null)}
                                className={secondaryBtnCls}
                              >
                                {t("admin.catering.capacity.cancel" as TranslationKey)}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                aria-label={t("admin.catering.capacity.blackouts.remove_aria" as TranslationKey, { date: dateLabel })}
                                onClick={() => void removeBlackout(b)}
                                className={secondaryBtnCls}
                              >
                                {t("admin.catering.capacity.blackouts.remove" as TranslationKey)}
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={t("admin.catering.capacity.blackouts.remove_aria" as TranslationKey, { date: dateLabel })}
                              onClick={() => setConfirmRemoveId(b.id)}
                              className={secondaryBtnCls}
                            >
                              {t("admin.catering.capacity.blackouts.remove" as TranslationKey)}
                            </button>
                          )
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}

              {canManage ? (
                <BlackoutAddRow
                  busy={busy}
                  onAdd={(date, reason) => addBlackout(policy.locationId, date, reason)}
                />
              ) : null}
            </div>
          </div>
        );
      })}

      {errorMsg && editingLocationId === null ? (
        <p className="text-sm text-co-cta">{errorMsg}</p>
      ) : null}
    </div>
  );
}

/** Inline add row for a blackout (date + optional reason). Local input state
 *  only — the parent owns step-up (Tier A) + POST + refresh via onAdd. */
function BlackoutAddRow({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (date: string, reason: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");

  const canAdd = date.trim() !== "" && !busy;

  const submit = async () => {
    if (!canAdd) return;
    const ok = await onAdd(date.trim(), reason);
    if (ok) {
      setDate("");
      setReason("");
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <label className="block">
        <span className="text-sm font-bold text-co-text">
          {t("admin.catering.capacity.blackouts.date" as TranslationKey)}
        </span>
        <input
          className={fieldCls}
          type="date"
          value={date}
          disabled={busy}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label className="block grow">
        <span className="text-sm font-bold text-co-text">
          {t("admin.catering.capacity.blackouts.reason" as TranslationKey)}
        </span>
        <input
          className={fieldCls}
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={!canAdd}
        onClick={() => void submit()}
        className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("admin.catering.capacity.blackouts.add" as TranslationKey)}
      </button>
    </div>
  );
}
