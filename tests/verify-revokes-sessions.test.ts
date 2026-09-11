import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("LRA-224: first-password verification revokes after a successful write and before either success audit/sign-in", () => {
  const source = readFileSync("app/api/auth/verify/route.ts", "utf8");
  const revoke = source.indexOf("await revokeAllUserSessions(row.user_id)");
  expect(revoke).toBeGreaterThan(source.indexOf("if (updateUserErr || !updatedUser)"));
  expect(revoke).toBeLessThan(source.indexOf("if (!updatedUser.active)"));
  expect(revoke).toBeLessThan(source.indexOf("await recordSuccessfulAuth("));
  expect(source.match(/sessions_revoked: revokedCount/g)).toHaveLength(2);
});
