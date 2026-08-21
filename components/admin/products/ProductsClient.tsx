"use client";

/**
 * ProductsClient — the product registry (product identity above SKUs, 0179).
 *
 * A PRODUCT is the raw thing a recipe means ("HAM"); member SKUs are the vendors'
 * versions of it. This surface is where a manager creates one, attaches its member
 * SKUs, names the primary per location, and records what ONE unit of it weighs.
 *
 * DISCLOSURE DOCTRINE (docs/DISCLOSURE_DOCTRINE.md): needs-attention first and
 * default-open (unresolved · unweighed · members disagree), one SummaryRow per
 * product with identity + never-collapse badges always visible, and the editing
 * affordances inside a lazy drawer. Disclosure state is useState-only (D9).
 *
 * GRAMMAR: admin-form throughout — rounded-lg, 44px floor with items-center,
 * border-co-gold-deep on the primary action, control labels at tracking-[0.1em];
 * field labels 11px/700/tracking-[0.12em]/text-co-text-dim; group headers
 * 12px/700/tracking-wide/text-co-text-muted.
 *
 * Every mutation calls requestStepUp(tier) first and maps the machine code
 * through resolveErrorKey — never an untranslated server string.
 */

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { WeightClass } from "@/lib/angel-wave4";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { SummaryRow } from "@/components/ui/SummaryRow";
import type { ProductView } from "@/lib/products";
import { postJson, resolveErrorKey } from "./shared";

/** Mirrors PRODUCT_WRITE_MIN (lib/products.ts) — structural registry edits are GM+. */
const PRODUCT_WRITE_MIN = 7;

/** The live weight vocabulary (lib/angel-wave4.ts WeightClass). The column is
 *  deliberately unconstrained text (0177 precedent); these are the four the UI
 *  offers. SYSTEM KEY: the value written is the English original; only the label
 *  is translated.
 *
 *  Listed in DESCENDING WEIGHT_CLASS_RANK order — the two measured classes, then
 *  the documented one, then the guess — so the picker reads as the ladder Juan
 *  ruled on 2026-08-21 rather than an arbitrary list. ESTIMATE is offered here
 *  deliberately: a GM setting a product's unit_oz from food knowledge should be
 *  able to SAY that is what they did, which is the whole point of the class. */
const WEIGHT_CLASSES: ReadonlyArray<{ value: WeightClass; key: TranslationKey }> = [
  { value: "OPERATIONAL", key: "admin.products.unit_oz.class.operational" },
  { value: "INVOICE_DERIVED", key: "admin.products.unit_oz.class.invoice_derived" },
  { value: "SPEC", key: "admin.products.unit_oz.class.spec" },
  { value: "ESTIMATE", key: "admin.products.unit_oz.class.estimate" },
];

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

const primaryBtnCls =
  "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50";

const secondaryBtnCls =
  "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50";

const fieldLabelCls = "text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";
const groupHeaderCls = "text-xs font-bold tracking-wide text-co-text-muted";

export interface SkuOption {
  id: string;
  name: string;
  vendorName: string | null;
  active: boolean;
}

export interface LocationOption {
  id: string;
  name: string;
}

