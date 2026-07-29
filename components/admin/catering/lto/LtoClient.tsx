"use client";

/**
 * LtoClient — W4c-b admin surface for turning perishable surplus into LTO/discount events.
 *
 * Two panels:
 *   1. SURPLUS → ACTION: list perishable surplus lines. item/menu_item lines get an
 *      inline form to create an LTO or discount. choice lines are rendered greyed (can't
 *      be an LTO item ref — no itemId/menuItemId to anchor the event item).
 *   2. MANAGE LIST: existing events for this location with Cancel affordance for active ones.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { postJson, resolveErrorKey } from "@/components/admin/catering/shared";
import { AlertPill, type AlertPillTone } from "@/components/ui/AlertPill";
import type { SurplusLine } from "@/lib/catering/surplus";
import type { LtoEventView, LtoKind } from "@/lib/catering/lto";
import type { PackageLocationOption } from "@/lib/admin/catering/packages";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** YYYY-MM-DD of today in local time (client-side). */
function clientTodayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add `n` days to a YYYY-MM-DD string. */
function addDaysClient(yyyymmdd: string, n: number): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  if (!y || !m || !d) return yyyymmdd;
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// ── Inline form per surplus line ──────────────────────────────────────────────

interface LineFormState {
  kind: LtoKind;
  name: string;
  pct: string;          // "10.5" → discountBps = Math.round(10.5 * 100)
  promoDollars: string; // "4.99" → promoPriceCents = Math.round(4.99 * 100)
  startsOn: string;
  endsOn: string;
  note: string;
}

function defaultForm(lineName: string): LineFormState {
  const today = clientTodayYmd();
  return {
    kind: "lto",
    name: lineName,
    pct: "",
    promoDollars: "",
    startsOn: today,
    endsOn: addDaysClient(today, 2),
    note: "",
  };
}

interface LineCardProps {
  line: SurplusLine;
  locationId: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onSuccess: () => void;
}

