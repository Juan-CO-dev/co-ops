/**
 * Page a PostgREST query past the 1000-row default cap. `build(from, to)` must
 * return a query with `.range(from, to)` (and a stable `.order(...)`). Without
 * this, an all-rows scan silently truncates at 1000 (the PR #63 lesson).
 * Extracted from lib/team-metrics.ts so multiple loaders can share it.
 */
export async function selectAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = await build(from, from + pageSize - 1);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
