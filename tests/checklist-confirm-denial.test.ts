import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ChecklistRoleViolationError } from "@/lib/checklists";
import { mapChecklistError } from "@/app/api/checklist/_helpers";

it("LRA-221: zero-row confirmation keeps the closed 409 and otherwise maps its typed denial to 403", async () => {
  const source = readFileSync("lib/checklists.ts", "utf8");
  const start = source.indexOf("if (!updatedRow)", source.indexOf("export async function confirmInstance("));
  const branch = source.slice(start, source.indexOf("// 2+3.", start));
  expect(branch).toContain('if (cur && cur.status !== "open")');
  expect(branch).toContain("throw new ChecklistInstanceClosedError(instanceId, cur.status)");
  expect(branch).toContain("throw new ChecklistRoleViolationError(3, actor.level");
  expect(branch).not.toContain("throw new Error(");
  const response = mapChecklistError(new ChecklistRoleViolationError(3, 7));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "role_level_insufficient" });
});
