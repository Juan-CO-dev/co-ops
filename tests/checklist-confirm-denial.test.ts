import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ChecklistRoleViolationError } from "@/lib/checklists";
import { mapChecklistError } from "@/app/api/checklist/_helpers";

it("LRA-221: RPC confirmation keeps the closed 409 and otherwise maps its typed denial to 403", async () => {
  const source = readFileSync("lib/checklists.ts", "utf8");
  expect(source).toContain('case "instance_not_open":');
  expect(source).toContain('current.status !== "open"');
  expect(source).toContain('new ChecklistInstanceClosedError(instanceId, current.status)');
  expect(source).toContain('case "not_authorized":');
  const response = mapChecklistError(new ChecklistRoleViolationError(3, 7));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "role_level_insufficient" });
});
