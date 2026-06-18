"use client";

/**
 * Login page — Phase 2 Session 4.
 *
 * Two surfaces share this route:
 *   - "tile":    location → role → name → PIN. Level ≤ 7 location-scoped roles.
 *   - "manager": email + password form. Level ≥ 6 (and especially level ≥ 8
 *                MoO/Owner/CGS who aren't location-scoped, so they don't
 *                appear in tile-flow name pickers).
 *
 * Top-right link mirrors itself across surfaces:
 *   tile flow:  "Manager login →"   → switches to manager surface
 *   manager:    "Use tile login →"  → switches back to tile flow
 *
 * Tile state is preserved across surface flips so a manager who fat-fingers
 * the link doesn't lose their location/role/name picks.
 *
 * API wiring:
 *   GET  /api/locations               (public)  — populate tile flow
 *   GET  /api/users/login-options     (public)  — populate name step
 *   POST /api/auth/pin                (public)  — tile-flow sign-in
 *   POST /api/auth/password           (public)  — manager sign-in (in form)
 *   POST /api/auth/password-reset-request (public) — forgot-password (in form)
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { LocationTile } from "@/components/auth/LocationTile";
import { RoleTile } from "@/components/auth/RoleTile";
import { NameTile } from "@/components/auth/NameTile";
import { PinKeypad, type PinKeypadError } from "@/components/auth/PinKeypad";
import { ManagerLoginForm } from "@/components/auth/ManagerLoginForm";
import type { RoleCode } from "@/lib/roles";
import { TranslationProvider, useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";

interface LocationLite {
  id: string;
  name: string;
  code: string;
  type: "permanent" | "dark_kitchen";
}

interface UserLite {
  id: string;
  name: string;
  role: RoleCode;
}

type Surface = "tile" | "manager";

type Step =
  | { kind: "location" }
  | { kind: "role"; locationId: string; locationName: string; locationCode: string }
  | {
      kind: "name";
      locationId: string;
      locationName: string;
      locationCode: string;
      role: RoleCode;
    }
  | {
      kind: "pin";
      locationId: string;
      locationName: string;
      locationCode: string;
      role: RoleCode;
      userId: string;
      userName: string;
    };

const TILE_FLOW_ROLES: RoleCode[] = [
  "gm",
  "agm",
  "catering_mgr",
  "shift_lead",
  "key_holder",
  "trainer",
  "employee",
  "trainee",
];

export default function LoginPage() {
  // Suspense boundary required by Next 16 because LoginPageContent reads
  // useSearchParams() — the static prerender pass bails to client-side render
  // for that subtree, then hydrates the live URL on mount. AuthShell visual
  // frame renders inside the content tree, so a null fallback is fine here.
  // Pre-auth surface lives outside the (authed) group, so there's no ancestor
  // TranslationProvider. Wrap the page tree here (default EN — no toggle yet,
  // per Juan) so every auth component below can call useTranslation().
  return (
    <Suspense fallback={null}>
      <TranslationProvider initialLanguage="en">
        <LoginPageContent />
      </TranslationProvider>
    </Suspense>
  );
}

function LoginPageContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const idleReason = searchParams?.get("reason") === "idle";

  const [surface, setSurface] = useState<Surface>("tile");
  const [step, setStep] = useState<Step>({ kind: "location" });

  const [locations, setLocations] = useState<LocationLite[] | null>(null);
  const [locationsError, setLocationsError] = useState<string | null>(null);

  const [users, setUsers] = useState<UserLite[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);

  // Transient toast (network/server errors). Auto-dismisses after 5s.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  const navigateToDashboard = useCallback(() => {
    const next = searchParams?.get("next");
    router.push(next && next.startsWith("/") ? next : "/dashboard");
  }, [router, searchParams]);

  // Initial location load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/locations", { redirect: "manual" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { locations: LocationLite[] };
        if (!cancelled) setLocations(body.locations);
      } catch {
        if (!cancelled) setLocationsError(t("auth.login.error_load_locations"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  // Reset the user list on step change via render-phase compare. The synchronous
  // setUsers(null)/setUsersError(null) used to live in the load effect below,
  // which trips react-hooks/set-state-in-effect. `step` is a stable useState
  // value, so identity comparison is reliable.
  const [prevStep, setPrevStep] = useState(step);
  if (step !== prevStep) {
    setPrevStep(step);
    if (step.kind === "name") {
      setUsers(null);
      setUsersError(null);
    }
  }

  // Load users when (location, role) is set.
  useEffect(() => {
    if (step.kind !== "name") return;
    let cancelled = false;
    (async () => {
      try {
        const url = `/api/users/login-options?location_id=${encodeURIComponent(
          step.locationId,
        )}&role=${encodeURIComponent(step.role)}`;
        const res = await fetch(url, { redirect: "manual" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { users: UserLite[] };
        if (!cancelled) setUsers(body.users);
      } catch {
        if (!cancelled) setUsersError(t("auth.login.error_load_users"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, t]);

  const handlePinSubmit = useCallback(
    async (pin: string): Promise<{ ok: true } | { ok: false; error: PinKeypadError }> => {
      if (step.kind !== "pin") return { ok: false, error: { kind: "network" } };
      try {
        const res = await fetch("/api/auth/pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: step.userId, pin }),
          redirect: "manual",
        });
        if (res.ok) {
          navigateToDashboard();
          return { ok: true };
        }
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          retry_after_seconds?: number;
        };
        if (res.status === 423 && body.code === "account_locked") {
          return {
            ok: false,
            error: { kind: "locked", retryAfterSeconds: body.retry_after_seconds ?? 60 },
          };
        }
        if (res.status === 403 && body.code === "account_inactive") {
          return { ok: false, error: { kind: "inactive" } };
        }
        return { ok: false, error: { kind: "invalid" } };
      } catch {
        return { ok: false, error: { kind: "network" } };
      }
    },
    [step, navigateToDashboard],
  );

  const stepHeading = useMemo(() => {
    switch (step.kind) {
      case "location":
        return t("auth.login.heading_location");
      case "role":
        return t("auth.login.heading_role");
      case "name":
        return t("auth.login.heading_name");
      case "pin":
        return "";
    }
  }, [step.kind, t]);

  return (
    <main className="flex min-h-screen flex-col bg-co-bg">
      <header className="flex flex-col items-center justify-center bg-co-gold px-6 py-5 sm:py-6">
        <h1
          className="
            text-center font-extrabold uppercase leading-none tracking-[-0.02em]
            text-co-text
            text-[28px] sm:text-[32px]
          "
          style={{ fontFamily: "var(--font-display)" }}
        >
          Compliments Only
        </h1>
        <p className="mt-1 text-center text-[10px] font-bold uppercase tracking-[0.32em] text-co-text/70">
          {t("auth.brand.tagline")}
        </p>
      </header>

      <div className="flex justify-end px-4 pt-3 sm:px-6">
        <button
          type="button"
          onClick={() => setSurface((s) => (s === "tile" ? "manager" : "tile"))}
          className="
            text-sm font-semibold text-co-text-dim
            hover:text-co-cta hover:underline focus:outline-none
            focus-visible:ring-2 focus-visible:ring-co-gold
          "
        >
          {surface === "tile" ? t("auth.login.surface_to_manager") : t("auth.login.surface_to_tile")}
        </button>
      </div>

      {toast && (
        <div role="alert" className="mx-auto mt-3 w-full max-w-md px-4 sm:px-6">
          <div className="rounded-xl border-2 border-co-cta bg-co-cta/10 px-4 py-3 text-center text-sm font-semibold text-co-text">
            {toast}
          </div>
        </div>
      )}

      <section className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-8 pt-2 sm:px-6">
        {idleReason && surface === "tile" && step.kind === "location" && (
          <div
            role="status"
            className="
              mb-4 rounded-xl border-2 border-co-border-2 bg-co-surface px-4 py-3
              text-center text-sm font-medium text-co-text-muted
            "
          >
            {t("auth.login.idle_signed_out")}
          </div>
        )}

        {surface === "manager" ? (
          <ManagerSurface onSuccess={navigateToDashboard} onTransientError={showToast} />
        ) : (
          <>
            {step.kind !== "pin" && (
              <h2 className="mb-4 mt-2 text-center text-2xl font-extrabold leading-tight text-co-text">
                {stepHeading}
              </h2>
            )}

            {step.kind === "location" && (
              <LocationStep
                locations={locations}
                error={locationsError}
                onSelect={(loc) =>
                  setStep({
                    kind: "role",
                    locationId: loc.id,
                    locationName: loc.name,
                    locationCode: loc.code,
                  })
                }
              />
            )}

            {step.kind === "role" && (
              <>
                <Crumb label={`${step.locationCode} · ${step.locationName}`} />
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {TILE_FLOW_ROLES.map((r) => (
                    <RoleTile
                      key={r}
                      role={r}
                      onSelect={() =>
                        setStep({
                          kind: "name",
                          locationId: step.locationId,
                          locationName: step.locationName,
                          locationCode: step.locationCode,
                          role: r,
                        })
                      }
                    />
                  ))}
                </div>
                <BackButton onClick={() => setStep({ kind: "location" })} />
              </>
            )}

            {step.kind === "name" && (
              <>
                <Crumb
                  label={`${step.locationCode} · ${step.locationName} · ${t(`role.${step.role}` as TranslationKey)}`}
                />
                <NameStep
                  users={users}
                  error={usersError}
                  onSelect={(u) =>
                    setStep({
                      kind: "pin",
                      locationId: step.locationId,
                      locationName: step.locationName,
                      locationCode: step.locationCode,
                      role: step.role,
                      userId: u.id,
                      userName: u.name,
                    })
                  }
                />
                <BackButton
                  onClick={() =>
                    setStep({
                      kind: "role",
                      locationId: step.locationId,
                      locationName: step.locationName,
                      locationCode: step.locationCode,
                    })
                  }
                />
              </>
            )}

            {step.kind === "pin" && (
              <PinKeypad
                userName={step.userName}
                role={step.role}
                onSubmit={handlePinSubmit}
                onBack={() =>
                  setStep({
                    kind: "name",
                    locationId: step.locationId,
                    locationName: step.locationName,
                    locationCode: step.locationCode,
                    role: step.role,
                  })
                }
              />
            )}
          </>
        )}
      </section>
    </main>
  );
}

function ManagerSurface({
  onSuccess,
  onTransientError,
}: {
  onSuccess: () => void;
  onTransientError: (m: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-2">
      <h2 className="mb-1 mt-2 text-center text-2xl font-extrabold leading-tight text-co-text">
        {t("auth.manager.heading")}
      </h2>
      <p className="mb-5 text-center text-sm text-co-text-muted">
        {t("auth.manager.subtitle")}
      </p>
      <div
        className="
          rounded-2xl border-2 border-co-border bg-co-surface p-5 shadow-sm
          sm:p-6
        "
      >
        <ManagerLoginForm onSuccess={onSuccess} onTransientError={onTransientError} />
      </div>
    </div>
  );
}

function Crumb({ label }: { label: string }) {
  return (
    <p className="text-center text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
      {label}
    </p>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mt-6 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        className="
          inline-flex items-center gap-1 px-3 py-2 text-sm font-semibold text-co-text
          hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold
        "
      >
        <span aria-hidden>←</span> {t("auth.login.back")}
      </button>
    </div>
  );
}

function LocationStep({
  locations,
  error,
  onSelect,
}: {
  locations: LocationLite[] | null;
  error: string | null;
  onSelect: (loc: LocationLite) => void;
}) {
  const { t } = useTranslation();
  if (error) {
    return (
      <div
        role="alert"
        className="rounded-xl border-2 border-co-cta bg-co-cta/10 px-4 py-3 text-center text-sm font-semibold text-co-text"
      >
        {error}
      </div>
    );
  }
  if (!locations) {
    return (
      <div className="grid grid-cols-2 gap-3" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="min-h-[120px] animate-pulse rounded-2xl border-2 border-co-border bg-co-surface-2"
          />
        ))}
      </div>
    );
  }
  if (locations.length === 0) {
    return (
      <p className="text-center text-sm text-co-text-muted">
        {t("auth.login.no_locations")}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {locations.map((loc) => (
        <LocationTile
          key={loc.id}
          name={loc.name}
          code={loc.code}
          onSelect={() => onSelect(loc)}
        />
      ))}
    </div>
  );
}

function NameStep({
  users,
  error,
  onSelect,
}: {
  users: UserLite[] | null;
  error: string | null;
  onSelect: (u: UserLite) => void;
}) {
  const { t } = useTranslation();
  if (error) {
    return (
      <div
        role="alert"
        className="mt-3 rounded-xl border-2 border-co-cta bg-co-cta/10 px-4 py-3 text-center text-sm font-semibold text-co-text"
      >
        {error}
      </div>
    );
  }
  if (!users) {
    return (
      <div className="mt-3 grid grid-cols-2 gap-3" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="min-h-[120px] animate-pulse rounded-2xl border-2 border-co-border bg-co-surface-2"
          />
        ))}
      </div>
    );
  }
  if (users.length === 0) {
    return (
      <p className="mt-6 text-center text-sm text-co-text-muted">
        {t("auth.login.no_users")}
      </p>
    );
  }
  return (
    <div className="mt-3 grid grid-cols-2 gap-3">
      {users.map((u) => (
        <NameTile key={u.id} name={u.name} onSelect={() => onSelect(u)} />
      ))}
    </div>
  );
}
