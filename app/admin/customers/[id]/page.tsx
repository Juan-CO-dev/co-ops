import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import { CUSTOMER_CONTACT_MIN, CUSTOMER_STATS_MIN, CustomerError, customerProfilesEnabled, loadProfileDetail } from "@/lib/customers/customers";
import { CustomerContactPanel } from "@/components/admin/customers/CustomerContactPanel";
import { ProfileDetail } from "@/components/admin/customers/ProfileDetail";

/** One profile. Stats for GM+ (shop-bound); level 9+ also gets the audited contact reveal and delete-on-request. */
export default async function CustomerProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireSessionFromHeaders("/admin/customers");
  if (auth.level < CUSTOMER_STATS_MIN) redirect("/admin");
  if (!customerProfilesEnabled()) redirect("/admin/customers");
  const { id } = await params;
  const language = auth.user.language;
  const viewer = { userId: auth.user.id, level: auth.level, locations: auth.locations };
  const raw = await searchParams;
  let detail;
  try { detail = await loadProfileDetail(viewer, id, { page: typeof raw.page === "string" && /^\d+$/.test(raw.page) ? Number(raw.page) : 1 }); }
  catch (error) {
    if (error instanceof CustomerError && [400, 403, 404].includes(error.status)) notFound();
    throw error;
  }
  return <div className="min-w-0 space-y-4">
    <Link href="/admin/customers" className="inline-flex min-h-[44px] items-center font-bold text-co-text underline">{serverT(language, "customers.back")}</Link>
    <ProfileDetail detail={detail} language={language} canRevoke={auth.level >= CUSTOMER_CONTACT_MIN} />
    {auth.level >= CUSTOMER_CONTACT_MIN && <CustomerContactPanel customerId={detail.profile.id} />}
  </div>;
}
