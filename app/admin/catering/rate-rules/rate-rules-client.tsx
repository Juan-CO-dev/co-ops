"use client";

/**
 * RateRulesClient — per-location catering rate editor (W1a, DOMAIN=rate).
 *
 * Per location the actor manages, renders three tiers of rate rules:
 *   1. Default (location-scope) — one rate for the whole location.
 *   2. Per-section — one rate per section name drawn from the menu items.
 *   3. Per-entity — searchable override per sub (menu_item) or extra (item).
 *
 * Each rate input accepts EITHER a % rate OR a target price (whole portion
 * baseline). On % entry, the derived whole price is shown via
 * cateringUnitPriceCents(regularCents, "whole", pctToBps). On price entry,
 * the implied rate is shown via impliedRateBps(priceCents, regularCents).
 *
 * FINANCIAL: every mutation is Tier B — POST upsert + DELETE deactivate all
 * call requestStepUp("B") first and bail if not "ok". Mirrors PricingClient.
 * Authority floor: RATE_MIN = 8 (catering.kb.rate.write), same as the route+lib.
 */

import { useState, useMemo, Suspense } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import {
  cateringUnitPriceCents,
  impliedRateBps,
} from "@/lib/catering/pricing-derivation";
import { postJson, resolveErrorKey } from "@/components/admin/catering/shared";
import type { RateRuleView } from "@/lib/admin/catering/rate-rules";
import type { LocationRateData } from "./page";

// Route/lib floor for catering.kb.rate.write.
const RATE_MIN = 8;

// ─── helpers ────────────────────────────────────────────────────────────────

