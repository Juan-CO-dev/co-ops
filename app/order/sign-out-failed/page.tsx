/**
 * /order/sign-out-failed — where the logout route sends the browser when it could NOT end the
 * portal session (W23/B210 review r2, BC-032/BC-042).
 *
 * STATIC on purpose: no session read, no account read, no database call. The failure is usually a
 * database failure, and a page that needs the session (like /order/account) would bounce the
 * customer to /order/start without ever saying the sign-out did not go through — while the kept
 * cookie stays live. Here the message and the Sign out retry always render. The retry is the same
 * form POST; the cookie was kept, so it carries the session again. No per-customer content.
 */

import Link from "next/link";
import { PortalSignOutFailed, PortalSignOutRetry } from "@/components/order/PortalSignOut";
import { serverT } from "@/lib/i18n/server";

/** English like the rest of the portal today; strings ship as en + es keys. */
const PORTAL_LANG = "en" as const;

export default function SignOutFailedPage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-co-bg px-5 py-10 text-co-text">
      <PortalSignOutFailed lang={PORTAL_LANG} />
      <div className="flex flex-wrap items-center gap-4">
        <PortalSignOutRetry lang={PORTAL_LANG} />
        <Link href="/order/account"
          className="text-sm font-bold uppercase tracking-wide text-co-text underline decoration-co-gold decoration-2 underline-offset-4">
          {serverT(PORTAL_LANG, "order.portal.back_to_orders")}
        </Link>
      </div>
    </main>
  );
}
