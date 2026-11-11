import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { resolveCateringManager } from "@/lib/catering/system-intake-assignee";
import { resolveCateringManager as compatibleExport } from "@/lib/catering/system-intake";

describe("nullable A1.3 assignment and existing caller parity", () => {
  function service(scoped: unknown[], fail = false) {
    const from = vi.fn((table: string) => {
      const value = table === "users" ? { data: [{ id: "first" }, { id: "scoped" }], error: null } : { data: scoped, error: fail ? { message: "failed" } : null };
      const query: Record<string, unknown> = { then: (resolve: (v: unknown) => unknown) => Promise.resolve(value).then(resolve) };
      for (const key of ["select", "eq", "order", "returns", "abortSignal", "in"]) query[key] = () => query;
      return query;
    });
    return { sb: { from } as unknown as Parameters<typeof resolveCateringManager>[0], from };
  }
  it("retains the exact function export for machine tributaries", () => expect(compatibleExport).toBe(resolveCateringManager));
  it("chooses the scoped manager for existing non-null callers", async () => {
    expect(await compatibleExport(service([{ user_id: "scoped" }]).sb, "shop")).toBe("scoped");
  });
  it("retains global fallback only for a successful empty scoped read", async () => {
    expect(await compatibleExport(service([]).sb, "shop")).toBe("first");
    expect(await compatibleExport(service([], true).sb, "shop")).toBeNull();
  });
  it("uses the first global manager for null without querying membership", async () => {
    const { sb, from } = service([]);
    expect(await resolveCateringManager(sb, null)).toBe("first");
    expect(from).toHaveBeenCalledTimes(1);
  });
});
