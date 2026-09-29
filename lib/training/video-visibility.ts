/** Presentation policy, independent of media loading and the scene's startup timers. */
export function trainingVisibility(
  status: "loading" | "ready" | "failed" | "unavailable",
  hasVideo: boolean,
  videoFailed: boolean,
) {
  const scene = status === "ready";
  const video = !scene && hasVideo && !videoFailed;
  return { video, scene, steps: !scene && !video };
}

/** Unknown preferences (including server rendering) never authorize autoplay. */
export function videoAutoplayAllowed(reducedMotion: boolean | null): boolean {
  return reducedMotion === false;
}

/** Browser operations are injected to test preference changes and teardown without a DOM. */
export function bindTrainingPlayback(
  video: Pick<HTMLVideoElement, "play" | "pause">,
  preference: Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">,
): () => void {
  const update = () => {
    if (videoAutoplayAllowed(preference.matches)) {
      // Autoplay can be refused by browser policy; native controls remain usable.
      void video.play().catch(() => {});
    } else video.pause();
  };
  preference.addEventListener("change", update);
  update();
  return () => {
    preference.removeEventListener("change", update);
    video.pause();
  };
}
