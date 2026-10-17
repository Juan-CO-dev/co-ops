/** Client-only review identity: a confirmation belongs to exactly one server preview. */
import type { PublicSwapPreview } from "@/lib/catalog/job-preview-shared";
import { sandwichUuid, type SandwichResponse } from "@/lib/catalog/sandwich-job-shared";

export function createSwapReview() {
  let generation = 0;
  let preview: PublicSwapPreview | null = null;
  return {
    begin() { preview = null; return ++generation; },
    invalidate() { generation++; preview = null; },
    isCurrentTicket: (ticket: number) => ticket === generation,
    accept(ticket: number, value: PublicSwapPreview) {
      if (ticket !== generation) return false;
      preview = value; return true;
    },
    current: () => preview,
  };
}
export type SwapConfirmation = { kind: "saved" | "cancelled" | "uncertain" } | { kind: "refused"; code: string };
export async function confirmSwapReview(
  review: ReturnType<typeof createSwapReview>,
  unlock: () => Promise<string>,
  post: (body: unknown) => Promise<SandwichResponse>,
): Promise<SwapConfirmation> {
  const preview = review.current();
  if (!preview || preview.refused.length) return { kind: "cancelled" };
  try {
    if (await unlock() !== "ok" || review.current() !== preview) return { kind: "cancelled" };
    const result = await post({ ...preview.request, previewToken: preview.token });
    if (review.current() !== preview) return { kind: "cancelled" };
    review.invalidate();
    if (result.kind === "refused") return result;
    return result.kind === "response" && sandwichUuid(result.data.swapId) ? { kind: "saved" } : { kind: "uncertain" };
  } catch { review.invalidate(); return { kind: "uncertain" }; }
}