export function ProductsClient({
  products,
  skus,
  locations,
  actorLevel,
}: {
  products: ProductView[];
  skus: SkuOption[];
  locations: LocationOption[];
  actorLevel: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const canManage = actorLevel >= PRODUCT_WRITE_MIN;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const toggleRow = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** One mutation lane: step-up → postJson → refresh, or a localized code. */
  const mutate = async (
    tier: "A" | "B",
    url: string,
    body: unknown,
    method: "POST" | "PATCH" | "DELETE" = "POST",
  ): Promise<boolean> => {
    if (busy) return false;
    setErrorMsg(null);
    if ((await requestStepUp(tier)) !== "ok") return false;
    setBusy(true);
    const result = await postJson(url, body, method);
    setBusy(false);
    if (result.ok) {
      router.refresh();
      return true;
    }
    setErrorMsg(t(resolveErrorKey(result.code)));
    return false;
  };

  const attachedSkuIds = new Set(products.flatMap((p) => p.members.map((m) => m.skuId)));
  const unattachedSkus = skus.filter((s) => !attachedSkuIds.has(s.id));

  const needsAttention = (p: ProductView): boolean =>
    p.unresolved || p.membersDisagree || (p.unitOz == null && p.members.length > 1);

  const attention = products.filter((p) => p.active && needsAttention(p));
  const rest = products.filter((p) => !p.active || !needsAttention(p));

  const renderRow = (p: ProductView) => (
    <ProductRow
      key={p.id}
      product={p}
      locations={locations}
      unattachedSkus={unattachedSkus}
      canManage={canManage}
      busy={busy}
      expanded={expanded.has(p.id)}
      onToggle={() => toggleRow(p.id)}
      onMutate={mutate}
    />
  );

  return (
    <div className="mt-5 flex flex-col gap-3">
      {errorMsg ? (
        <p role="status" className="text-sm text-co-cta-text">
          {errorMsg}
        </p>
      ) : null}

      {canManage ? <CreateProductForm busy={busy} onMutate={mutate} /> : null}

      {products.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
          {t("admin.products.empty")}
        </div>
      ) : (
        <>
          {attention.length > 0 ? (
            <CollapsibleSection
              idBase="products-attention"
              title={t("admin.products.attention.heading")}
              count={t("admin.products.count", { n: attention.length })}
              defaultOpen
            >
              <div className="flex flex-col gap-2">{attention.map(renderRow)}</div>
            </CollapsibleSection>
          ) : null}

          <CollapsibleSection
            idBase="products-all"
            title={t("admin.products.all.heading")}
            count={t("admin.products.count", { n: rest.length })}
            defaultOpen={attention.length === 0}
          >
            {rest.length === 0 ? (
              <p className="text-sm text-co-text-muted">{t("admin.products.all.empty")}</p>
            ) : (
              <div className="flex flex-col gap-2">{rest.map(renderRow)}</div>
            )}
          </CollapsibleSection>
        </>
      )}
    </div>
  );
}

