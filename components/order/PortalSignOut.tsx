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
