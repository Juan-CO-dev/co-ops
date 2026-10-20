"use client";

/**
 * CreateUserForm — Tier-B "Add user" modal (C.44 Task 13).
 *
 * Role-conditional fields:
 *   - email + temp password show ONLY when ROLES[role].hasEmailAuth (level >= 6)
 *   - locations multiselect shows ONLY when getRoleLevel(role) < 9
 * Submit: requestStepUp("B") → POST /api/admin/users → close + router.refresh().
 *
 * Juan 2026-10-20 (adding ~19 staff): below shift lead, each chosen shop shows the work type, PRIMARY and SECONDARY
 * position pickers (and nothing is required). After the user is created, the picks are written as their schedule person
 * settings (POST /api/schedule, no step-up). If that second write fails the user still exists: the form says so, names
 * the refusal, and offers only Close (the positions can be set from the user's "Positions" action).
 *
 * The tier is TIER B because the server says so: POST /api/admin/users runs
 * assertStepUp(ctx, "B") (WB2-01 — creating a user is a user-lifecycle action).
 * Asking for Tier A here resolved "ok" with NO password prompt whenever the
 * client's `unlocked` flag was set, so a >120s-old unlock sent the request with
 * a stale flag and the admin got a bare 403 step_up_stale with no way to
 * re-confirm from this action. Client tier and server tier must agree per
 * action; Tier B always prompts, which is what refreshes step_up_unlocked_at.
 *
 * THE REHIRE WARNING (staff separations, 2026-10-20): an optional phone and, when who's-here is on, the person's Toast
 * employee at the first chosen shop. Either one is checked (POST /api/admin/users/rehire-check — never by name) against
 * separated people whose rehire setting needs authority; a match shows their chip (and the reasons only to who may read
 * them) and Add stays off until "I checked — add them anyway", which only a person with that rehire authority is
 * offered. The server runs the same check on create (409 rehire_match / 403 rehire_permission_required). A chosen Toast
 * employee is linked after create; if that link fails the user still exists and the form says so.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { ROLES, getRoleLevel, type RoleCode } from "@/lib/roles";
import type { TranslationKey } from "@/lib/i18n/types";
import { hasPositionRank } from "@/lib/scheduling/position-rank-shared";
import { pickOf, type PositionPick } from "@/lib/scheduling/user-positions-shared";
import { scheduleErrorKey } from "@/components/schedule/schedule-errors";
import { postJsonData, resolveErrorKey, type LocationOption } from "./shared";
import { ShopPositionFields, anyPickProblem, savePicks, type PositionShops } from "./UserPositions";
import { RehireMatches } from "./Employment";
import type { RehireMatch } from "@/lib/admin/employment";

export function CreateUserForm({
  assignableRoles,
  accessibleLocations,
  positionShops,
  toastPickerEnabled = false,
  onClose,
  initial,
}: {
  assignableRoles: RoleCode[];
  accessibleLocations: LocationOption[];
  /** The primary / secondary picker data per shop (absent = no pickers). */
  positionShops?: PositionShops;
  /** Offer the Toast employee picker (who's-here on). */
  toastPickerEnabled?: boolean;
  onClose: () => void;
  /** SSR tests / screenshots only: a pre-filled form. */
  initial?: {
    role?: RoleCode; locationIds?: string[]; picks?: Record<string, PositionPick>; name?: string; phone?: string; matches?: RehireMatch[];
    roster?: Array<{ guid: string; name: string }>;
  };
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const firstRole = assignableRoles[0];
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [toastGuid, setToastGuid] = useState("");
  const [roster, setRoster] = useState<{ shop: string | null; state: "idle" | "loading" | "ok" | "unavailable"; list: Array<{ guid: string; name: string }> }>(
    initial?.roster ? { shop: initial.locationIds?.[0] ?? null, state: "ok", list: initial.roster } : { shop: null, state: "idle", list: [] });
  const [matches, setMatches] = useState<RehireMatch[]>(initial?.matches ?? []);
  const [ack, setAck] = useState(false);
  const [rehireReason, setRehireReason] = useState("");
  const [role, setRole] = useState<RoleCode | "">(initial?.role ?? firstRole ?? "");
  const [email, setEmail] = useState("");
  const [tempPin, setTempPin] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [locationIds, setLocationIds] = useState<string[]>(initial?.locationIds ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, PositionPick>>(initial?.picks ?? {});
  /** The user exists but their positions were not saved: only Close is offered. */
  const [createdOnly, setCreatedOnly] = useState(false);

  const hasEmailAuth = role !== "" && ROLES[role].hasEmailAuth;
  const needsLocations = role !== "" && getRoleLevel(role) < 9;
  const offersPositions = !!positionShops && role !== "" && needsLocations && hasPositionRank({ role });
  const chosenPicks = offersPositions ? Object.fromEntries(locationIds.map((id) => [id, picks[id] ?? pickOf(null)])) : {};
  const picksBlocked = offersPositions && anyPickProblem(null, role as RoleCode, chosenPicks, positionShops!);

  // The Toast picker follows the FIRST chosen shop (in the order the shops are listed).
  const toastShop = needsLocations ? accessibleLocations.find((l) => locationIds.includes(l.id)) ?? null : null;
  const toastShopId = toastShop?.id ?? null;
  // Astra BC-060: the fetch is keyed on the SELECTED shop alone (never on the roster state it writes, which used to
  // re-run the effect and cancel its own response). One AbortController per request: a shop change aborts the old
  // request; an answer for a shop no longer selected is never shown (the render below matches roster.shop).
  const loadedShop = useRef<string | null>(initial?.roster ? initial.locationIds?.[0] ?? null : null);
  useEffect(() => {
    if (!toastPickerEnabled || !toastShopId || loadedShop.current === toastShopId) return;
    loadedShop.current = toastShopId;
    const ctl = new AbortController();
    setRoster({ shop: toastShopId, state: "loading", list: [] });
    setToastGuid("");
    fetch(`/api/admin/users/toast-roster?location=${encodeURIComponent(toastShopId)}`, { redirect: "manual", signal: ctl.signal })
      .then(async (res) => {
        const body = res.ok ? ((await res.json()) as { employees?: Array<{ guid: string; name: string }> }) : null;
        if (!ctl.signal.aborted) setRoster({ shop: toastShopId, state: body?.employees ? "ok" : "unavailable", list: body?.employees ?? [] });
      })
      .catch(() => { if (!ctl.signal.aborted) setRoster({ shop: toastShopId, state: "unavailable", list: [] }); });
    return () => {
      ctl.abort();
      if (loadedShop.current === toastShopId) loadedShop.current = null;
    };
  }, [toastPickerEnabled, toastShopId]);
  const shownRoster = roster.shop === toastShopId ? roster : { shop: toastShopId, state: "loading" as const, list: [] };

  /** The rehire check (phone / Toast employee only). A new probe clears the acknowledgement. */
  const checkRehire = async (probe: { phone: string; toastGuid: string }) => {
    setAck(false);
    if (!probe.phone.trim() && !probe.toastGuid) { setMatches([]); return; }
    const r = await postJsonData<{ matches?: RehireMatch[] }>("/api/admin/users/rehire-check", { phone: probe.phone.trim() || null, toastGuid: probe.toastGuid || null });
    setMatches(r.ok ? r.data.matches ?? [] : []);
  };
  const needsRehireReason = matches.some((m) => m.rehire === "no");
  const rehireBlocked = matches.length > 0 && (!ack || matches.some((m) => !m.mayProceed) || (needsRehireReason && rehireReason.trim() === ""));

  const toggleLocation = (id: string) => {
    setLocationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSubmit = async () => {
    if (submitting || role === "" || picksBlocked || rehireBlocked) return;
    setErrorMsg(null);
    const stepUp = await requestStepUp("B");
    if (stepUp !== "ok") return;
    setSubmitting(true);
    const result = await postJsonData<{ userId?: string; toastLink?: string }>("/api/admin/users", {
      name: name.trim(),
      role,
      email: hasEmailAuth ? email.trim() : null,
      tempPin: tempPin.trim(),
      tempPassword: hasEmailAuth ? tempPassword : null,
      locationIds: needsLocations ? locationIds : [],
      phone: phone.trim() || null,
      toast: toastGuid && toastShop ? { locationId: toastShop.id, employeeGuid: toastGuid } : null,
      confirmRehire: matches.length > 0 && ack,
      rehireReason: needsRehireReason ? rehireReason.trim() : null,
    });
    if (!result.ok) {
      setSubmitting(false);
      const sent = (result.body as { matches?: RehireMatch[] } | undefined)?.matches;
      if (Array.isArray(sent)) { setMatches(sent); setAck(false); }
      setErrorMsg(t(resolveErrorKey(result.code)));
      return;
    }
    const userId = result.data?.userId;
    if (result.data?.toastLink === "failed") {
      setSubmitting(false);
      setCreatedOnly(true);
      setErrorMsg(t("admin.users.create.toast.link_failed"));
      router.refresh();
      return;
    }
    if (offersPositions && userId) {
      const code = await savePicks(userId, chosenPicks, positionShops!);
      if (code) {
        setSubmitting(false);
        setCreatedOnly(true);
        setErrorMsg(t("admin.users.positions.saved_partial", { error: t(scheduleErrorKey(code)) }));
        router.refresh();
        return;
      }
    }
    setSubmitting(false);
    onClose();
    router.refresh();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("admin.users.create.title")}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-co-text/40 p-4"
    >
      <div className="mt-8 w-full max-w-md rounded-2xl border-2 border-co-border bg-co-surface p-5 shadow-lg">
        <h2 className="text-lg font-extrabold text-co-text">{t("admin.users.create.title")}</h2>

        <div className="mt-4 flex flex-col gap-4">
          <label className="block">
            <span className="text-sm font-bold text-co-text">{t("admin.users.create.field.name")}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
            />
          </label>

          <label className="block">
            <span className="text-sm font-bold text-co-text">{t("admin.users.create.field.role")}</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as RoleCode)}
              className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}` as TranslationKey)}
                </option>
              ))}
            </select>
          </label>

          {hasEmailAuth ? (
            <>
              <label className="block">
                <span className="text-sm font-bold text-co-text">{t("admin.users.create.field.email")}</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                />
                <span className="mt-1 block text-[11px] text-co-text-muted">{t("admin.users.create.field.email_help")}</span>
              </label>

              <label className="block">
                <span className="text-sm font-bold text-co-text">{t("admin.users.create.field.temp_password")}</span>
                <input
                  type="text"
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                />
                <span className="mt-1 block text-[11px] text-co-text-muted">{t("admin.users.create.field.temp_password_help")}</span>
              </label>
            </>
          ) : null}

          <label className="block">
            <span className="text-sm font-bold text-co-text">{t("admin.users.create.field.phone")}</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={40}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => void checkRehire({ phone, toastGuid })}
              className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
            />
            <span className="mt-1 block text-[11px] text-co-text-muted">{t("admin.users.create.field.phone_help")}</span>
          </label>

          <label className="block">
            <span className="text-sm font-bold text-co-text">{t("admin.users.create.field.temp_pin")}</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={tempPin}
              onChange={(e) => setTempPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
            />
            <span className="mt-1 block text-[11px] text-co-text-muted">{t("admin.users.create.field.temp_pin_help")}</span>
          </label>

          {needsLocations ? (
            <fieldset className="block">
              <legend className="text-sm font-bold text-co-text">{t("admin.users.create.field.locations")}</legend>
              <div className="mt-2 flex flex-col gap-2">
                {accessibleLocations.map((loc) => (
                  <label key={loc.id} className="flex min-h-[44px] items-center gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3">
                    <input
                      type="checkbox"
                      checked={locationIds.includes(loc.id)}
                      onChange={() => toggleLocation(loc.id)}
                      className="h-5 w-5 accent-co-gold"
                    />
                    <span className="text-sm text-co-text">
                      {loc.code} · {loc.name}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {toastPickerEnabled && toastShop ? (
            <label className="block">
              <span className="text-sm font-bold text-co-text">{t("admin.users.create.field.toast", { shop: toastShop.name })}</span>
              {shownRoster.state === "ok" ? (
                <select
                  value={toastGuid}
                  onChange={(e) => { setToastGuid(e.target.value); void checkRehire({ phone, toastGuid: e.target.value }); }}
                  className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                >
                  <option value="">{t("admin.users.create.toast.none")}</option>
                  {shownRoster.list.map((e) => <option key={e.guid} value={e.guid}>{e.name}</option>)}
                </select>
              ) : (
                <span className="mt-1 block text-[11px] text-co-text-muted">
                  {t(shownRoster.state === "unavailable" ? "admin.users.create.toast.unavailable" : "admin.users.create.toast.loading")}
                </span>
              )}
            </label>
          ) : null}

          <RehireMatches matches={matches} />
          {matches.length > 0 && matches.every((m) => m.mayProceed) ? (
            <label className="flex min-h-[44px] items-center gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="h-5 w-5 accent-co-gold" />
              <span className="text-sm text-co-text">{t("admin.users.rehire.confirm")}</span>
            </label>
          ) : null}
          {matches.length > 0 && matches.every((m) => m.mayProceed) && needsRehireReason ? (
            <label className="block">
              <span className="text-sm font-bold text-co-text">{t("admin.users.rehire.reason")}</span>
              <textarea rows={2} required maxLength={1000} value={rehireReason} onChange={(e) => setRehireReason(e.target.value)}
                className="mt-1 w-full rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60" />
              <span className="mt-1 block text-[11px] text-co-text-muted">{t("admin.users.rehire.reason_help")}</span>
            </label>
          ) : null}

          {offersPositions && locationIds.length > 0 ? (
            <div className="flex flex-col gap-3" data-create-positions>
              <div>
                <h3 className="text-sm font-bold text-co-text">{t("admin.users.positions.title")}</h3>
                <p className="mt-1 text-[11px] text-co-text-muted">{t("admin.users.positions.help")}</p>
              </div>
              {accessibleLocations.filter((l) => locationIds.includes(l.id)).map((loc) => (
                <ShopPositionFields key={loc.id} userId={null} role={role as RoleCode} location={loc} shop={positionShops![loc.id]}
                  pick={picks[loc.id] ?? pickOf(null)} onChange={(next) => setPicks((cur) => ({ ...cur, [loc.id]: next }))} />
              ))}
            </div>
          ) : null}

          {errorMsg ? <p role="alert" className="text-sm text-co-cta-text">{errorMsg}</p> : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(createdOnly ? "admin.users.positions.close" : "admin.users.cancel")}
          </button>
          {createdOnly ? null : <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || picksBlocked || rehireBlocked || name.trim() === "" || role === "" || tempPin.length !== 4}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("admin.users.create.submit")}
          </button>}
        </div>
      </div>
    </div>
  );
}
