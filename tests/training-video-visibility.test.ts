import { describe, expect, it, vi } from "vitest";
import { bindTrainingPlayback, trainingVisibility, videoAutoplayAllowed } from "../lib/training/video-visibility";

describe("training video-first presentation", () => {
  it("shows the poster/video immediately while the scene is preparing", () => {
    expect(trainingVisibility("loading", true, false)).toEqual({ video: true, scene: false, steps: false });
  });
  it.each(["failed", "unavailable"] as const)("retains video when scene is %s", (status) => {
    expect(trainingVisibility(status, true, false)).toEqual({ video: true, scene: false, steps: false });
  });
  it("swaps to the scene only when ready, including after a video error", () => {
    for (const failed of [true, false]) {
      expect(trainingVisibility("ready", true, failed)).toEqual({ video: false, scene: true, steps: false });
    }
  });
  it.each(["loading", "failed", "unavailable"] as const)("teaches steps if video is absent or fails and scene is %s", (status) => {
    expect(trainingVisibility(status, false, false)).toEqual({ video: false, scene: false, steps: true });
    expect(trainingVisibility(status, true, true)).toEqual({ video: false, scene: false, steps: true });
  });
  it("a fresh language mount returns to video-first after a ready scene", () => {
    expect(trainingVisibility("ready", true, false).scene).toBe(true);
    expect(trainingVisibility("loading", true, false).video).toBe(true);
  });
  it("never autoplays before the motion preference is known, or with reduced motion", () => {
    expect(videoAutoplayAllowed(null)).toBe(false);
    expect(videoAutoplayAllowed(true)).toBe(false);
    expect(videoAutoplayAllowed(false)).toBe(true);
  });
  it("pauses mid-playback and detaches the preference listener when the video leaves", () => {
    const video = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() };
    const preference = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const cleanup = bindTrainingPlayback(video, preference);
    expect(video.play).toHaveBeenCalledOnce();
    cleanup();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(preference.removeEventListener).toHaveBeenCalledWith("change", preference.addEventListener.mock.calls[0]?.[1]);
  });
  it("keeps the poster and manual controls available for reduced motion", () => {
    const video = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() };
    bindTrainingPlayback(video, { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    expect(video.play).not.toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalledOnce();
  });
  it("a blocked autoplay attempt is handled without treating the video as broken", async () => {
    const video = { play: vi.fn().mockRejectedValue(new Error("NotAllowedError")), pause: vi.fn() };
    const cleanup = bindTrainingPlayback(video, { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    await Promise.resolve();
    cleanup();
    expect(video.pause).toHaveBeenCalledOnce();
  });
});
