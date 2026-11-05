import { getRoleLevel, type RoleCode } from "@/lib/roles";
import type { MenuCostRow } from "@/lib/menu-costing-shared";
import { OPERATIONAL_LEVEL6_ROLES } from "@/lib/people/access-shared";

export const SANDWICHES_VIEW_ROLES: readonly RoleCode[] = [...OPERATIONAL_LEVEL6_ROLES, "gm", "moo", "owner", "cgs"];
export function canViewSandwiches(role: RoleCode): boolean {
  return role !== "social_media_mgr" && getRoleLevel(role) >= 6;
}
export type SandwichRow = MenuCostRow & {
  soldHere: boolean;
  toastStatus: "linked" | "linked_via_parent" | "not_linked" | "price_differs" | "unavailable";
  marginPct: number | null;
};
export type SandwichFilter = "sold" | "off" | "all";
export const SANDWICH_PROBLEMS = ["no_cost", "not_linked", "price_differs", "over_threshold"] as const;
export type SandwichProblem = typeof SANDWICH_PROBLEMS[number];

export function sandwichProblems(rows: readonly SandwichRow[]) {
  const causes: Record<SandwichProblem, SandwichRow[]> = { no_cost: [], not_linked: [], price_differs: [], over_threshold: [] };
  let count = 0;
  for (const row of rows) {
    if (!row.soldHere) continue;
    const problems: SandwichProblem[] = [];
    if (row.overThreshold) problems.push("over_threshold");
    if (row.rollup.cost === null) problems.push("no_cost");
    if (row.toastStatus === "not_linked") problems.push("not_linked");
    if (row.toastStatus === "price_differs") problems.push("price_differs");
    if (problems.length) count++;
    for (const cause of problems) causes[cause].push(row);
  }
  return { count, causes };
}

export function filterSandwiches(rows: readonly SandwichRow[], filter: SandwichFilter, search: string): SandwichRow[] {
  const query = search.trim().toLocaleLowerCase();
  return rows.filter(row => (filter === "all" || row.soldHere === (filter === "sold")) &&
    `${row.name} ${row.nameEs ?? ""}`.toLocaleLowerCase().includes(query));
}
