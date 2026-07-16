"use client";

/**
 * QuotesClient — the catering quote surface (Wave 1 slice 1E, the money surface).
 *
 * Three views in one island: the quote list, the builder (with a LIVE server-computed
 * charge stack — never client math), and the detail panel (breakdown + revisions + the
 * step-up-gated Send). Send re-uses the admin PasswordModal: on a step-up challenge from
 * the send route we open the modal, and its onConfirm (fired after a successful
 * /api/auth/step-up) re-fires the send — the fresh step-up now survives to the send route.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { formatCents } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import { PasswordModal } from "@/components/auth/PasswordModal";
import type { Quote, QuoteItem, DeliveryZone, ChargeRates, ChargeStack } from "@/lib/catering/quotes";
import type { CateringMenuItem, CateringPackage } from "@/lib/catering/menu";
import { postJson, resolveErrorKey, isStepUpCode } from "./shared";

const WRITE_MIN = 6;

interface LocationPricing {
  zones: DeliveryZone[];
  rates: ChargeRates;
  hasPricingRule: boolean;
}
export interface QuotesClientProps {
  quotes: Quote[];
  locations: { id: string; name: string }[];
  customers: { id: string; name: string; company: string | null; email: string | null }[];
  leads: { id: string; contactName: string; company: string | null; eventDate: string | null; headcount: number | null; locationId: string | null }[];
  pricingByLocation: Record<string, LocationPricing>;
  menuItems: CateringMenuItem[];
  packagesByLocation: Record<string, CateringPackage[]>;
  actorLevel: number;
}

type View = { mode: "list" } | { mode: "build"; reviseOf: QuoteDetail | null } | { mode: "detail"; id: string };

interface QuoteDetail {
  quote: Quote;
  items: QuoteItem[];
}

const STATUS_ORDER = ["draft", "sent", "accepted", "declined", "expired"] as const;

function dollarsToCents(v: string): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function QuotesClient({ quotes, locations, customers, leads, pricingByLocation, menuItems, packagesByLocation, actorLevel }: QuotesClientProps) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [view, setView] = useState<View>({ mode: "list" });
  const canWrite = actorLevel >= WRITE_MIN;
  const money = useCallback((c: number) => formatCents(c, language), [language]);

  if (view.mode === "build") {
    return (
      <QuoteBuilder
        reviseOf={view.reviseOf}
        locations={locations}
        customers={customers}
        leads={leads}
        pricingByLocation={pricingByLocation}
        menuItems={menuItems}
        packagesByLocation={packagesByLocation}
        onDone={(newId) => {
          router.refresh();
          setView(newId ? { mode: "detail", id: newId } : { mode: "list" });
        }}
        onCancel={() => setView(view.reviseOf ? { mode: "detail", id: view.reviseOf.quote.id } : { mode: "list" })}
      />
    );
  }

  if (view.mode === "detail") {
    return (
      <QuoteDetailPanel
        id={view.id}
        canWrite={canWrite}
        onBack={() => {
          router.refresh();
          setView({ mode: "list" });
        }}
        onRevise={(detail) => setView({ mode: "build", reviseOf: detail })}
      />
    );
  }

  // ── List view ──
  const grouped = STATUS_ORDER.map((s) => ({ status: s, rows: quotes.filter((q) => q.status === s) })).filter(
    (g) => g.rows.length > 0,
  );

  return (
    <div className="mt-4">
      {canWrite && (
        <button
          type="button"
          onClick={() => setView({ mode: "build", reviseOf: null })}
          className="mb-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-co-text px-5 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-co-cta shadow-sm transition hover:bg-co-text/90"
        >
          {t("catering.quotes.new")}
        </button>
      )}

      {quotes.length === 0 ? (
        <p className="co-card p-6 text-sm text-co-text-muted">{t("catering.quotes.empty")}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map((g) => (
            <section key={g.status}>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
                {t(`catering.quotes.status.${g.status}` as TranslationKey)} · {g.rows.length}
              </h2>
              <ul className="flex flex-col gap-2">
                {g.rows.map((q) => (
                  <li key={q.id}>
                    <button
                      type="button"
                      onClick={() => setView({ mode: "detail", id: q.id })}
                      className="co-card-interactive flex w-full items-center justify-between gap-3 p-4 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-co-text">
                          {money(q.totalCents)}
                          {q.version > 1 && <span className="ml-2 text-xs font-normal text-co-text-dim">v{q.version}</span>}
                        </span>
                        <span className="block truncate text-xs text-co-text-muted">
                          {q.eventDate ?? t("catering.quotes.no_date")}
                          {q.headcount != null ? ` · ${q.headcount} ${t("catering.quotes.covers")}` : ""}
                        </span>
                      </span>
                      <StatusBadge status={q.status} isExpired={q.isExpired} t={t} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, isExpired, t }: { status: Quote["status"]; isExpired: boolean; t: (k: TranslationKey) => string }) {
  const effective = isExpired && status === "sent" ? "expired" : status;
  const tone: Record<string, string> = {
    draft: "bg-co-surface text-co-text-muted border-co-border-2",
    sent: "bg-co-info/10 text-co-info border-co-info/40",
    accepted: "bg-co-success/10 text-co-success border-co-success/40",
    declined: "bg-co-cta/10 text-co-cta border-co-cta/40",
    expired: "bg-co-surface text-co-text-dim border-co-border-2",
  };
  return (
    <span className={`shrink-0 rounded-full border-2 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${tone[effective] ?? tone.draft}`}>
      {t(`catering.quotes.status.${effective}` as TranslationKey)}
    </span>
  );
}

// ── Builder ────────────────────────────────────────────────────────────────────
interface LineDraft {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string; // dollars
  itemId: string | null;
  menuItemId: string | null;
  packageId: string | null;
}
let lineKeySeq = 0;
function blankLine(): LineDraft {
  lineKeySeq += 1;
  return { key: `l${lineKeySeq}`, description: "", quantity: "1", unitPrice: "", itemId: null, menuItemId: null, packageId: null };
}

function QuoteBuilder({
  reviseOf,
  locations,
  customers,
  leads,
  pricingByLocation,
  menuItems,
  packagesByLocation,
  onDone,
  onCancel,
}: {
  reviseOf: QuoteDetail | null;
  locations: QuotesClientProps["locations"];
  customers: QuotesClientProps["customers"];
  leads: QuotesClientProps["leads"];
  pricingByLocation: Record<string, LocationPricing>;
  menuItems: CateringMenuItem[];
  packagesByLocation: Record<string, CateringPackage[]>;
  onDone: (newId: string | null) => void;
  onCancel: () => void;
}) {
  const { t, language } = useTranslation();
  const money = (c: number) => formatCents(c, language);
  const editing = reviseOf?.quote ?? null;

  const [locationId, setLocationId] = useState<string>(editing?.locationId ?? locations[0]?.id ?? "");
  const [contactEmail, setContactEmail] = useState<string>("");
  const [contactName, setContactName] = useState<string>("");
  const [contactCompany, setContactCompany] = useState<string>("");
  const [pipelineId, setPipelineId] = useState<string>(editing?.pipelineId ?? "");
  const [eventDate, setEventDate] = useState<string>(editing?.eventDate ?? "");
  const [headcount, setHeadcount] = useState<string>(editing?.headcount != null ? String(editing.headcount) : "");
  const [isDelivery, setIsDelivery] = useState<boolean>(editing?.isDelivery ?? false);
  const [deliveryZoneId, setDeliveryZoneId] = useState<string>(editing?.deliveryZoneId ?? "");
  const [notes, setNotes] = useState<string>(editing?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    reviseOf
      ? reviseOf.items.map((i) => {
          lineKeySeq += 1;
          return {
            key: `l${lineKeySeq}`,
            description: i.description ?? "",
            quantity: String(i.quantity),
            unitPrice: (i.unitPriceCents / 100).toString(),
            itemId: i.itemId,
            menuItemId: i.menuItemId,
            packageId: i.packageId,
          };
        })
      : [blankLine()],
  );
  const [preview, setPreview] = useState<ChargeStack | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  const pricing = pricingByLocation[locationId];

  // Live server-computed preview (debounced). The server is the sole source of truth for
  // money. All setState lives inside the async callback (no synchronous effect-body setState).
  const previewSeq = useRef(0);
  useEffect(() => {
    const seq = ++previewSeq.current;
    const handle = window.setTimeout(async () => {
      const validLines = lines
        .map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), unitPriceCents: dollarsToCents(l.unitPrice), itemId: l.itemId, menuItemId: l.menuItemId, packageId: l.packageId }))
        .filter((l) => (l.description.length > 0 || l.itemId || l.menuItemId) && Number.isFinite(l.quantity) && l.quantity > 0 && l.unitPriceCents != null);
      if (!locationId || validLines.length === 0) {
        if (seq === previewSeq.current) setPreview(null);
        return;
      }
      const res = await postJson("/api/catering/quotes/preview", {
        locationId,
        isDelivery,
        deliveryZoneId: isDelivery && deliveryZoneId ? deliveryZoneId : null,
        lines: validLines,
      });
      if (seq !== previewSeq.current) return; // stale
      if (res.ok && res.data.stack) setPreview(res.data.stack as ChargeStack);
      else setPreview(null);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [lines, locationId, isDelivery, deliveryZoneId]);

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));

  const packages = packagesByLocation[locationId] ?? [];
  const addALaCarte = (item: CateringMenuItem) => {
    lineKeySeq += 1;
    const line: LineDraft = {
      key: `l${lineKeySeq}`,
      description: item.name,
      quantity: "1",
      unitPrice: item.unitPriceCents ? (item.unitPriceCents / 100).toString() : "",
      itemId: item.id,
      menuItemId: null,
      packageId: null,
    };
    setLines((prev) => [...prev, line]);
  };
  const addPackage = (pkg: CateringPackage) => {
    // Expand the package into editable per-item lines (customize each item). If the package
    // has no composition, add one priced line for the package itself.
    const newLines: LineDraft[] = pkg.items.map((pi) => {
      lineKeySeq += 1;
      return {
        key: `l${lineKeySeq}`,
        description: pi.label,
        quantity: String(pi.quantity),
        unitPrice: pi.unitPriceCents ? (pi.unitPriceCents / 100).toString() : "",
        itemId: pi.itemId,
        menuItemId: pi.menuItemId,
        packageId: pkg.id,
      };
    });
    if (newLines.length === 0) {
      lineKeySeq += 1;
      newLines.push({ key: `l${lineKeySeq}`, description: pkg.labelEn, quantity: "1", unitPrice: (pkg.priceCents / 100).toString(), itemId: null, menuItemId: null, packageId: pkg.id });
    }
    setLines((prev) => [...prev, ...newLines]);
  };

  const submit = async () => {
    setErrorKey(null);
    const payloadLines = lines
      .map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), unitPriceCents: dollarsToCents(l.unitPrice), itemId: l.itemId, menuItemId: l.menuItemId, packageId: l.packageId }))
      .filter((l) => l.description.length > 0 || l.itemId || l.menuItemId);
    if (payloadLines.length === 0) {
      setErrorKey("catering.quotes.error.invalid_payload");
      return;
    }
    setSaving(true);
    const body = {
      locationId,
      contactEmail: contactEmail.trim() || null,
      contactName: contactName.trim() || null,
      contactCompany: contactCompany.trim() || null,
      pipelineId: pipelineId || null,
      eventDate: eventDate || null,
      headcount: headcount ? Number(headcount) : null,
      isDelivery,
      deliveryZoneId: isDelivery && deliveryZoneId ? deliveryZoneId : null,
      notes: notes || null,
      lines: payloadLines,
    };
    const res = editing
      ? await postJson(`/api/catering/quotes/${editing.id}`, body, "PATCH")
      : await postJson("/api/catering/quotes", body, "POST");
    setSaving(false);
    if (res.ok) {
      onDone(typeof res.data.id === "string" ? res.data.id : null);
    } else {
      setErrorKey(resolveErrorKey(res.code));
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold text-co-text">
          {editing ? t("catering.quotes.revise_title") : t("catering.quotes.new")}
        </h2>
        <button type="button" onClick={onCancel} className="text-sm font-semibold text-co-text-muted underline">
          {t("catering.quotes.cancel")}
        </button>
      </div>

      <div className="co-card flex flex-col gap-3 p-4">
        <Field label={t("catering.quotes.field.location")}>
          <select
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              setDeliveryZoneId("");
            }}
            disabled={!!editing}
            className="min-h-[44px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text disabled:opacity-60"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </Field>

        {pricing && !pricing.hasPricingRule && (
          <p className="rounded-lg border-2 border-co-cta/40 bg-co-cta/10 px-3 py-2 text-xs font-semibold text-co-cta">
            {t("catering.quotes.no_pricing_rule")}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("catering.quotes.field.event_date")}>
            <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="min-h-[44px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text" />
          </Field>
          <Field label={t("catering.quotes.field.headcount")}>
            <input type="number" min={0} value={headcount} onChange={(e) => setHeadcount(e.target.value)} className="min-h-[44px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text" />
          </Field>
        </div>

        {!editing && (
          <>
            <Field label={t("catering.quotes.field.email")}>
              <input
                type="email"
                inputMode="email"
                autoComplete="off"
                list="catering-contact-emails"
                value={contactEmail}
                onChange={(e) => {
                  const v = e.target.value;
                  setContactEmail(v);
                  const match = customers.find((c) => c.email && c.email.toLowerCase() === v.trim().toLowerCase());
                  if (match) {
                    setContactName(match.name);
                    setContactCompany(match.company ?? "");
                  }
                }}
                placeholder="name@company.com"
                className="min-h-[44px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text"
              />
              <datalist id="catering-contact-emails">
                {customers.filter((c) => c.email).map((c) => (
                  <option key={c.id} value={c.email ?? ""} />
                ))}
              </datalist>
            </Field>
            <p className="-mt-1 text-xs text-co-text-dim">{t("catering.quotes.email_hint")}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("catering.quotes.field.contact_name")}>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="min-h-[44px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text" />
              </Field>
              <Field label={t("catering.quotes.field.contact_company")}>
                <input value={contactCompany} onChange={(e) => setContactCompany(e.target.value)} className="min-h-[44px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text" />
              </Field>
            </div>
          </>
        )}
        <Field label={t("catering.quotes.field.lead")}>
          <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} disabled={!!editing} className="min-h-[44px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text disabled:opacity-60">
            <option value="">{t("catering.quotes.none")}</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>{l.company ? `${l.contactName} · ${l.company}` : l.contactName}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Lines */}
      <div className="co-card flex flex-col gap-3 p-4">
        <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("catering.quotes.lines")}</h3>
        {lines.map((l) => (
          <div key={l.key} className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
            <Field label={t("catering.quotes.field.description")}>
              <input value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} className="min-h-[44px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text" />
            </Field>
            <Field label={t("catering.quotes.field.qty")}>
              <input type="number" min={0} step="any" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} className="min-h-[44px] w-20 rounded-lg border-2 border-co-border-2 bg-co-surface px-2 text-sm text-co-text" />
            </Field>
            <Field label={t("catering.quotes.field.unit_price")}>
              <input type="number" min={0} step="0.01" inputMode="decimal" value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} className="min-h-[44px] w-24 rounded-lg border-2 border-co-border-2 bg-co-surface px-2 text-sm text-co-text" />
            </Field>
            <button type="button" onClick={() => removeLine(l.key)} disabled={lines.length <= 1} aria-label={t("catering.quotes.remove_line")} className="min-h-[44px] px-2 text-lg font-bold text-co-text-dim disabled:opacity-30">
              ×
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          {packages.length > 0 && (
            <select
              value=""
              onChange={(e) => { const pkg = packages.find((p) => p.id === e.target.value); if (pkg) addPackage(pkg); }}
              className="min-h-[40px] rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text"
            >
              <option value="">{t("catering.quotes.add_package")}</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>{(language === "es" ? p.labelEs ?? p.labelEn : p.labelEn)} — {money(p.priceCents)}</option>
              ))}
            </select>
          )}
          {menuItems.length > 0 && (
            <select
              value=""
              onChange={(e) => { const item = menuItems.find((m) => m.id === e.target.value); if (item) addALaCarte(item); }}
              className="min-h-[40px] rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text"
            >
              <option value="">{t("catering.quotes.add_ala_carte")}</option>
              {menuItems.map((m) => (
                <option key={m.id} value={m.id}>{(language === "es" ? m.nameEs ?? m.name : m.name)}{m.unitPriceCents ? ` — ${money(m.unitPriceCents)}` : ""}</option>
              ))}
            </select>
          )}
          <button type="button" onClick={() => setLines((p) => [...p, blankLine()])} className="text-sm font-bold text-co-info underline">
            + {t("catering.quotes.add_line")}
          </button>
        </div>
      </div>

      {/* Delivery + notes */}
      <div className="co-card flex flex-col gap-3 p-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-co-text">
          <input type="checkbox" checked={isDelivery} onChange={(e) => setIsDelivery(e.target.checked)} className="h-4 w-4" />
          {t("catering.quotes.is_delivery")}
        </label>
        {isDelivery && (
          <Field label={t("catering.quotes.field.delivery_zone")}>
            <select value={deliveryZoneId} onChange={(e) => setDeliveryZoneId(e.target.value)} className="min-h-[44px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text">
              <option value="">{t("catering.quotes.none")}</option>
              {(pricing?.zones ?? []).map((z) => (
                <option key={z.id} value={z.id}>{(language === "es" ? z.labelEs ?? z.labelEn : z.labelEn)} · {money(z.feeCents)}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t("catering.quotes.field.notes")}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm text-co-text" />
        </Field>
      </div>

      {/* Live breakdown */}
      {preview && <ChargeStackTable stack={preview} money={money} t={t} />}

      {errorKey && <p className="text-sm font-semibold text-co-cta">{t(errorKey)}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={saving}
        className="inline-flex min-h-[52px] items-center justify-center rounded-xl bg-co-text px-5 py-3 text-base font-bold uppercase tracking-[0.12em] text-co-cta shadow-sm transition hover:bg-co-text/90 disabled:opacity-50"
      >
        {saving ? t("catering.quotes.saving") : editing ? t("catering.quotes.save_revision") : t("catering.quotes.save_draft")}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">{label}</span>
      {children}
    </label>
  );
}

function ChargeStackTable({ stack, money, t }: { stack: ChargeStack; money: (c: number) => string; t: (k: TranslationKey) => string }) {
  const Row = ({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) => (
    <div className={`flex items-center justify-between ${strong ? "text-base font-extrabold text-co-text" : "text-sm text-co-text-muted"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{money(cents)}</span>
    </div>
  );
  return (
    <div className="co-card flex flex-col gap-1.5 p-4">
      <Row label={t("catering.quotes.subtotal")} cents={stack.subtotalCents} />
      {stack.deliveryFeeCents > 0 && <Row label={t("catering.quotes.delivery")} cents={stack.deliveryFeeCents} />}
      {stack.serviceChargeCents > 0 && <Row label={t("catering.quotes.service_charge")} cents={stack.serviceChargeCents} />}
      {stack.gratuityCents > 0 && <Row label={t("catering.quotes.gratuity")} cents={stack.gratuityCents} />}
      {stack.taxCents > 0 && <Row label={t("catering.quotes.tax")} cents={stack.taxCents} />}
      <div className="my-1 border-t-2 border-co-border" />
      <Row label={t("catering.quotes.total")} cents={stack.totalCents} strong />
      {stack.depositCents > 0 && <Row label={t("catering.quotes.deposit")} cents={stack.depositCents} />}
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────
function QuoteDetailPanel({
  id,
  canWrite,
  onBack,
  onRevise,
}: {
  id: string;
  canWrite: boolean;
  onBack: () => void;
  onRevise: (detail: QuoteDetail) => void;
}) {
  const { t, language } = useTranslation();
  const money = (c: number) => formatCents(c, language);
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [flashKey, setFlashKey] = useState<TranslationKey | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/catering/quotes/${id}`, { redirect: "manual" });
      if (r.ok) setDetail((await r.json()) as QuoteDetail);
      else setErrorKey("catering.quotes.error.generic");
    } catch {
      setErrorKey("catering.quotes.error.generic");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const doSend = useCallback(async () => {
    setBusy(true);
    setErrorKey(null);
    const res = await postJson(`/api/catering/quotes/${id}/send`, {}, "POST");
    setBusy(false);
    if (res.ok) {
      setStepUpOpen(false);
      setFlashKey(res.data.emailed ? "catering.quotes.sent_emailed" : "catering.quotes.sent_no_email");
      await load();
      return true;
    }
    if (isStepUpCode(res.code)) {
      setStepUpOpen(true);
      return false;
    }
    setErrorKey(resolveErrorKey(res.code));
    return false;
  }, [id, load]);

  const setStatus = useCallback(
    async (status: "accepted" | "declined" | "expired") => {
      setBusy(true);
      setErrorKey(null);
      const res = await postJson(`/api/catering/quotes/${id}`, { status }, "PATCH");
      setBusy(false);
      if (res.ok) await load();
      else setErrorKey(resolveErrorKey(res.code));
    },
    [id, load],
  );

  if (loading) return <p className="mt-4 text-sm text-co-text-muted">{t("catering.quotes.loading")}</p>;
  if (!detail) {
    return (
      <div className="mt-4">
        <p className="text-sm font-semibold text-co-cta">{t(errorKey ?? "catering.quotes.error.generic")}</p>
        <button type="button" onClick={onBack} className="mt-3 text-sm font-semibold text-co-text-muted underline">{t("catering.quotes.back")}</button>
      </div>
    );
  }

  const q = detail.quote;
  const effectiveStatus = q.isExpired && q.status === "sent" ? "expired" : q.status;
  const sendable = canWrite && (q.status === "draft" || q.status === "sent") && !q.isExpired;
  const decidable = canWrite && q.status === "sent" && !q.isExpired;

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="text-sm font-semibold text-co-text-muted underline">← {t("catering.quotes.back")}</button>
        <StatusBadge status={q.status} isExpired={q.isExpired} t={t} />
      </div>

      <div className="co-card flex flex-col gap-1 p-4">
        <p className="text-2xl font-extrabold text-co-text">{money(q.totalCents)}</p>
        <p className="text-sm text-co-text-muted">
          {q.eventDate ?? t("catering.quotes.no_date")}
          {q.headcount != null ? ` · ${q.headcount} ${t("catering.quotes.covers")}` : ""}
          {q.version > 1 ? ` · v${q.version}` : ""}
        </p>
        {q.expiresAt && (
          <p className="text-xs text-co-text-dim">
            {t("catering.quotes.expires")}: {new Date(q.expiresAt).toLocaleDateString(language === "es" ? "es-US" : "en-US")}
          </p>
        )}
      </div>

      <div className="co-card flex flex-col gap-2 p-4">
        <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("catering.quotes.lines")}</h3>
        {detail.items.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-co-text">
              {i.description ?? t("catering.labels.unnamed_item")}
              <span className="text-co-text-dim"> × {i.quantity}</span>
            </span>
            <span className="tabular-nums text-co-text-muted">{money(i.lineTotalCents)}</span>
          </div>
        ))}
      </div>

      <ChargeStackTable stack={q} money={money} t={t} />

      {flashKey && <p className="rounded-lg border-2 border-co-success/40 bg-co-success/10 px-3 py-2 text-sm font-semibold text-co-success">{t(flashKey)}</p>}
      {errorKey && <p className="text-sm font-semibold text-co-cta">{t(errorKey)}</p>}

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          {sendable && (
            <button type="button" onClick={() => void doSend()} disabled={busy} className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-co-text px-5 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-co-cta shadow-sm transition hover:bg-co-text/90 disabled:opacity-50">
              {q.status === "sent" ? t("catering.quotes.resend") : t("catering.quotes.send")}
            </button>
          )}
          <button type="button" onClick={() => onRevise(detail)} disabled={busy} className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-co-border-2 bg-co-surface px-5 py-2.5 text-sm font-semibold text-co-text transition hover:border-co-text disabled:opacity-50">
            {t("catering.quotes.revise")}
          </button>
          {decidable && (
            <>
              <button type="button" onClick={() => void setStatus("accepted")} disabled={busy} className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-co-success/50 bg-co-success/10 px-5 py-2.5 text-sm font-bold text-co-success disabled:opacity-50">
                {t("catering.quotes.mark_accepted")}
              </button>
              <button type="button" onClick={() => void setStatus("declined")} disabled={busy} className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-co-cta/50 bg-co-cta/10 px-5 py-2.5 text-sm font-bold text-co-cta disabled:opacity-50">
                {t("catering.quotes.mark_declined")}
              </button>
            </>
          )}
          <a href={`/catering/quotes/${q.id}/label`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[48px] items-center justify-center rounded-xl border-2 border-co-border-2 bg-co-surface px-5 py-2.5 text-sm font-semibold text-co-text transition hover:border-co-text">
            {t("catering.quotes.labels")}
          </a>
        </div>
      )}

      <PasswordModal open={stepUpOpen} onConfirm={async () => { await doSend(); }} onCancel={() => setStepUpOpen(false)} />
    </div>
  );
}
