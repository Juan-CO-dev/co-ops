import { describe, expect, it } from "vitest";
import { isCateringInboxSendPath, isStepUpSurface } from "@/lib/session";

const id = "11111111-1111-4111-8111-111111111111";
describe("catering inbox send unlock survives exactly the send endpoint", () => {
  it("preserves the password unlock for Send draft", () => {
    expect(isCateringInboxSendPath(`/api/catering/inbox/${id}/send`)).toBe(true);
    expect(isStepUpSurface(`/api/catering/inbox/${id}/send`)).toBe(true);
    expect(isStepUpSurface("/api/admin/catering-inbox/settings")).toBe(true);
  });
  it.each([
    "/catering/inbox", "/api/catering/inbox", `/api/catering/inbox/${id}`, `/api/catering/inbox/${id}/handle`, `/api/catering/inbox/${id}/reassign`,
    `/api/catering/inbox/${id}/send/extra`, `/api/catering/inbox/nested/${id}/send`, "/api/catering/inbox//send", "/api/catering/inbox/not-a-uuid/send",
    `/api/catering/inbox/${id}/send-fake`, `/api/catering/inbox/transport:${id}/send`,
  ])("clears it on %s", (path) => { expect(isStepUpSurface(path)).toBe(false); });
});
