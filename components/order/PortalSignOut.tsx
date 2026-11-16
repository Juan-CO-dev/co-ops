/**
 * The customer portal's "Sign out" control (W23/B210). A plain form POST to /api/portal/logout:
 * no client JS, and the browser sends Origin on a form POST, so the route's same-origin check
 * passes. English like the rest of the portal today (owner decision W23-3 a), through an en + es key.
 */
import { serverT } from "@/lib/i18n/server";

export function PortalSignOut({ lang }: { lang: "en" | "es" }) {
  return (
    <form method="post" action="/api/portal/logout" className="flex w-24 justify-end">
      <button type="submit"
        className="inline-flex min-h-[44px] items-center text-sm font-semibold text-co-bg/70 transition hover:text-co-bg">
        {serverT(lang, "order.portal.sign_out")}
      </button>
    </form>
  );
}

/** Review r1 (BC-032/BC-033): shown on /order/account?signout=failed, where the logout route sends
 *  the browser when the server could not end the session. The cookie was kept, so the header's
 *  Sign out simply tries again. */
export function PortalSignOutFailed({ lang }: { lang: "en" | "es" }) {
  return (
    <p role="alert" className="mb-6 rounded-2xl border border-co-danger bg-co-danger-surface px-5 py-4 text-sm font-semibold text-co-cta-text">
      {serverT(lang, "order.portal.sign_out_failed")}
    </p>
  );
}
