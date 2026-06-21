"use client";

/**
 * UserActions — per-row Tier-B action controls + edit-profile (C.44 Task 13).
 *
 * Tier-B actions (reset PIN, set password, change role, change locations,
 * deactivate/activate) each require requestStepUp("B") before the fetch.
 * Edit profile is Tier A.
 *
 * canActOn gating happens in the parent (UserRow): this component is only
 * mounted when the actor may act on the target.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { type RoleCode } from "@/lib/roles";
import type { AdminUserListItem } from "@/lib/admin/users";
import type { TranslationKey } from "@/lib/i18n/types";
import { postJson, resolveErrorKey, type LocationOption } from "./shared";

type ActiveAction =
  | { kind: "reset_pin" }
  | { kind: "set_password" }
  | { kind: "change_role" }
  | { kind: "change_locations" }
  | { kind: "edit_profile" }
  | { kind: "deactivate" }
  | { kind: "activate" }
  | null;

export function UserActions({
  user,
  assignableRoles,
  accessibleLocations,
}: {
  user: AdminUserListItem;
  assignableRoles: RoleCode[];
  accessibleLocations: LocationOption[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [active, setActive] = useState<ActiveAction>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Controlled inputs for the input-collecting actions.
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RoleCode>(user.role);
  const [locs, setLocs] = useState<string[]>(user.locationIds);
  const [name, setName] = useState(user.name);

  const close = () => {
    setActive(null);
    setSubmitting(false);
    setErrorMsg(null);
    setPin("");
    setPassword("");
    setRole(user.role);
    setLocs(user.locationIds);
    setName(user.name);
  };

  const run = async (tier: "A" | "B", url: string, body: unknown, method: "POST" | "PATCH" = "POST") => {
    if (submitting) return;
    setErrorMsg(null);
    const stepUp = await requestStepUp(tier);
    if (stepUp !== "ok") return;
    setSubmitting(true);
    const result = await postJson(url, body, method);
    setSubmitting(false);
    if (result.ok) {
      close();
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  const base = `/api/admin/users/${user.id}`;

  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton label={t("admin.users.action.reset_pin")} onClick={() => setActive({ kind: "reset_pin" })} />
      <ActionButton label={t("admin.users.action.set_password")} onClick={() => setActive({ kind: "set_password" })} />
      <ActionButton label={t("admin.users.action.change_role")} onClick={() => setActive({ kind: "change_role" })} />
      <ActionButton label={t("admin.users.action.change_locations")} onClick={() => setActive({ kind: "change_locations" })} />
      <ActionButton label={t("admin.users.edit.profile")} onClick={() => setActive({ kind: "edit_profile" })} />
      {user.active ? (
        <ActionButton label={t("admin.users.action.deactivate")} onClick={() => setActive({ kind: "deactivate" })} />
      ) : (
        <ActionButton label={t("admin.users.action.activate")} onClick={() => setActive({ kind: "activate" })} />
      )}

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-co-text/40 p-4"
        >
          <div className="mt-12 w-full max-w-sm rounded-xl border-2 border-co-border bg-co-surface p-5 shadow-lg">
            <h2 className="text-base font-extrabold text-co-text">{user.name}</h2>

            <div className="mt-4 flex flex-col gap-3">
              {active.kind === "reset_pin" ? (
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t("admin.users.prompt.new_pin")}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                  />
                </label>
              ) : null}

              {active.kind === "set_password" ? (
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t("admin.users.prompt.new_password")}</span>
                  <input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                  />
                </label>
              ) : null}

              {active.kind === "change_role" ? (
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t("admin.users.prompt.select_role")}</span>
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
              ) : null}

              {active.kind === "change_locations" ? (
                <fieldset className="block">
                  <legend className="text-sm font-bold text-co-text">{t("admin.users.prompt.select_locations")}</legend>
                  <div className="mt-2 flex flex-col gap-2">
                    {accessibleLocations.map((loc) => (
                      <label key={loc.id} className="flex min-h-[44px] items-center gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3">
                        <input
                          type="checkbox"
                          checked={locs.includes(loc.id)}
                          onChange={() =>
                            setLocs((prev) => (prev.includes(loc.id) ? prev.filter((x) => x !== loc.id) : [...prev, loc.id]))
                          }
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

              {active.kind === "edit_profile" ? (
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t("admin.users.create.field.name")}</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                  />
                </label>
              ) : null}

              {active.kind === "deactivate" ? (
                <p className="text-sm text-co-text">{t("admin.users.confirm.deactivate")}</p>
              ) : null}
              {active.kind === "activate" ? (
                <p className="text-sm text-co-text">{t("admin.users.confirm.activate")}</p>
              ) : null}

              {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={submitting}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("admin.users.cancel")}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  const a = active;
                  if (a.kind === "reset_pin") void run("B", `${base}/reset-pin`, { pin });
                  else if (a.kind === "set_password") void run("B", `${base}/set-password`, { password });
                  else if (a.kind === "change_role") void run("B", `${base}/role`, { role });
                  else if (a.kind === "change_locations") void run("B", `${base}/locations`, { locationIds: locs });
                  else if (a.kind === "edit_profile") void run("A", base, { name: name.trim() }, "PATCH");
                  else if (a.kind === "deactivate") void run("B", `${base}/deactivate`, {});
                  else if (a.kind === "activate") void run("B", `${base}/activate`, {});
                }}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("admin.users.confirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
    >
      {label}
    </button>
  );
}
