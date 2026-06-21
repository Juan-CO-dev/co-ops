"use client";

/**
 * CreateUserForm — Tier-A "Add user" modal (C.44 Task 13).
 *
 * Role-conditional fields:
 *   - email + temp password show ONLY when ROLES[role].hasEmailAuth (level >= 6)
 *   - locations multiselect shows ONLY when getRoleLevel(role) < 9
 * Submit: requestStepUp("A") → POST /api/admin/users → close + router.refresh().
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { ROLES, getRoleLevel, type RoleCode } from "@/lib/roles";
import type { TranslationKey } from "@/lib/i18n/types";
import { postJson, resolveErrorKey, type LocationOption } from "./shared";

export function CreateUserForm({
  assignableRoles,
  accessibleLocations,
  onClose,
}: {
  assignableRoles: RoleCode[];
  accessibleLocations: LocationOption[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const firstRole = assignableRoles[0];
  const [name, setName] = useState("");
  const [role, setRole] = useState<RoleCode | "">(firstRole ?? "");
  const [email, setEmail] = useState("");
  const [tempPin, setTempPin] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hasEmailAuth = role !== "" && ROLES[role].hasEmailAuth;
  const needsLocations = role !== "" && getRoleLevel(role) < 9;

  const toggleLocation = (id: string) => {
    setLocationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSubmit = async () => {
    if (submitting || role === "") return;
    setErrorMsg(null);
    const stepUp = await requestStepUp("A");
    if (stepUp !== "ok") return;
    setSubmitting(true);
    const result = await postJson("/api/admin/users", {
      name: name.trim(),
      role,
      email: hasEmailAuth ? email.trim() : null,
      tempPin: tempPin.trim(),
      tempPassword: hasEmailAuth ? tempPassword : null,
      locationIds: needsLocations ? locationIds : [],
    });
    setSubmitting(false);
    if (result.ok) {
      onClose();
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("admin.users.create.title")}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-co-text/40 p-4"
    >
      <div className="mt-8 w-full max-w-md rounded-xl border-2 border-co-border bg-co-surface p-5 shadow-lg">
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

          {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("admin.users.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || name.trim() === "" || role === "" || tempPin.length !== 4}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("admin.users.create.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