/** bps → "85.00%" */
function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** percent string (e.g. "85") → bps integer */
function pctToBps(pct: string): number | null {
  const n = Number(pct.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** dollars string → cents integer */
function dollarsToCents(s: string): number | null {
  const n = Number(s.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Format cents as "$X.XX" */
function formatCents(c: number): string {
  return `$${(c / 100).toFixed(2)}`;
}

// ─── RateInput — inline bidirectional % ↔ price entry ───────────────────────

/**
 * Bidirectional rate input. The operator enters EITHER:
 *   - A % (e.g. 85) → shows derived whole price
 *   - A target price in $ → shows implied rate %
 * POSTing always sends bps (converted from whichever mode is active).
 */
function RateInput({
  ruleId,
  locationId,
  scope,
  scopeRef,
  currentBps,
  regularPriceCents,
  disabled,
  onSaved,
  onError,
}: {
  ruleId: string | null;
  locationId: string;
  scope: "location" | "section" | "item" | "menu_item";
  scopeRef: string | null;
  /** Currently active rate (0 = no active rule → show placeholder). */
  currentBps: number | null;
  /** Regular (non-catering) unit price in cents; null if unknown (section/location scope). */
  regularPriceCents: number | null;
  disabled: boolean;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();

  const [mode, setMode] = useState<"pct" | "price">("pct");
  const [pctValue, setPctValue] = useState(
    currentBps != null ? String(currentBps / 100) : "",
  );
  const [priceValue, setPriceValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Derived preview for the non-editing mode.
  const derivedPrice = useMemo((): string | null => {
    if (mode !== "pct" || regularPriceCents == null) return null;
    const bps = pctToBps(pctValue);
    if (bps == null) return null;
    const c = cateringUnitPriceCents(regularPriceCents, "whole", bps);
    return formatCents(c);
  }, [mode, pctValue, regularPriceCents]);

  const impliedPct = useMemo((): string | null => {
    if (mode !== "price" || regularPriceCents == null) return null;
    const cents = dollarsToCents(priceValue);
    if (cents == null) return null;
    const bps = impliedRateBps(cents, regularPriceCents);
    if (bps == null) return null;
    return `${(bps / 100).toFixed(2)}%`;
  }, [mode, priceValue, regularPriceCents]);

  const effectiveBps = useMemo((): number | null => {
    if (mode === "pct") return pctToBps(pctValue);
    if (regularPriceCents == null) return null;
    const cents = dollarsToCents(priceValue);
    if (cents == null) return null;
    return impliedRateBps(cents, regularPriceCents);
  }, [mode, pctValue, priceValue, regularPriceCents]);

  const save = async () => {
    if (busy) return;
    const bps = effectiveBps;
    if (bps == null) {
      onError(t("admin.catering.rate.error.invalid_rate" as TranslationKey));
      return;
    }
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson("/api/admin/catering/rate-rules", {
      locationId,
      scope,
      scopeRef,
      rateBps: bps,
    });
    setBusy(false);
    if (result.ok) {
      setEditing(false);
      onSaved();
    } else {
      onError(t(resolveErrorKey(result.code)));
    }
  };

  const remove = async () => {
    if (busy || !ruleId) return;
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson(
      `/api/admin/catering/rate-rules/${ruleId}?locationId=${encodeURIComponent(locationId)}`,
      {},
      "DELETE",
    );
    setBusy(false);
    if (result.ok) {
      setConfirmDelete(false);
      setEditing(false);
      onSaved();
    } else {
      onError(t(resolveErrorKey(result.code)));
    }
  };

  const fieldCls =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-co-text-muted">
          {currentBps != null
            ? bpsToPercent(currentBps)
            : t("admin.catering.rate.not_set" as TranslationKey)}
        </span>
        <button
          type="button"
          aria-label={t("admin.catering.rate.edit_aria" as TranslationKey)}
          onClick={() => setEditing(true)}
          disabled={disabled}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
        >
          {t(
            (currentBps != null
              ? "admin.catering.rate.edit"
              : "admin.catering.rate.set") as TranslationKey,
          )}
        </button>
        {ruleId != null && !confirmDelete ? (
          <button
            type="button"
            aria-label={t("admin.catering.rate.remove_aria" as TranslationKey)}
            onClick={() => setConfirmDelete(true)}
            disabled={disabled}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
          >
            {t("admin.catering.rate.remove" as TranslationKey)}
          </button>
        ) : null}
        {confirmDelete ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
            >
              {t("admin.catering.rate.cancel" as TranslationKey)}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta transition hover:border-co-cta focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
            >
              {t("admin.catering.rate.confirm_remove" as TranslationKey)}
            </button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border-2 border-dashed border-co-border p-3">
      {/* Mode toggle */}
      <div className="flex gap-2" role="group" aria-label={t("admin.catering.rate.input_mode_aria" as TranslationKey)}>
        <button
          type="button"
          onClick={() => setMode("pct")}
          disabled={busy}
          aria-pressed={mode === "pct"}
          className={`inline-flex min-h-[44px] items-center rounded-lg border-2 px-3 text-xs font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50 ${
            mode === "pct"
              ? "border-co-gold bg-co-gold text-co-text"
              : "border-co-border bg-co-surface text-co-text hover:border-co-text"
          }`}
        >
          {t("admin.catering.rate.mode.pct" as TranslationKey)}
        </button>
        <button
          type="button"
          onClick={() => setMode("price")}
          disabled={busy || regularPriceCents == null}
          aria-pressed={mode === "price"}
          className={`inline-flex min-h-[44px] items-center rounded-lg border-2 px-3 text-xs font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50 ${
            mode === "price"
              ? "border-co-gold bg-co-gold text-co-text"
              : "border-co-border bg-co-surface text-co-text hover:border-co-text"
          }`}
        >
          {t("admin.catering.rate.mode.price" as TranslationKey)}
        </button>
      </div>

      {mode === "pct" ? (
        <label className="block">
          <span className="text-sm font-bold text-co-text">
            {t("admin.catering.rate.field.pct" as TranslationKey)}
          </span>
          <div className="relative">
            <input
              aria-label={t("admin.catering.rate.field.pct" as TranslationKey)}
              className={fieldCls + " pr-8"}
              type="number"
              min={0}
              max={300}
              step="any"
              inputMode="decimal"
              value={pctValue}
              disabled={busy}
              onChange={(e) => setPctValue(e.target.value)}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-co-text-muted">
              %
            </span>
          </div>
          {derivedPrice != null ? (
            <p className="mt-1 text-xs text-co-text-muted">
              {t("admin.catering.rate.derived_price" as TranslationKey)}{" "}
              <span className="font-bold">{derivedPrice}</span>
            </p>
          ) : null}
        </label>
      ) : (
        <label className="block">
          <span className="text-sm font-bold text-co-text">
            {t("admin.catering.rate.field.price" as TranslationKey)}
          </span>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-co-text-muted">
              $
            </span>
            <input
              aria-label={t("admin.catering.rate.field.price" as TranslationKey)}
              className={fieldCls + " pl-7"}
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={priceValue}
              disabled={busy}
              onChange={(e) => setPriceValue(e.target.value)}
            />
          </div>
          {impliedPct != null ? (
            <p className="mt-1 text-xs text-co-text-muted">
              {t("admin.catering.rate.implied_rate" as TranslationKey)}{" "}
              <span className="font-bold">{impliedPct}</span>
            </p>
          ) : null}
        </label>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("admin.catering.rate.cancel" as TranslationKey)}
        </button>
        <button
          type="button"
          disabled={busy || effectiveBps == null}
          onClick={() => void save()}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("admin.catering.rate.save" as TranslationKey)}
        </button>
      </div>
    </div>
  );
}

// ─── LocationCard — one card per location ───────────────────────────────────

function LocationCard({
  data,
  canManage,
  onRefresh,
}: {
  data: LocationRateData;
  canManage: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { locationId, locationName, rules, menuItems } = data;

  // Derive rule lookup maps.
  const ruleByKey = useMemo(() => {
    const m = new Map<string, RateRuleView>();
    for (const r of rules) {
      const key = `${r.scope}:${r.scopeRef ?? ""}`;
      m.set(key, r);
    }
    return m;
  }, [rules]);

  const locationRule = ruleByKey.get("location:");

  // Seeded-baseline nudge: every location ships with a 100% (10000 bps) default
  // rule so catering prices == regular. If NOTHING has been marked up yet, prompt
  // the manager to set a real catering margin before go-live (council E finding).
  const atBaseline = rules.length > 0 && rules.every((r) => r.rateBps === 10000);

  // Per-section: unique section names from the menu items.
  const sections = useMemo(() => {
    const seen = new Set<string>();
    for (const item of menuItems) {
      if (item.section) seen.add(item.section);
    }
    return [...seen].sort();
  }, [menuItems]);

  // Per-entity filtered by search.
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return menuItems;
    return menuItems.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.nameEs ?? "").toLowerCase().includes(q) ||
        (item.section ?? "").toLowerCase().includes(q),
    );
  }, [menuItems, search]);

  const onSaved = () => {
    setErrorMsg(null);
    onRefresh();
  };

  const onError = (msg: string) => setErrorMsg(msg);

  return (
    <div className="co-card p-4">
      <h2 className="font-bold text-co-text">{locationName}</h2>

      {errorMsg ? (
        <p className="mt-2 text-sm text-co-cta">{errorMsg}</p>
      ) : null}

      {canManage && atBaseline ? (
        <p className="mt-2 rounded-md border-2 border-co-gold/50 bg-co-gold/5 px-3 py-2 text-xs text-co-text">
          {t("admin.catering.rate.baseline_nudge" as TranslationKey)}
        </p>
      ) : null}

      {/* ── Default (location-scope) rate ── */}
      <section className="mt-4" aria-label={t("admin.catering.rate.section.default_aria" as TranslationKey)}>
        <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-co-text-muted">
          {t("admin.catering.rate.section.default" as TranslationKey)}
        </h3>
        {canManage ? (
          <RateInput
            ruleId={locationRule?.id ?? null}
            locationId={locationId}
            scope="location"
            scopeRef={null}
            currentBps={locationRule?.rateBps ?? null}
            regularPriceCents={null}
            disabled={!canManage}
            onSaved={onSaved}
            onError={onError}
          />
        ) : (
          <p className="mt-1 text-sm text-co-text-muted">
            {locationRule != null
              ? bpsToPercent(locationRule.rateBps)
              : t("admin.catering.rate.not_set" as TranslationKey)}
          </p>
        )}
      </section>

      {/* ── Per-section rates ── */}
      {sections.length > 0 ? (
        <section
          className="mt-5"
          aria-label={t("admin.catering.rate.section.sections_aria" as TranslationKey)}
        >
          <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-co-text-muted">
            {t("admin.catering.rate.section.sections" as TranslationKey)}
          </h3>
          <div className="mt-2 flex flex-col gap-2">
            {sections.map((sec) => {
              const rule = ruleByKey.get(`section:${sec}`);
              return (
                <div key={sec} className="rounded-lg border-2 border-co-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-1">
                    <span className="text-sm font-bold text-co-text">{sec}</span>
                  </div>
                  {canManage ? (
                    <RateInput
                      ruleId={rule?.id ?? null}
                      locationId={locationId}
                      scope="section"
                      scopeRef={sec}
                      currentBps={rule?.rateBps ?? null}
                      regularPriceCents={null}
                      disabled={!canManage}
                      onSaved={onSaved}
                      onError={onError}
                    />
                  ) : (
                    <p className="mt-1 text-sm text-co-text-muted">
                      {rule != null
                        ? bpsToPercent(rule.rateBps)
                        : t("admin.catering.rate.not_set" as TranslationKey)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ── Per-entity overrides ── */}
      {menuItems.length > 0 ? (
        <section
          className="mt-5"
          aria-label={t("admin.catering.rate.section.entities_aria" as TranslationKey)}
        >
          <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-co-text-muted">
            {t("admin.catering.rate.section.entities" as TranslationKey)}
          </h3>
          <p className="mt-1 text-xs text-co-text-muted">
            {t("admin.catering.rate.section.entities_hint" as TranslationKey)}
          </p>

          {/* Search box */}
          <div className="relative mt-2">
            <input
              type="search"
              aria-label={t("admin.catering.rate.search_aria" as TranslationKey)}
              placeholder={t("admin.catering.rate.search_placeholder" as TranslationKey)}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text placeholder:text-co-text-muted/60 focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
            />
          </div>

          {filteredItems.length === 0 ? (
            <p className="mt-3 text-sm text-co-text-muted">
              {t("admin.catering.rate.search_empty" as TranslationKey)}
            </p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {filteredItems.map((item) => {
                const ruleKey = `${item.kind}:${item.id}`;
                const rule = ruleByKey.get(ruleKey);
                const scope =
                  item.kind === "menu_item" ? "menu_item" : "item";
                return (
                  <div
                    key={ruleKey}
                    className="rounded-lg border-2 border-co-border p-3"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-bold text-co-text">
                        {item.name}
                      </span>
                      {item.section ? (
                        <span className="text-xs text-co-text-muted">
                          {item.section}
                        </span>
                      ) : null}
                      <span className="ml-auto text-xs text-co-text-muted">
                        {t(
                          (item.kind === "menu_item"
                            ? "admin.catering.rate.kind.sub"
                            : "admin.catering.rate.kind.extra") as TranslationKey,
                        )}
                        {" · "}
                        {t("admin.catering.rate.regular_price" as TranslationKey)}{" "}
                        {formatCents(item.regularPriceCents)}
                      </span>
                    </div>
                    {canManage ? (
                      <RateInput
                        ruleId={rule?.id ?? null}
                        locationId={locationId}
                        scope={scope as "item" | "menu_item"}
                        scopeRef={item.id}
                        currentBps={rule?.rateBps ?? null}
                        regularPriceCents={item.regularPriceCents}
                        disabled={!canManage}
                        onSaved={onSaved}
                        onError={onError}
                      />
                    ) : (
                      <p className="mt-1 text-sm text-co-text-muted">
                        {rule != null
                          ? bpsToPercent(rule.rateBps)
                          : t("admin.catering.rate.not_set" as TranslationKey)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

// ─── RateRulesClientInner — needs router, no useSearchParams ────────────────

function RateRulesClientInner({
  locationData,
  actorLevel,
}: {
  locationData: LocationRateData[];
  actorLevel: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const canManage = actorLevel >= RATE_MIN;

  if (locationData.length === 0) {
    return (
      <div className="mt-5 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
        {t("admin.catering.rate.empty" as TranslationKey)}
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-3">
      {locationData.map((data) => (
        <LocationCard
          key={data.locationId}
          data={data}
          canManage={canManage}
          onRefresh={() => router.refresh()}
        />
      ))}
    </div>
  );
}

// ─── Public export — Suspense wrapper (build-hard-requirement) ──────────────

export function RateRulesClient({
  locationData,
  actorLevel,
}: {
  locationData: LocationRateData[];
  actorLevel: number;
}) {
  return (
    <Suspense fallback={null}>
      <RateRulesClientInner locationData={locationData} actorLevel={actorLevel} />
    </Suspense>
  );
}
