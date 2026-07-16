"use client";

/**
 * ZonesClient — per-location catering delivery-zone editor (/admin/catering/zones).
 * Groups zones by location (the server loader already filtered to the actor's
 * accessible locations: level ≥ 9 = all, else user_locations). Each location
 * card lists its zones (label EN/ES, fee, optional min order) with (GM+ ≥7)
 * Add / Edit / Deactivate affordances.
 *
 * Authority (matches the routes + lib): create = Tier B; edit fee/labels =
 * Tier A; deactivate/reactivate = Tier B. Before every mutation the client
 * requests step-up; on failure it resolves the error code to a localized
 * message via resolveErrorKey.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { formatCents } from "@/lib/i18n/format";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { ZoneLocationGroup, ZoneView } from "@/lib/admin/catering/zones";
import { postJson, resolveErrorKey } from "@/components/admin/catering/shared";
import { ZoneForm, type ZoneFormValues } from "./ZoneForm";

/** Mirrors the route + lib floor (catering.kb.delivery_zones.write = 7, GM+). */
const ZONE_WRITE_MIN = 7;

export function ZonesClient({
  groups,
  actorLevel,
}: {
  groups: ZoneLocationGroup[];
  actorLevel: number;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const canManage = actorLevel >= ZONE_WRITE_MIN;

  const [addingLocationId, setAddingLocationId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const create = async (locationId: string, values: ZoneFormValues) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson("/api/admin/catering/zones", { locationId, ...values });
    setBusy(false);
    if (result.ok) {
      setAddingLocationId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const saveEdit = async (id: string, values: ZoneFormValues) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/catering/zones/${id}`, values, "PATCH");
    setBusy(false);
    if (result.ok) {
      setEditingId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const toggleActive = async (zone: ZoneView) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/catering/zones/${zone.id}`, { active: !zone.active }, "PATCH");
    setBusy(false);
    if (result.ok) {
      setConfirmDeactivateId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  if (groups.length === 0) {
    return (
      <div className="mt-5 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
        {t("admin.catering.zones.no_locations" as TranslationKey)}
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.locationId}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-base font-extrabold text-co-text">
              {g.name} <span className="font-normal text-co-text-muted">({g.code})</span>
            </h2>
            {canManage && addingLocationId !== g.locationId ? (
              <button
                type="button"
                onClick={() => {
                  setAddingLocationId(g.locationId);
                  setEditingId(null);
                  setErrorMsg(null);
                }}
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              >
                {t("admin.catering.zones.add_zone" as TranslationKey)}
              </button>
            ) : null}
          </div>

          {addingLocationId === g.locationId ? (
            <div className="mt-3">
              <ZoneForm
                busy={busy}
                errorMsg={errorMsg}
                submitLabel={t("admin.catering.zones.add" as TranslationKey)}
                onSubmit={(values) => void create(g.locationId, values)}
                onCancel={() => {
                  setAddingLocationId(null);
                  setErrorMsg(null);
                }}
              />
            </div>
          ) : null}

          {g.zones.length === 0 ? (
            <div className="mt-3 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
              {t("admin.catering.zones.empty" as TranslationKey)}
            </div>
          ) : (
            <ul
              className="mt-3 flex flex-col gap-2"
              aria-label={t("admin.catering.zones.list_aria" as TranslationKey, { name: g.name })}
            >
              {g.zones.map((z) => (
                <li
                  key={z.id}
                  className={"rounded-lg border-2 border-co-border bg-co-surface p-3 " + (z.active ? "" : "opacity-60")}
                >
                  {editingId === z.id ? (
                    <ZoneForm
                      initial={z}
                      busy={busy}
                      errorMsg={errorMsg}
                      submitLabel={t("admin.catering.zones.save" as TranslationKey)}
                      onSubmit={(values) => void saveEdit(z.id, values)}
                      onCancel={() => {
                        setEditingId(null);
                        setErrorMsg(null);
                      }}
                    />
                  ) : (
                    <ZoneRow
                      zone={z}
                      language={language}
                      canManage={canManage}
                      confirming={confirmDeactivateId === z.id}
                      busy={busy}
                      onEdit={() => {
                        setEditingId(z.id);
                        setAddingLocationId(null);
                        setErrorMsg(null);
                      }}
                      onAskDeactivate={() => setConfirmDeactivateId(z.id)}
                      onCancelDeactivate={() => setConfirmDeactivateId(null)}
                      onConfirmDeactivate={() => void toggleActive(z)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {errorMsg && editingId === null && addingLocationId === null ? (
        <p className="text-sm text-co-cta">{errorMsg}</p>
      ) : null}
    </div>
  );
}

/** Read row: label EN (+ES muted) · fee · optional min order · inactive badge. */
function ZoneRow({
  zone: z,
  language,
  canManage,
  confirming,
  busy,
  onEdit,
  onAskDeactivate,
  onCancelDeactivate,
  onConfirmDeactivate,
}: {
  zone: ZoneView;
  language: Language;
  canManage: boolean;
  confirming: boolean;
  busy: boolean;
  onEdit: () => void;
  onAskDeactivate: () => void;
  onCancelDeactivate: () => void;
  onConfirmDeactivate: () => void;
}) {
  const { t } = useTranslation();
  const meta: string[] = [];
  meta.push(`${t("admin.catering.zones.fee" as TranslationKey)}: ${formatCents(z.feeCents, language)}`);
  if (z.minOrderCents != null) {
    meta.push(`${t("admin.catering.zones.min_order" as TranslationKey)}: ${formatCents(z.minOrderCents, language)}`);
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="text-sm text-co-text">
        <div className="flex items-center gap-2 font-bold">
          {z.labelEn}
          {z.labelEs ? <span className="font-normal text-co-text-muted">· {z.labelEs}</span> : null}
          {!z.active ? (
            <span className="inline-flex items-center rounded-full bg-co-text/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text-muted">
              {t("admin.catering.zones.status.inactive" as TranslationKey)}
            </span>
          ) : null}
        </div>
        <div className="text-co-text-muted">{meta.join(" · ")}</div>
      </div>
      {canManage ? (
        <div className="flex gap-2">
          {confirming ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onCancelDeactivate}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
              >
                {t("admin.catering.zones.cancel" as TranslationKey)}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onConfirmDeactivate}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
              >
                {z.active
                  ? t("admin.catering.zones.deactivate" as TranslationKey)
                  : t("admin.catering.zones.reactivate" as TranslationKey)}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              >
                {t("admin.catering.zones.edit" as TranslationKey)}
              </button>
              <button
                type="button"
                onClick={onAskDeactivate}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              >
                {z.active
                  ? t("admin.catering.zones.deactivate" as TranslationKey)
                  : t("admin.catering.zones.reactivate" as TranslationKey)}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
