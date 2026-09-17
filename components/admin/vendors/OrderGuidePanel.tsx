"use client";

/**
 * OrderGuidePanel — the vendor's order guide, edited the way the laminate is read (V3-A §6).
 *
 * WHY A LOCAL REDUCER AND ONE SAVE. Every button here runs the PURE `applyGuideEdit` against
 * the model in state; nothing round-trips until "Save order". That is not an optimisation —
 * it is what makes the `updated_at` precondition meaningful. The manager takes the guide,
 * rearranges it, and hands the whole thing back with the token it came with; if anyone else
 * saved in between the server refuses with 409 `guide_stale` and we reload rather than
 * silently overwriting their work (spec §7).
 *
 * THE REDUCER COMES FROM `@/lib/order-guides-shared`, NEVER `@/lib/order-guides` — the latter
 * imports the service-role client (`server-only`) and importing it from a client island fails
 * the build (AGENTS.md § Module boundaries).
 *
 * WHY ▲ ▼ AND NOT DRAG AND DROP. This is used on a phone, one-handed, next to a stack of
 * cases. Every control is a 44px tap target and a reorder is two taps, not a gesture that
 * needs a steady hand (spec §6).
 *
 * THE BUCKET IS DERIVED, NOT TRACKED. "Active SKUs not on the guide" is computed from the
 * catalog the server sent plus the SKUs the current model carries, so removing a line puts
 * its SKU straight back in the bucket with no bookkeeping to get out of step.
 *
 * Grammar: admin-form (rounded-lg, 44px floor + items-center, border-co-gold-deep on the
 * primary, control labels tracking-[0.1em]) — the same one VendorRhythmCard runs.
 */

import { useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { applyGuideEdit, OrderGuideError, type GuideEdit, type GuideModel } from "@/lib/order-guides-shared";
import { postJson, resolveErrorKey } from "./shared";

export interface GuideBucketSku {
  skuId: string;
  name: string;
  itemNumber: string | null;
}

export interface OrderGuideInitial {
  guide: GuideModel | null;
  skusNotOnGuide: GuideBucketSku[];
}

const fieldCls =
  "min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

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
      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

export function OrderGuidePanel({
  vendorId,
  vendorName,
  initial,
  canEdit,
}: {
  vendorId: string;
  vendorName: string;
  /** Server-rendered guide + the vendor's active SKUs no line already carries. */
  initial: OrderGuideInitial;
  /** GM+ (ORDER_GUIDE_EDIT_MIN). False → the guide reads, and nothing more. */
  canEdit: boolean;
}) {
  const { t } = useTranslation();

  // `baseline` is the last state the SERVER agreed to; `model` is what the manager is
  // building on top of it. Discard is "baseline again", which is why they are two values.
  const [baseline, setBaseline] = useState<OrderGuideInitial>(initial);
  const [model, setModel] = useState<GuideModel | null>(initial.guide);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newSection, setNewSection] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const url = `/api/admin/vendors/${vendorId}/order-guide`;

  /** Every SKU we know a name for: the server's bucket plus whatever the guide already carries. */
  const catalog = useMemo(() => {
    const map = new Map<string, GuideBucketSku>();
    for (const s of baseline.skusNotOnGuide) map.set(s.skuId, s);
    for (const s of baseline.guide?.sections ?? []) {
      for (const l of s.lines) {
        if (l.skuId && !map.has(l.skuId)) map.set(l.skuId, { skuId: l.skuId, name: l.label, itemNumber: l.itemNumber });
      }
    }
    return map;
  }, [baseline]);

  const placed = useMemo(() => {
    const set = new Set<string>();
    for (const s of model?.sections ?? []) for (const l of s.lines) if (l.skuId) set.add(l.skuId);
    return set;
  }, [model]);

  const bucket = useMemo(
    () => [...catalog.values()].filter((s) => !placed.has(s.skuId)).sort((a, b) => a.name.localeCompare(b.name)),
    [catalog, placed],
  );

  // ── Local edits ──────────────────────────────────────────────────────────────
  // EDITING IS LOCKED WHILE A SAVE IS IN FLIGHT (Astra review 2026-09-17, finding 6, BC-007).
  // Save and Discard disabled while busy, but every reorder/rename/remove/place control stayed
  // live and `dispatch` ignored `busy` — so a change made during a slow save was replaced by
  // the server's response, dirty was cleared, and the panel said "Saved". The controls below
  // all carry `disabled={busy …}`; this guard is the floor under them, because a select fired
  // by a keyboard or a control added later must not be able to slip past the disabled props.
  const dispatch = (edit: GuideEdit) => {
    if (busy || !model || !canEdit) return;
    setErrorMsg(null);
    setNotice(null);
    try {
      setModel(applyGuideEdit(model, edit));
      setDirty(true);
    } catch (e) {
      // The reducer's refusals ARE the message (one SKU per line, a section is not empty…).
      setErrorMsg(e instanceof OrderGuideError ? e.message : t("admin.vendors.error.generic"));
    }
  };

  const discard = () => {
    if (busy) return;
    setModel(baseline.guide);
    setDirty(false);
    setErrorMsg(null);
    setNotice(null);
    setRenamingId(null);
  };

  // ── Server round-trips ───────────────────────────────────────────────────────
  /** Reconcile with the server's state. Returns false when the GET failed — the caller must
   *  say so rather than claim a reload that did not happen (Astra r2-4). */
  const reload = async (): Promise<boolean> => {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, redirect: "manual" });
      if (!res.ok) return false;
      const fresh = (await res.json()) as OrderGuideInitial;
      setBaseline(fresh);
      setModel(fresh.guide);
      setDirty(false);
      return true;
    } catch {
      return false;
    }
  };

  const create = async () => {
    if (busy || !canEdit) return;
    setBusy(true);
    setErrorMsg(null);
    let result;
    try {
      result = await postJson(url, { create: true });
    } finally {
      setBusy(false);
    }
    if (result.ok) {
      const guide = result.data.guide as GuideModel;
      setBaseline({ guide, skusNotOnGuide: baseline.skusNotOnGuide });
      setModel(guide);
      setDirty(false);
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  /**
   * BUSY IS HELD THROUGH THE WHOLE ROUND TRIP, RECONCILIATION INCLUDED (Astra r2-4, BC-007).
   * The stale branch clears `busy` only in the `finally`, because the reload GET is part of the
   * save: releasing the controls before it returned let a manager make an edit that `reload()`
   * then replaced, clearing `dirty` under them — the same loss the busy lock exists to stop,
   * moved a few hundred milliseconds later. And a reload that FAILED says so: the "reloaded —
   * redo your change" notice is only truthful after the fresh state actually arrived.
   */
  const save = async () => {
    if (busy || !model || !canEdit) return;
    setBusy(true);
    setErrorMsg(null);
    setNotice(null);
    try {
      const result = await postJson(url, { model, expectedUpdatedAt: model.updatedAt });
      if (result.ok) {
        const guide = result.data.guide as GuideModel;
        setBaseline({ guide, skusNotOnGuide: bucket });
        setModel(guide);
        setDirty(false);
        setNotice(t("admin.order_guide.saved"));
        return;
      }
      if (result.code === "guide_stale") {
        // Replay NOTHING (spec §7): the manager redoes the move against the fresh state.
        const reloaded = await reload();
        if (!reloaded) {
          setErrorMsg(t("admin.vendors.error.generic"));
          return;
        }
        setNotice(t("admin.order_guide.stale"));
        return;
      }
      setErrorMsg(t(resolveErrorKey(result.code)));
    } finally {
      setBusy(false);
    }
  };

  const commitRename = (sectionId: string) => {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (busy) return;
    if (name) dispatch({ kind: "rename_section", sectionId, name });
  };

  const addSection = () => {
    const name = newSection.trim();
    if (busy || !name) return;
    dispatch({ kind: "add_section", name });
    setNewSection("");
  };

  const skuLabel = (skuId: string, fallback: string) => catalog.get(skuId)?.name ?? fallback;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <section className="co-card mt-4 p-4" aria-labelledby={`order-guide-${vendorId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`order-guide-${vendorId}`} className="text-base font-bold text-co-text">
          {t("admin.order_guide.heading")}
        </h2>
        {model && canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <PlainBtn label={t("admin.order_guide.discard")} disabled={!dirty || busy} onClick={discard} />
            <PrimaryBtn label={t("admin.order_guide.save")} disabled={!dirty || busy} onClick={save} />
          </div>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-co-text-muted">{model ? model.name : vendorName}</p>

      {notice ? (
        <p className="mt-3 rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-2 text-sm text-co-warning-text">{notice}</p>
      ) : null}
      {errorMsg ? (
        <p className="mt-3 rounded-lg border-2 border-co-danger bg-co-danger-surface px-3 py-2 text-sm text-co-cta-text">{errorMsg}</p>
      ) : null}

      {!model ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-co-text-muted">{t("admin.order_guide.empty")}</p>
          {canEdit ? <PrimaryBtn label={t("admin.order_guide.create")} disabled={busy} onClick={create} /> : null}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {/* ── Sections, in guide order ── */}
          {model.sections.map((section, sIdx) => (
            <div key={section.id} className="rounded-lg border-2 border-co-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {renamingId === section.id ? (
                  <input
                    className={`${fieldCls} max-w-xs`}
                    value={renameDraft}
                    disabled={busy}
                    autoFocus
                    aria-label={t("admin.order_guide.section_name")}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => commitRename(section.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(section.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                ) : (
                  <h3 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{section.name}</h3>
                )}
                {canEdit ? (
                  <div className="flex items-center gap-1">
                    <PlainBtn
                      label="▲"
                      ariaLabel={t("admin.order_guide.up")}
                      disabled={busy || sIdx === 0}
                      onClick={() => dispatch({ kind: "move_section", sectionId: section.id, direction: "up" })}
                    />
                    <PlainBtn
                      label="▼"
                      ariaLabel={t("admin.order_guide.down")}
                      disabled={busy || sIdx === model.sections.length - 1}
                      onClick={() => dispatch({ kind: "move_section", sectionId: section.id, direction: "down" })}
                    />
                    <PlainBtn
                      label={t("admin.order_guide.rename")}
                      disabled={busy}
                      onClick={() => {
                        setRenameDraft(section.name);
                        setRenamingId(section.id);
                      }}
                    />
                    <PlainBtn
                      label={t("admin.order_guide.remove")}
                      disabled={busy}
                      onClick={() => dispatch({ kind: "remove_section", sectionId: section.id })}
                    />
                  </div>
                ) : null}
              </div>

              <ul className="mt-2 flex flex-col gap-2">
                {section.lines.map((line, lIdx) => (
                  <li key={line.id} className="rounded-lg border-2 border-co-border bg-co-surface-inset p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 text-sm text-co-text">
                        <span className="font-bold">{line.label}</span>
                        {line.itemNumber ? <span className="ml-2 text-co-text-muted">{line.itemNumber}</span> : null}
                        <span className="ml-2">
                          {line.skuId ? (
                            <span className="rounded-full bg-co-gold/20 px-2 py-0.5 text-xs font-bold text-co-text">
                              {skuLabel(line.skuId, line.label)}
                            </span>
                          ) : (
                            <span className="rounded-full border-2 border-co-danger px-2 py-0.5 text-xs font-bold text-co-cta-text">
                              {t("admin.order_guide.needs_sku")}
                            </span>
                          )}
                        </span>
                      </div>
                      {canEdit ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <PlainBtn
                            label="▲"
                            ariaLabel={t("admin.order_guide.up")}
                            disabled={busy || lIdx === 0}
                            onClick={() => dispatch({ kind: "move_line", lineId: line.id, direction: "up" })}
                          />
                          <PlainBtn
                            label="▼"
                            ariaLabel={t("admin.order_guide.down")}
                            disabled={busy || lIdx === section.lines.length - 1}
                            onClick={() => dispatch({ kind: "move_line", lineId: line.id, direction: "down" })}
                          />
                          {model.sections.length > 1 ? (
                            <select
                              className={`${fieldCls} w-auto`}
                              aria-label={t("admin.order_guide.move_to")}
                              disabled={busy}
                              value=""
                              onChange={(e) => {
                                if (e.target.value) dispatch({ kind: "move_line_to_section", lineId: line.id, sectionId: e.target.value });
                              }}
                            >
                              <option value="">{t("admin.order_guide.move_to")}</option>
                              {model.sections
                                .filter((s) => s.id !== section.id)
                                .map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                            </select>
                          ) : null}
                          <PlainBtn
                            label="✕"
                            ariaLabel={t("admin.order_guide.remove")}
                            disabled={busy}
                            onClick={() => dispatch({ kind: "remove_line", lineId: line.id })}
                          />
                        </div>
                      ) : null}
                    </div>

                    {/* A sheet row the seed could not match: the picker is the resolution path. */}
                    {!line.skuId && canEdit ? (
                      <select
                        className={`${fieldCls} mt-2`}
                        aria-label={t("admin.order_guide.needs_sku")}
                        disabled={busy}
                        value=""
                        onChange={(e) => {
                          if (e.target.value) dispatch({ kind: "set_line_sku", lineId: line.id, skuId: e.target.value });
                        }}
                      >
                        <option value="">{t("admin.order_guide.needs_sku")}</option>
                        {bucket.map((s) => (
                          <option key={s.skuId} value={s.skuId}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* ── Add section ── */}
          {canEdit ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-[12rem] flex-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-co-text-dim">
                  {t("admin.order_guide.section_name")}
                </span>
                <input
                  className={`${fieldCls} mt-1`}
                  aria-label={t("admin.order_guide.section_name")}
                  disabled={busy}
                  value={newSection}
                  onChange={(e) => setNewSection(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addSection();
                  }}
                />
              </label>
              <PrimaryBtn label={t("admin.order_guide.add_section")} disabled={busy || !newSection.trim()} onClick={addSection} />
            </div>
          ) : null}

          {/* ── The bucket: active SKUs no line carries ── */}
          <div className="rounded-lg border-2 border-co-border p-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{t("admin.order_guide.bucket")}</h3>
            {bucket.length === 0 ? null : (
              <ul className="mt-2 flex flex-col gap-2">
                {bucket.map((s) => (
                  <li key={s.skuId} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-co-text">
                      {s.name}
                      {s.itemNumber ? <span className="ml-2 text-co-text-muted">{s.itemNumber}</span> : null}
                    </span>
                    {canEdit && model.sections.length > 0 ? (
                      <select
                        className={`${fieldCls} w-auto`}
                        aria-label={t("admin.order_guide.place_in")}
                        disabled={busy}
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            dispatch({
                              kind: "add_line",
                              sectionId: e.target.value,
                              skuId: s.skuId,
                              label: s.name,
                              itemNumber: s.itemNumber,
                            });
                          }
                        }}
                      >
                        <option value="">{t("admin.order_guide.place_in")}</option>
                        {model.sections.map((sec) => (
                          <option key={sec.id} value={sec.id}>
                            {sec.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
