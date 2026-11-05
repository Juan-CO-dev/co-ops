import { describe, expect, it, vi } from "vitest";
// Plain operator script, imported without running its CLI or opening a connection.
import { preflightManagement } from "../scripts/preflight-0276-management.mjs";
import { preflight, signatures } from "../scripts/preflight-0276.mjs";

describe("0276 deployment preflight", () => {
  it.each([
    "public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text,uuid,text)",
    "public.checklist_replace_closing_ref(uuid,uuid,uuid,uuid,jsonb)",
    "public.checklist_revoke_completion(uuid,uuid)",
    "public.checklist_revoke_with_reason(uuid,uuid,text,text)",
    "public.checklist_mark_not_done(uuid,uuid,text)",
  ])("blocks deployment without required correction/reference function %s", async missing => {
    expect(signatures).toContain(missing);
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("unnest")
      ? signatures.map(signature => ({ signature, present: signature !== missing, executable: true })) : [] }));
    await expect(preflight({ query })).rejects.toThrow(missing);
    expect(query.mock.calls.at(-1)).toEqual(["rollback"]);
  });
  it.each(["complete", "missing", "no-execute", "query-error"])("catalog-only read transaction: %s", async state => {
    const query = vi.fn(async (sql: string) => {
      if (!sql.includes("unnest")) return { rows: [] };
      if (state === "query-error") throw new Error("catalog failed");
      return { rows: signatures.map((signature: string, index: number) => ({
        signature, present: state !== "missing" || index !== 0,
        executable: state !== "no-execute" || index !== 0,
      })) };
    });
    if (state === "complete") await expect(preflight({ query })).resolves.toHaveLength(11);
    else await expect(preflight({ query })).rejects.toThrow(state === "query-error" ? "catalog failed" : "0276_missing");
    expect(query.mock.calls[0]).toEqual(["begin read only"]);
    expect(query.mock.calls.at(-1)).toEqual(["rollback"]);
    const sql = query.mock.calls.map(call => call[0]).join("\n");
    expect(sql).toContain("has_function_privilege('service_role'");
    expect(sql).not.toMatch(/\b(insert|update|delete|grant|revoke|commit)\b/i);
  });
});


describe("0291 Management deployment preflight", () => {
  const prep = "public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text,uuid,text)";
  it.each(["present", "missing", "no-execute"])("requires the new signature and grant: %s", async state => {
    const query = vi.fn(async (_sql: string) => signatures.map((signature: string) => ({
      signature, present: state !== "missing" || signature !== prep,
      executable: state !== "no-execute" || signature !== prep,
    })));
    if (state === "present") await expect(preflightManagement(query)).resolves.toHaveLength(11);
    else await expect(preflightManagement(query)).rejects.toThrow("missing");
    expect(query.mock.calls[0]?.[0]).toContain(prep);
    expect(query.mock.calls[0]?.[0]).toMatch(/^begin read only;/);
  });
});
