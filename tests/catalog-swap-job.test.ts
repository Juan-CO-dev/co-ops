import { describe, expect, it, vi } from "vitest";
import { createSwapReview, confirmSwapReview } from "@/lib/catalog/swap-job-shared";
import type { PublicSwapPreview } from "@/lib/catalog/job-preview-shared";

const preview = { request: { oldSkuId: "old", newSkuId: "new", scope: "shop", mode: "for_now", productName: "Normalized", productNameEs: null, note: null }, token: "hash", refused: [] } as unknown as PublicSwapPreview;
describe("swap review identity", () => {
  it("posts exactly the normalized request hashed by preview plus its token", async () => {
    const review = createSwapReview(); const ticket = review.begin(); review.accept(ticket, preview);
    const post = vi.fn(async () => ({ kind: "response" as const, data: { swapId: "10000000-0000-4000-8000-000000000001" } }));
    expect(await confirmSwapReview(review, async () => "ok", post)).toEqual({ kind: "saved" });
    expect(post).toHaveBeenCalledWith({ ...preview.request, previewToken: "hash" });
    expect(review.current()).toBeNull();
  });
  it("rejects delayed previews after changes and after a newer request", () => {
    const review = createSwapReview(); const first = review.begin(); review.invalidate();
    expect(review.accept(first, preview)).toBe(false);
    const second = review.begin(); const third = review.begin();
    expect(review.accept(second, preview)).toBe(false); expect(review.accept(third, preview)).toBe(true);
  });
  it("cancellation and scope changes during step-up cannot write", async () => {
    const review = createSwapReview(); review.accept(review.begin(), preview); const post = vi.fn();
    expect(await confirmSwapReview(review, async () => "cancelled", post)).toEqual({ kind: "cancelled" });
    expect(post).not.toHaveBeenCalled();
    expect(await confirmSwapReview(review, async () => { review.invalidate(); return "ok"; }, post)).toEqual({ kind: "cancelled" });
    expect(post).not.toHaveBeenCalled();
  });
  it("stale refusal discards the preview and requires a fresh explicit confirmation", async () => {
    const review = createSwapReview(); review.accept(review.begin(), preview);
    const post = vi.fn(async () => ({ kind: "refused" as const, code: "preview_stale" }));
    expect(await confirmSwapReview(review, async () => "ok", post)).toEqual({ kind: "refused", code: "preview_stale" });
    expect(review.current()).toBeNull();
    expect(await confirmSwapReview(review, async () => "ok", post)).toEqual({ kind: "cancelled" });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("never confirms refused lines, and treats malformed success or transport loss as uncertain", async () => {
    const review = createSwapReview(); review.accept(review.begin(), { ...preview, refused: [{ recipeId: "r", recipeName: "R", position: 1, reason: "unit_unknown" }] });
    const post = vi.fn(); await confirmSwapReview(review, async () => "ok", post); expect(post).not.toHaveBeenCalled();
    review.accept(review.begin(), preview);
    expect(await confirmSwapReview(review, async () => "ok", async () => ({ kind: "response", data: {} }))).toEqual({ kind: "uncertain" });
    review.accept(review.begin(), preview);
    expect(await confirmSwapReview(review, async () => "ok", async () => { throw new Error("offline"); })).toEqual({ kind: "uncertain" });
  });
});
