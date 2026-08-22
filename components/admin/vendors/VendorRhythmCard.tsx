"use client";

/**
 * VendorRhythmCard — the per-location order→delivery PAIR editor (Dynamic Pars Phase 1,
 * Task 1.4). Rides the EXISTING vendor detail page beneath the weekly-schedule card; this
 * arc adds NO admin page (AGENTS.md: read surfaces over new workflows).
 *
 * WHY PAIRS AND NOT TWO DAY STRIPS. The schedule card above already carries order_days and
 * delivery_days as two independent strips, and they DO NOT MAP: a vendor taking orders three
 * days a week may run trucks on two, and nothing in two parallel strips says which order
 * lands on which truck. One row here IS the pair, and the arrival day is DERIVED
 * (deliveryDowFor — the same arithmetic as the DB's GENERATED column), never typed.
 *
 * WHY THE LOCATION SELECT HAS NO "BOTH SHOPS" OPTION. Unlike cutoffs, a rhythm row is
 * per-shop by construction (migration 0182: location_id NOT NULL). A phone deadline is
 * usually one phone system; the trucks are not. The select must not offer what the schema
 * refuses.
 *
 * Grammar: admin-form (rounded-lg, 44px floor + items-center, border-co-gold-deep on the
 * primary, control labels tracking-[0.1em]). ActionButton's operational grammar is NOT
 * mixed in on this page.
 *
 * Disclosure Doctrine: CollapsibleSection, default-collapsed, i18n'd count on the header.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { deliveryDowFor } from "@/lib/vendor-rhythm-shared";
import type { RhythmPairView, RhythmSkipView } from "@/lib/vendor-rhythm";
import type { SkuFormLocationOption } from "@/components/admin/skus/SkuBuilder";
import { postJson, resolveErrorKey } from "./shared";

const DOWS = [0, 1, 2, 3, 4, 5, 6] as const;

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-co-text-dim">{label}</span>
      {children}
    </label>
  );
}

function PrimaryBtn({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function PlainBtn({
  label,
  ariaLabel,
  disabled,
  onClick,
}: {
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

type StepUp = (tier: "A" | "B") => Promise<"ok" | "cancelled">;

export function VendorRhythmCard({
  vendorId,
  pairs,
  skips,
  locations,
  schemaReady,
  canAppend,
  canManage,
  requestStepUp,
}: {
  vendorId: string;
  /** Active pairs for this vendor across every shop. Empty while 0182 is pending. */
  pairs: RhythmPairView[];
  /** Active, not-yet-expired outage windows. Empty while 0182 is pending. */
  skips: RhythmSkipView[];
  /** Active locations — the pair editor's required shop select. */
  locations: SkuFormLocationOption[];
  /** False until migration 0182 (GATE M1) is applied; the card says so and offers nothing. */
  schemaReady: boolean;
  canAppend: boolean; // AGM+ (6)
  canManage: boolean; // GM+ (7)
  requestStepUp: StepUp;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Pair add-form.
  const [addingPair, setAddingPair] = useState(false);
  const [pairLoc, setPairLoc] = useState("");
  const [pairDow, setPairDow] = useState(1); // Monday
  const [pairLead, setPairLead] = useState("1");
  const [confirmPairId, setConfirmPairId] = useState<string | null>(null);

  // Skip add-form.
  const [addingSkip, setAddingSkip] = useState(false);
  const [skipLoc, setSkipLoc] = useState("");
  const [skipFrom, setSkipFrom] = useState("");
  const [skipThrough, setSkipThrough] = useState("");
  const [skipNote, setSkipNote] = useState("");
  const [confirmSkipId, setConfirmSkipId] = useState<string | null>(null);

  // Day names are shared with the cutoffs card — one vocabulary, not two.
  const dayLabel = (d: number) => t(`admin.vendors.cutoff.day.${d}` as TranslationKey);
  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;

  const leadNum = Number(pairLead);
  const leadValid = Number.isInteger(leadNum) && leadNum >= 0 && leadNum <= 14;
  const previewDow = leadValid ? deliveryDowFor(pairDow, leadNum) : null;

  const resetPair = () => {
    setPairLoc("");
    setPairDow(1);
    setPairLead("1");
    setAddingPair(false);
  };

  const resetSkip = () => {
    setSkipLoc("");
    setSkipFrom("");
    setSkipThrough("");
    setSkipNote("");
    setAddingSkip(false);
  };

  const addPair = async () => {
    if (busy || !pairLoc || !leadValid) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/vendors/${vendorId}/rhythm`, {
      locationId: pairLoc,
      orderDow: pairDow,
      leadDays: leadNum,
    });
    setBusy(false);
    if (result.ok) {
      resetPair();
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const removePair = async (rhythmId: string) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/vendors/${vendorId}/rhythm`, { rhythmId }, "DELETE");
    setBusy(false);
    if (result.ok) {
      setConfirmPairId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const addSkip = async () => {
    if (busy || !skipLoc || !skipFrom || !skipThrough) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/vendors/${vendorId}/rhythm/skips`, {
      locationId: skipLoc,
      skipFrom,
      skipThrough,
      note: skipNote.trim() || null,
    });
    setBusy(false);
    if (result.ok) {
      resetSkip();
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const removeSkip = async (skipId: string) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/vendors/${vendorId}/rhythm/skips`, { skipId }, "DELETE");
    setBusy(false);
    if (result.ok) {
      setConfirmSkipId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  // Pairs grouped by shop — the whole point of the surface is that the two shops can
  // legitimately differ, so they are never merged into one list.
  const byLocation = locations
    .map((loc) => ({ loc, rows: pairs.filter((p) => p.locationId === loc.id) }))
    .filter((g) => g.rows.length > 0 || locations.length > 0);

  return (
    <CollapsibleSection
      idBase={`vendor-rhythm-${vendorId}`}
      title={t("admin.vendors.rhythm.title")}
      count={t("admin.vendors.rhythm.count", { n: String(pairs.length) })}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-co-text-muted">{t("admin.vendors.rhythm.explainer")}</p>

        {!schemaReady ? (
          <p className="rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-2 text-sm text-co-warning-text">
            {t("admin.vendors.rhythm.schema_pending")}
          </p>
        ) : (
          <>
            {/* ── The authored pairs, per shop ── */}
            {byLocation.map(({ loc, rows }) => (
              <div key={loc.id} className="flex flex-col gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{loc.name}</h3>
                {rows.length === 0 ? (
                  <p className="text-sm text-co-warning-text">{t("admin.vendors.rhythm.none_for_shop")}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {rows.map((p) => (
                      <li key={p.id} className="rounded-lg border-2 border-co-border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm text-co-text">
                            <div className="font-bold">
                              {t("admin.vendors.rhythm.pair", {
                                order: dayLabel(p.orderDow),
                                delivery: dayLabel(p.deliveryDow),
                              })}
                            </div>
                            <div className="text-co-text-muted">
                              {p.leadDays === 0
                                ? t("admin.vendors.rhythm.lead_same_day")
                                : t("admin.vendors.rhythm.lead_days", { n: String(p.leadDays) })}
                            </div>
                          </div>
                          {canManage ? (
                            <div className="flex items-center gap-2">
                              {confirmPairId === p.id ? (
                                <>
                                  <PlainBtn
                                    label={t("admin.vendors.cancel")}
                                    disabled={busy}
                                    onClick={() => setConfirmPairId(null)}
                                  />
                                  <PlainBtn
                                    label={t("admin.vendors.confirm_remove")}
                                    disabled={busy}
                                    onClick={() => void removePair(p.id)}
                                  />
                                </>
                              ) : (
                                <PlainBtn
                                  label={t("admin.vendors.remove")}
                                  ariaLabel={t("admin.vendors.rhythm.remove_aria", {
                                    order: dayLabel(p.orderDow),
                                    shop: loc.name,
                                  })}
                                  onClick={() => setConfirmPairId(p.id)}
                                />
                              )}
                            </div>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

            {errorMsg ? <p className="text-sm text-co-cta-text">{errorMsg}</p> : null}

            {/* ── Add a pair ── */}
            {canAppend ? (
              addingPair ? (
                <div className="flex flex-col gap-2 rounded-lg border-2 border-dashed border-co-border p-3">
                  <Labeled label={t("admin.vendors.rhythm.shop_label")}>
                    <select
                      className={fieldCls}
                      value={pairLoc}
                      disabled={busy}
                      onChange={(e) => setPairLoc(e.target.value)}
                    >
                      {/* No "Both shops" option — migration 0182 forbids an all-shops row. */}
                      <option value="">{t("admin.vendors.rhythm.shop_placeholder")}</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </Labeled>
                  <Labeled label={t("admin.vendors.rhythm.order_day_label")}>
                    <select
                      className={fieldCls}
                      value={String(pairDow)}
                      disabled={busy}
                      onChange={(e) => setPairDow(Number(e.target.value))}
                    >
                      {DOWS.map((d) => (
                        <option key={d} value={d}>
                          {dayLabel(d)}
                        </option>
                      ))}
                    </select>
                  </Labeled>
                  <Labeled label={t("admin.vendors.rhythm.lead_label")}>
                    <input
                      className={fieldCls}
                      type="number"
                      min={0}
                      max={14}
                      step={1}
                      inputMode="numeric"
                      value={pairLead}
                      disabled={busy}
                      aria-label={t("admin.vendors.rhythm.lead_label")}
                      onChange={(e) => setPairLead(e.target.value)}
                    />
                  </Labeled>
                  <p className="text-sm text-co-text-muted" aria-live="polite">
                    {previewDow == null
                      ? t("admin.vendors.rhythm.lead_invalid")
                      : t("admin.vendors.rhythm.preview", {
                          order: dayLabel(pairDow),
                          delivery: dayLabel(previewDow),
                        })}
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <PlainBtn label={t("admin.vendors.cancel")} disabled={busy} onClick={resetPair} />
                    <PrimaryBtn
                      label={t("admin.vendors.add")}
                      disabled={busy || !pairLoc || !leadValid}
                      onClick={() => void addPair()}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <PlainBtn label={t("admin.vendors.rhythm.add")} onClick={() => setAddingPair(true)} />
                </div>
              )
            ) : null}

            {/* ── Vendor-down skips ── */}
            <div className="flex flex-col gap-2 border-t-2 border-co-border pt-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">
                {t("admin.vendors.rhythm.skip.title")}
              </h3>
              <p className="text-sm text-co-text-muted">{t("admin.vendors.rhythm.skip.explainer")}</p>

              {skips.length === 0 ? (
                <p className="text-sm text-co-text-muted">{t("admin.vendors.rhythm.skip.empty")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {skips.map((s) => (
                    <li key={s.id} className="rounded-lg border-2 border-co-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm text-co-text">
                          <div className="font-bold">
                            {t("admin.vendors.rhythm.skip.range", { from: s.skipFrom, through: s.skipThrough })}
                          </div>
                          <div className="text-co-text-muted">
                            {locName(s.locationId)}
                            {s.note ? ` · ${s.note}` : ""}
                          </div>
                        </div>
                        {canManage ? (
                          <div className="flex items-center gap-2">
                            {confirmSkipId === s.id ? (
                              <>
                                <PlainBtn
                                  label={t("admin.vendors.cancel")}
                                  disabled={busy}
                                  onClick={() => setConfirmSkipId(null)}
                                />
                                <PlainBtn
                                  label={t("admin.vendors.confirm_remove")}
                                  disabled={busy}
                                  onClick={() => void removeSkip(s.id)}
                                />
                              </>
                            ) : (
                              <PlainBtn
                                label={t("admin.vendors.remove")}
                                ariaLabel={t("admin.vendors.rhythm.skip.remove_aria", {
                                  from: s.skipFrom,
                                  through: s.skipThrough,
                                })}
                                onClick={() => setConfirmSkipId(s.id)}
                              />
                            )}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {canAppend ? (
                addingSkip ? (
                  <div className="flex flex-col gap-2 rounded-lg border-2 border-dashed border-co-border p-3">
                    <Labeled label={t("admin.vendors.rhythm.shop_label")}>
                      <select
                        className={fieldCls}
                        value={skipLoc}
                        disabled={busy}
                        onChange={(e) => setSkipLoc(e.target.value)}
                      >
                        <option value="">{t("admin.vendors.rhythm.shop_placeholder")}</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </Labeled>
                    <div className="grid grid-cols-2 gap-3">
                      <Labeled label={t("admin.vendors.rhythm.skip.from_label")}>
                        <input
                          className={fieldCls}
                          type="date"
                          value={skipFrom}
                          disabled={busy}
                          aria-label={t("admin.vendors.rhythm.skip.from_label")}
                          onChange={(e) => setSkipFrom(e.target.value)}
                        />
                      </Labeled>
                      <Labeled label={t("admin.vendors.rhythm.skip.through_label")}>
                        <input
                          className={fieldCls}
                          type="date"
                          value={skipThrough}
                          disabled={busy}
                          aria-label={t("admin.vendors.rhythm.skip.through_label")}
                          onChange={(e) => setSkipThrough(e.target.value)}
                        />
                      </Labeled>
                    </div>
                    <Labeled label={t("admin.vendors.rhythm.skip.note_label")}>
                      <input
                        className={fieldCls}
                        value={skipNote}
                        disabled={busy}
                        aria-label={t("admin.vendors.rhythm.skip.note_label")}
                        onChange={(e) => setSkipNote(e.target.value)}
                      />
                    </Labeled>
                    <div className="flex items-center justify-end gap-2">
                      <PlainBtn label={t("admin.vendors.cancel")} disabled={busy} onClick={resetSkip} />
                      <PrimaryBtn
                        label={t("admin.vendors.add")}
                        disabled={busy || !skipLoc || !skipFrom || !skipThrough}
                        onClick={() => void addSkip()}
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <PlainBtn label={t("admin.vendors.rhythm.skip.add")} onClick={() => setAddingSkip(true)} />
                  </div>
                )
              ) : null}
            </div>
          </>
        )}
      </div>
    </CollapsibleSection>
  );
}
