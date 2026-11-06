import { permanentRedirect } from "next/navigation";

export default async function AdminMenuCostingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { location } = await searchParams;
  const query = new URLSearchParams();
  for (const value of Array.isArray(location) ? location : location === undefined ? [] : [location]) query.append("location", value);
  permanentRedirect("/admin/sandwiches" + (query.size ? "?" + query : ""));
}