function LineCard({ line, locationId, busy, setBusy, onSuccess }: LineCardProps) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();

  const actionable = line.refKind === "item" || line.refKind === "menu_item";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<LineFormState>(() => defaultForm(line.name));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fieldCls =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

  const handleSubmit = async () => {
    if (busy) return;
    setErrorMsg(null);

    // Validate percent when kind = discount (required) or when provided
    const pctNum = form.pct.trim() ? parseFloat(form.pct) : NaN;
    const hasPct = Number.isFinite(pctNum) && pctNum > 0;

    if (form.kind === "discount" && !hasPct) {
      setErrorMsg(t("admin.catering.lto.error.percent_required" as TranslationKey));
      return;
    }

    const discountBps = hasPct ? Math.round(pctNum * 100) : null;
    const dollarsNum = form.promoDollars.trim() ? parseFloat(form.promoDollars) : NaN;
    const promoPriceCents =
      form.kind === "lto" && Number.isFinite(dollarsNum) && dollarsNum >= 0
        ? Math.round(dollarsNum * 100)
        : null;

    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);

    const body = {
      locationId,
      kind: form.kind,
      name: form.name.trim(),
      discountBps,
      promoPriceCents,
      startsOn: form.startsOn,
      endsOn: form.endsOn,
      note: form.note.trim() || null,
      items: [
        {
          itemId: line.refKind === "item" ? line.refId : null,
          menuItemId: line.refKind === "menu_item" ? line.refId : null,
          nameSnapshot: line.name,
          qty: line.qty,
          sourcePipelineId: line.pipelineId,
        },
      ],
    };

    const result = await postJson("/api/admin/catering/lto/events", body, "POST");
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setForm(defaultForm(line.name));
      onSuccess();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <li className="rounded-xl border-2 border-co-border bg-co-surface p-3">
      {/* Line summary */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={[
            "text-sm font-semibold",
            actionable ? "text-co-text" : "text-co-text-muted",
          ].join(" ")}
        >
          {line.qty > 0 ? `${line.qty} × ` : ""}
          {line.portion ? `${line.portion} ` : ""}
          {line.name}
        </span>
        <span className="text-xs text-co-text-muted">{line.needDate}</span>
        {line.refKind === "choice" && (
          <AlertPill tone="warn">{t("lto.choice_no_action")}</AlertPill>
        )}
        {actionable && !open && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen(true)}
            className="ml-auto inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.08em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
          >
            {t("admin.catering.lto.run_action" as TranslationKey)}
          </button>
        )}
        {actionable && open && (
          <button
            type="button"
            disabled={busy}
            onClick={() => { setOpen(false); setErrorMsg(null); }}
            className="ml-auto text-xs text-co-text-muted underline underline-offset-2 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
        )}
      </div>

      {/* Inline form */}
      {actionable && open && (
        <div className="mt-3 flex flex-col gap-3 border-t-2 border-co-border pt-3">
          {/* Kind toggle */}
          <div className="flex gap-2">
            {(["lto", "discount"] as LtoKind[]).map((k) => (
              <button
                key={k}
                type="button"
                disabled={busy}
                onClick={() => setForm((f) => ({ ...f, kind: k }))}
                className={[
                  "flex-1 rounded-lg border-2 py-2 text-sm font-bold uppercase tracking-[0.08em] transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50",
                  form.kind === k
                    ? "border-co-gold-deep bg-co-gold text-co-text"
                    : "border-co-border bg-co-surface text-co-text-muted",
                ].join(" ")}
              >
                {k === "lto"
                  ? t("admin.catering.lto.kind_lto" as TranslationKey)
                  : t("admin.catering.lto.kind_discount" as TranslationKey)}
              </button>
            ))}
          </div>

          {/* Name */}
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
              {t("admin.catering.lto.name" as TranslationKey)}
            </span>
            <input
              className={fieldCls}
              type="text"
              value={form.name}
              disabled={busy}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>

          {/* Percent off */}
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
              {t("admin.catering.lto.percent_off" as TranslationKey)}
              {form.kind === "discount" ? " *" : ""}
            </span>
            <input
              className={fieldCls + " w-36"}
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              placeholder="10"
              value={form.pct}
              disabled={busy}
              onChange={(e) => setForm((f) => ({ ...f, pct: e.target.value }))}
            />
          </label>

          {/* Featured price (LTO only) */}
          {form.kind === "lto" && (
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
                {t("admin.catering.lto.promo_price" as TranslationKey)}
              </span>
              <input
                className={fieldCls + " w-40"}
                type="number"
                min={0}
                step={0.01}
                placeholder="4.99"
                value={form.promoDollars}
                disabled={busy}
                onChange={(e) => setForm((f) => ({ ...f, promoDollars: e.target.value }))}
              />
            </label>
          )}

          {/* Date range */}
          <div className="flex flex-wrap gap-3">
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
                {t("admin.catering.lto.starts" as TranslationKey)}
              </span>
              <input
                className={fieldCls + " w-44"}
                type="date"
                value={form.startsOn}
                disabled={busy}
                onChange={(e) => setForm((f) => ({ ...f, startsOn: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
                {t("admin.catering.lto.ends" as TranslationKey)}
              </span>
              <input
                className={fieldCls + " w-44"}
                type="date"
                value={form.endsOn}
                disabled={busy}
                onChange={(e) => setForm((f) => ({ ...f, endsOn: e.target.value }))}
              />
            </label>
          </div>

          {/* Note */}
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
              {t("admin.catering.lto.note" as TranslationKey)}
            </span>
            <textarea
              className={fieldCls + " resize-y"}
              rows={2}
              value={form.note}
              disabled={busy}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          </label>

          {errorMsg && <p className="text-sm text-co-cta">{errorMsg}</p>}

          <button
            type="button"
            disabled={busy || !form.name.trim()}
            onClick={() => void handleSubmit()}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-6 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? t("common.saving")
              : t("admin.catering.lto.create" as TranslationKey)}
          </button>
        </div>
      )}
    </li>
  );
}

// ── Event row in the manage list ──────────────────────────────────────────────

interface EventRowProps {
  ev: LtoEventView;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onSuccess: () => void;
}

function EventRow({ ev, busy, setBusy, onSuccess }: EventRowProps) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCancel = async () => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/catering/lto/events/${ev.id}/cancel`, {}, "POST");
    setBusy(false);
    if (result.ok) {
      onSuccess();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  const terms =
    ev.discountBps != null && ev.promoPriceCents != null
      ? `${(ev.discountBps / 100).toFixed(0)}% off · $${(ev.promoPriceCents / 100).toFixed(2)}`
      : ev.discountBps != null
        ? `${(ev.discountBps / 100).toFixed(0)}% off`
        : ev.promoPriceCents != null
          ? `$${(ev.promoPriceCents / 100).toFixed(2)}`
          : "—";

  const statusTone: Record<string, AlertPillTone> = {
    active: "ok",
    cancelled: "danger",
    expired: "info",
  };

  return (
    <li className="co-card p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-co-text">{ev.name}</span>
            <AlertPill tone="warn">{ev.kind}</AlertPill>
            <AlertPill tone={statusTone[ev.status] ?? "info"}>{ev.status}</AlertPill>
          </div>
          <p className="mt-1 text-xs text-co-text-muted">
            {terms} · {ev.startsOn} – {ev.endsOn}
          </p>
          {ev.items.length > 0 && (
            <p className="mt-0.5 text-xs text-co-text-muted">
              {ev.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}
            </p>
          )}
          {ev.note && <p className="mt-0.5 text-xs italic text-co-text-muted">{ev.note}</p>}
        </div>
        {ev.status === "active" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCancel()}
            className="shrink-0 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 text-xs font-bold uppercase tracking-[0.08em] text-co-cta transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
          >
            {t("admin.catering.lto.cancel_event" as TranslationKey)}
          </button>
        )}
      </div>
      {errorMsg && <p className="mt-1 text-xs text-co-cta">{errorMsg}</p>}
    </li>
  );
}

// ── Main client component ─────────────────────────────────────────────────────

export function LtoClient({
  surplus,
  events,
  locations,
  locationId,
  actorLevel,
}: {
  surplus: SurplusLine[];
  events: LtoEventView[];
  locations: PackageLocationOption[];
  locationId: string | null;
  actorLevel: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  const [busy, setBusy] = useState(false);

  const fieldCls =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

  const canManage = actorLevel >= 6;

  // Actionable = item or menu_item lines (not choice, not sku)
  const actionableLines = surplus.filter(
    (l) => l.refKind === "item" || l.refKind === "menu_item",
  );
  const infoOnlyLines = surplus.filter(
    (l) => l.refKind === "choice" || l.refKind === "sku",
  );
  const allSurplusLines = [...actionableLines, ...infoOnlyLines];

  return (
    <div className="mt-5 flex flex-col gap-6">
      {/* Location picker */}
      {locations.length > 1 && (
        <div>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
              {t("admin.catering.lto.location_label" as TranslationKey)}
            </span>
            <select
              className={fieldCls}
              value={locationId ?? ""}
              disabled={busy}
              onChange={(e) =>
                router.push(`/admin/catering/lto?location=${e.target.value}`)
              }
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* ── Surplus → Action ─────────────────────────────────────────── */}
      <section className="co-card p-4">
        <h2 className="mb-3 text-base font-extrabold text-co-text">
          {t("lto.surplus_title" as TranslationKey)}
        </h2>
        {allSurplusLines.length === 0 ? (
          <p className="text-sm text-co-text-muted">
            {t("admin.catering.lto.no_surplus" as TranslationKey)}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {allSurplusLines.map((line, i) =>
              canManage ? (
                <LineCard
                  key={`${line.refId}-${line.needDate}-${i}`}
                  line={line}
                  locationId={locationId ?? ""}
                  busy={busy}
                  setBusy={setBusy}
                  onSuccess={() => router.refresh()}
                />
              ) : (
                /* read-only view for actors below LTO_MIN (shouldn't reach here; defensive) */
                <li
                  key={`${line.refId}-${line.needDate}-${i}`}
                  className="co-card flex flex-wrap items-center gap-2 px-3 py-2 text-sm text-co-text-muted"
                >
                  {line.qty > 0 ? `${line.qty} × ` : ""}
                  {line.portion ? `${line.portion} ` : ""}
                  {line.name}
                  <span className="text-xs">{line.needDate}</span>
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      {/* ── Manage list ──────────────────────────────────────────────── */}
      <section className="co-card p-4">
        <h2 className="mb-3 text-base font-extrabold text-co-text">
          {t("admin.catering.lto.manage_title" as TranslationKey)}
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-co-text-muted">
            {t("admin.catering.lto.no_events" as TranslationKey)}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {events.map((ev) => (
              <EventRow
                key={ev.id}
                ev={ev}
                busy={busy}
                setBusy={setBusy}
                onSuccess={() => router.refresh()}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