/** Add a product. Tier B (a registry create), mirroring a SKU create. */
function CreateProductForm({
  busy,
  onMutate,
}: {
  busy: boolean;
  onMutate: (tier: "A" | "B", url: string, body: unknown, method?: "POST" | "PATCH" | "DELETE") => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [nameEs, setNameEs] = useState("");
  const [notes, setNotes] = useState("");
  const nameId = useId();
  const nameEsId = useId();
  const notesId = useId();

  const submit = async () => {
    if (!name.trim() || busy) return;
    const ok = await onMutate("B", "/api/admin/products", {
      name: name.trim(),
      nameEs: nameEs.trim() || null,
      notes: notes.trim() || null,
    });
    if (ok) {
      setName("");
      setNameEs("");
      setNotes("");
    }
  };

  return (
    <CollapsibleSection idBase="products-create" title={t("admin.products.create.heading")}>
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={nameId} className={fieldLabelCls}>
              {t("admin.products.create.name")}
            </label>
            <input
              id={nameId}
              className={fieldCls}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={nameEsId} className={fieldLabelCls}>
              {t("admin.products.create.name_es")}
            </label>
            <input
              id={nameEsId}
              className={fieldCls}
              value={nameEs}
              disabled={busy}
              onChange={(e) => setNameEs(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label htmlFor={notesId} className={fieldLabelCls}>
            {t("admin.products.create.notes")}
          </label>
          <input
            id={notesId}
            className={fieldCls}
            value={notes}
            disabled={busy}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div>
          <button type="button" disabled={busy || !name.trim()} onClick={() => void submit()} className={primaryBtnCls}>
            {t("admin.products.create.submit")}
          </button>
        </div>
      </div>
    </CollapsibleSection>
  );
}

/** One product: identity + badges always visible, editors in the lazy drawer. */
function ProductRow({
  product,
  locations,
  unattachedSkus,
  canManage,
  busy,
  expanded,
  onToggle,
  onMutate,
}: {
  product: ProductView;
  locations: LocationOption[];
  unattachedSkus: SkuOption[];
  canManage: boolean;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onMutate: (tier: "A" | "B", url: string, body: unknown, method?: "POST" | "PATCH" | "DELETE") => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const primaryMember = product.members.find((m) => m.skuId === product.globalPrimarySkuId) ?? null;

  const summary = (
    <span className="flex flex-wrap items-baseline gap-2">
      <span className="text-sm font-bold text-co-text">{product.name}</span>
      <span className="text-xs text-co-text-muted">
        {t("admin.products.field.members", { n: product.members.length })}
      </span>
      {primaryMember ? (
        <span className="text-xs text-co-text-muted">
          {t("admin.products.field.primary", {
            vendor: primaryMember.vendorName ?? primaryMember.name,
          })}
        </span>
      ) : (
        <span className="text-xs text-co-text-muted">{t("admin.products.field.no_primary")}</span>
      )}
      <span className="text-xs text-co-text-muted">
        {product.unitOz != null
          ? t("admin.products.field.unit_oz", { oz: product.unitOz })
          : t("admin.products.field.unit_oz_unknown")}
      </span>
      {/* What retiring this would cost, visible BEFORE anyone reaches for the
          button — the pre-flight warning starts on the summary row, not in the
          confirm. Absent at zero: "0 recipes" is noise on every singleton. */}
      {product.pinnedRecipes.length > 0 ? (
        <span className="text-xs text-co-text-muted">
          {t("admin.products.field.pinned_recipes", { n: product.pinnedRecipes.length })}
        </span>
      ) : null}
    </span>
  );

  const badges = (
    <span className="flex flex-wrap items-center gap-1">
      {!product.active ? (
        <Pill tone="muted" label={t("admin.products.badge.inactive")} />
      ) : null}
      {product.unresolved ? (
        <Pill tone="danger" label={t("admin.products.badge.unresolved")} />
      ) : null}
      {product.unitOz == null && product.members.length > 1 ? (
        <Pill tone="warning" label={t("admin.products.badge.needs_weighing")} />
      ) : null}
      {product.membersDisagree ? (
        <Pill tone="warning" label={t("admin.products.badge.members_disagree")} />
      ) : null}
    </span>
  );

  return (
    <SummaryRow
      summary={summary}
      badges={badges}
      expanded={expanded}
      onToggle={onToggle}
      toggleLabel={
        expanded
          ? t("admin.products.hide_details")
          : t("admin.products.show_details")
      }
      drawerId={`product-drawer-${product.id}`}
    >
      <MembersPanel
        product={product}
        unattachedSkus={unattachedSkus}
        canManage={canManage}
        busy={busy}
        onMutate={onMutate}
      />
      <PrimaryPanel
        product={product}
        locations={locations}
        canManage={canManage}
        busy={busy}
        onMutate={onMutate}
      />
      <UnitOzPanel product={product} canManage={canManage} busy={busy} onMutate={onMutate} />
      <LifecyclePanel product={product} canManage={canManage} busy={busy} onMutate={onMutate} />
    </SummaryRow>
  );
}

/**
 * Discontinue this product, or bring it back (Juan's ruling A+, 2026-08-21).
 *
 * IT WARNS, IT NEVER BLOCKS. The confirm names how many ACTIVE recipes still pin
 * this identity — and names the recipes themselves when there are few enough to
 * read — then lets the manager proceed. That is the module's count-beats-theory
 * posture applied to config: Juan's declaration of reality wins, and the system's
 * job is to make sure he can see what it costs before he says yes. A hard block
 * would put the software in charge of what the kitchen buys.
 *
 * Tier B, not the Tier A its sibling panels use: a membership edit moves which
 * vendor a product means; this decides whether it means anything at all.
 */
function LifecyclePanel({
  product,
  canManage,
  busy,
  onMutate,
}: {
  product: ProductView;
  canManage: boolean;
  busy: boolean;
  onMutate: (tier: "A" | "B", url: string, body: unknown, method?: "POST" | "PATCH" | "DELETE") => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  if (!canManage) return null;

  const pins = product.pinnedRecipes;
  // Named when the list is short enough to READ; a count alone past that, because a
  // wall of forty names is the same as no information (disclosure doctrine D4).
  const NAME_LIMIT = 5;

  const submit = async (active: boolean) => {
    const ok = await onMutate("B", `/api/admin/products/${product.id}/active`, { active });
    if (ok) setConfirming(false);
  };

  return (
    <section>
      <h3 className={groupHeaderCls}>{t("admin.products.lifecycle.heading")}</h3>

      {!product.active ? (
        <>
          <p className="mt-1 text-xs text-co-text-muted">{t("admin.products.lifecycle.restore_hint")}</p>
          <button
            type="button"
            disabled={busy}
            aria-label={t("admin.products.lifecycle.restore_aria", { product: product.name })}
            onClick={() => void submit(true)}
            className={`mt-2 ${secondaryBtnCls}`}
          >
            {t("admin.products.lifecycle.restore")}
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-co-text-muted">{t("admin.products.lifecycle.retire_hint")}</p>
          {!confirming ? (
            <button
              type="button"
              disabled={busy}
              aria-label={t("admin.products.lifecycle.retire_aria", { product: product.name })}
              onClick={() => setConfirming(true)}
              // Danger OUTLINE, never a red fill — and the edge and the label move
              // together on co-cta-text (AGENTS.md token roles).
              className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta-text bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-cta-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("admin.products.lifecycle.retire")}
            </button>
          ) : (
            <div className="mt-2 rounded-lg border-2 border-co-cta-text bg-co-danger-surface p-3">
              <p className="text-sm font-bold text-co-text">
                {t("admin.products.lifecycle.confirm_heading", { product: product.name })}
              </p>
              {/* THE PRE-FLIGHT. The count is the warning; the names are the errand. */}
              <p className="mt-1 text-xs text-co-text">
                {pins.length === 0
                  ? t("admin.products.lifecycle.confirm_no_pins")
                  : t("admin.products.lifecycle.confirm_pins", { n: pins.length })}
              </p>
              {pins.length > 0 && pins.length <= NAME_LIMIT ? (
                <p className="mt-1 text-xs text-co-text-muted">
                  {t("admin.products.lifecycle.confirm_recipes", {
                    names: pins.map((r) => r.name).join(", "),
                  })}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                  className={secondaryBtnCls}
                >
                  {t("admin.products.lifecycle.cancel")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t("admin.products.lifecycle.retire_aria", { product: product.name })}
                  onClick={() => void submit(false)}
                  // Destructive FILL = ink on cta (never white or cream on cta).
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-cta px-4 text-xs font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("admin.products.lifecycle.confirm")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Pill({ tone, label }: { tone: "danger" | "warning" | "muted"; label: string }) {
  // Neutral tone rides the live status-chip spelling (bg-co-text/10, the
  // CapacityClient "unconfigured" chip) — co-surface-2 is a hover/pressed token,
  // never a badge tint, and co-warning/danger-surface carry status meaning.
  const cls =
    tone === "danger"
      ? "bg-co-danger-surface text-co-cta-text"
      : tone === "warning"
        ? "bg-co-warning-surface text-co-warning-text"
        : "bg-co-text/10 text-co-text-muted";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] ${cls}`}>
      {label}
    </span>
  );
}

/** Member SKUs — attach / detach. Detach refuses server-side when the SKU is a primary. */
function MembersPanel({
  product,
  unattachedSkus,
  canManage,
  busy,
  onMutate,
}: {
  product: ProductView;
  unattachedSkus: SkuOption[];
  canManage: boolean;
  busy: boolean;
  onMutate: (tier: "A" | "B", url: string, body: unknown, method?: "POST" | "PATCH" | "DELETE") => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [skuId, setSkuId] = useState("");
  const selectId = useId();

  const attach = async () => {
    if (!skuId || busy) return;
    const ok = await onMutate("A", `/api/admin/products/${product.id}/members`, { skuId });
    if (ok) setSkuId("");
  };

  return (
    <section>
      <h3 className={groupHeaderCls}>{t("admin.products.members.heading")}</h3>
      {product.members.length === 0 ? (
        <p className="mt-1 text-sm text-co-text-muted">{t("admin.products.members.none")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {product.members.map((m) => (
            <li key={m.skuId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-co-text">
                <span className="font-bold">{m.name}</span>
                {m.vendorName ? <span className="text-co-text-muted"> · {m.vendorName}</span> : null}
                {!m.active ? (
                  <span className="text-co-text-muted"> · {t("admin.products.members.inactive")}</span>
                ) : null}
                {m.skuId === product.globalPrimarySkuId ? (
                  <span className="text-co-confirm-text"> · {t("admin.products.members.is_primary")}</span>
                ) : null}
              </span>
              {canManage ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t("admin.products.members.detach_aria", { sku: m.name })}
                  onClick={() =>
                    void onMutate("A", `/api/admin/products/${product.id}/members`, { skuId: m.skuId }, "DELETE")
                  }
                  className={secondaryBtnCls}
                >
                  {t("admin.products.members.detach")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="grow">
            <label htmlFor={selectId} className={fieldLabelCls}>
              {t("admin.products.members.attach_label")}
            </label>
            <select
              id={selectId}
              className={fieldCls}
              value={skuId}
              disabled={busy}
              onChange={(e) => setSkuId(e.target.value)}
            >
              <option value="">{t("admin.products.members.attach_placeholder")}</option>
              {unattachedSkus.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.vendorName ? `${s.name} · ${s.vendorName}` : s.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" disabled={busy || !skuId} onClick={() => void attach()} className={primaryBtnCls}>
            {t("admin.products.members.attach")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** Primary designation per scope: "All locations" (the global row) + one per shop. */
function PrimaryPanel({
  product,
  locations,
  canManage,
  busy,
  onMutate,
}: {
  product: ProductView;
  locations: LocationOption[];
  canManage: boolean;
  busy: boolean;
  onMutate: (tier: "A" | "B", url: string, body: unknown, method?: "POST" | "PATCH" | "DELETE") => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const scopes: Array<{ locationId: string | null; label: string }> = [
    { locationId: null, label: t("admin.products.primary.all_locations") },
    ...locations.map((l) => ({ locationId: l.id, label: l.name })),
  ];

  return (
    <section>
      <h3 className={groupHeaderCls}>{t("admin.products.primary.heading")}</h3>
      <p className="mt-1 text-xs text-co-text-muted">{t("admin.products.primary.hint")}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {scopes.map((scope) => (
          <PrimaryScopeRow
            key={scope.locationId ?? "global"}
            product={product}
            locationId={scope.locationId}
            label={scope.label}
            canManage={canManage}
            busy={busy}
            onMutate={onMutate}
          />
        ))}
      </ul>
    </section>
  );
}

function PrimaryScopeRow({
  product,
  locationId,
  label,
  canManage,
  busy,
  onMutate,
}: {
  product: ProductView;
  locationId: string | null;
  label: string;
  canManage: boolean;
  busy: boolean;
  onMutate: (tier: "A" | "B", url: string, body: unknown, method?: "POST" | "PATCH" | "DELETE") => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const current = product.primaries.find((p) => p.locationId === locationId)?.primarySkuId ?? "";
  const [choice, setChoice] = useState(current);
  // Prop-driven state reset, the house pattern: compare-during-render, never an
  // effect (router.refresh() re-renders with fresh props but does NOT reset
  // client state, so a server-side change would otherwise leave a stale pick).
  const [seenCurrent, setSeenCurrent] = useState(current);
  if (seenCurrent !== current) {
    setSeenCurrent(current);
    setChoice(current);
  }
  const selectId = useId();

  const dirty = choice !== "" && choice !== current;

  return (
    <li className="flex flex-wrap items-end gap-2">
      <div className="grow">
        <label htmlFor={selectId} className={fieldLabelCls}>
          {label}
        </label>
        <select
          id={selectId}
          className={fieldCls}
          value={choice}
          disabled={busy || !canManage || product.members.length === 0}
          onChange={(e) => setChoice(e.target.value)}
        >
          <option value="">{t("admin.products.primary.none")}</option>
          {product.members.map((m) => (
            <option key={m.skuId} value={m.skuId}>
              {m.vendorName ? `${m.name} · ${m.vendorName}` : m.name}
            </option>
          ))}
        </select>
      </div>
      {canManage ? (
        <button
          type="button"
          disabled={busy || !dirty}
          aria-label={t("admin.products.primary.set_aria", { scope: label })}
          onClick={() =>
            void onMutate("A", `/api/admin/products/${product.id}/primary`, {
              locationId,
              primarySkuId: choice,
            })
          }
          className={secondaryBtnCls}
        >
          {t("admin.products.primary.set")}
        </button>
      ) : null}
    </li>
  );
}

/**
 * What ONE unit of the product weighs — the number that makes a product-pinned
 * recipe line survive a member flip (migration 0179's unit_oz; deviation D2).
 */
function UnitOzPanel({
  product,
  canManage,
  busy,
  onMutate,
}: {
  product: ProductView;
  canManage: boolean;
  busy: boolean;
  onMutate: (tier: "A" | "B", url: string, body: unknown, method?: "POST" | "PATCH" | "DELETE") => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const serverValue = product.unitOz != null ? String(product.unitOz) : "";
  const [value, setValue] = useState(serverValue);
  const [cls, setCls] = useState(product.unitOzClass ?? "");
  const [note, setNote] = useState(product.unitOzSourceNote ?? "");
  // Same compare-during-render reset as the primary picker: a refreshed prop wins
  // over stale client state (AGENTS.md — never an effect for this).
  const [seenValue, setSeenValue] = useState(serverValue);
  if (seenValue !== serverValue) {
    setSeenValue(serverValue);
    setValue(serverValue);
    setCls(product.unitOzClass ?? "");
    setNote(product.unitOzSourceNote ?? "");
  }
  const ozId = useId();
  const clsId = useId();
  const noteId = useId();

  const trimmed = value.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const valid = parsed === null || (Number.isFinite(parsed) && parsed > 0);

  return (
    <section>
      <h3 className={groupHeaderCls}>{t("admin.products.unit_oz.heading")}</h3>
      <p className="mt-1 text-xs text-co-text-muted">{t("admin.products.unit_oz.hint")}</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={ozId} className={fieldLabelCls}>
            {t("admin.products.unit_oz.label")}
          </label>
          <input
            id={ozId}
            className={fieldCls}
            inputMode="decimal"
            value={value}
            disabled={busy || !canManage}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={clsId} className={fieldLabelCls}>
            {t("admin.products.unit_oz.class")}
          </label>
          <select
            id={clsId}
            className={fieldCls}
            value={cls}
            disabled={busy || !canManage}
            onChange={(e) => setCls(e.target.value)}
          >
            <option value="">{t("admin.products.unit_oz.class_none")}</option>
            {WEIGHT_CLASSES.map((c) => (
              <option key={c.value} value={c.value}>
                {t(c.key)}
              </option>
            ))}
          </select>
        </div>
        <div className="grow">
          <label htmlFor={noteId} className={fieldLabelCls}>
            {t("admin.products.unit_oz.note")}
          </label>
          <input
            id={noteId}
            className={fieldCls}
            value={note}
            disabled={busy || !canManage}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {canManage ? (
          <button
            type="button"
            disabled={busy || !valid}
            aria-label={t("admin.products.unit_oz.save_aria", { product: product.name })}
            onClick={() =>
              void onMutate(
                "A",
                `/api/admin/products/${product.id}`,
                { unitOz: parsed, unitOzClass: cls || null, sourceNote: note.trim() || null },
                "PATCH",
              )
            }
            className={secondaryBtnCls}
          >
            {t("admin.products.unit_oz.save")}
          </button>
        ) : null}
      </div>
      {!valid ? (
        <p className="mt-1 text-sm text-co-cta-text">{t("admin.products.error.invalid_unit_oz")}</p>
      ) : null}
    </section>
  );
}
