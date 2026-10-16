"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { shouldLoadMotion, shouldPlayMotion, type MotionState } from "@/lib/landing/media-policy-shared";

/** The server-rendered real photo stays mounted through every failure path. */
export function HeroMotion({ children, src, pauseLabel, playLabel, testId = "hero-motion" }: { children: ReactNode; src: string; pauseLabel: string; playLabel: string; testId?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<MotionState>({ lcpReady:false, triggered:false, visible:false, documentVisible:false, reducedMotion:true, saveData:true, failed:false, paused:false });
  const [attached, setAttached] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
    const preferences = () => setState(s => ({...s, reducedMotion:motion.matches, saveData:connection?.saveData === true, documentVisible:document.visibilityState === "visible"}));
    const scroll = () => setState(s => s.triggered ? s : ({...s, triggered:true}));
    const ready = () => setState(s => ({...s, lcpReady:true}));
    preferences();
    motion.addEventListener("change", preferences);
    connection?.addEventListener("change", preferences);
    document.addEventListener("visibilitychange", preferences);
    window.addEventListener("scroll", scroll, {passive:true});
    let lcp: PerformanceObserver | undefined;
    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("largest-contentful-paint")) {
      lcp = new PerformanceObserver(entries => { if(entries.getEntries().length) ready(); });
      lcp.observe({type:"largest-contentful-paint", buffered:true});
    } else if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready, {once:true});
    const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
      setState(s => ({...s, visible:entries.some(entry => entry.isIntersecting)}));
    }, {threshold:0.1});
    if(container.current) observer?.observe(container.current);
    return () => { motion.removeEventListener("change",preferences); connection?.removeEventListener("change",preferences); document.removeEventListener("visibilitychange",preferences); window.removeEventListener("scroll",scroll); window.removeEventListener("load",ready); observer?.disconnect(); lcp?.disconnect(); };
  }, []);
  const canLoad = shouldLoadMotion(state);
  const canPlay = shouldPlayMotion(state);
  useEffect(() => { if (canLoad) setAttached(true); }, [canLoad]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let cancelled = false;
    if (canPlay) {
      const play = element.play();
      play?.catch(() => { if (!cancelled) { setPlaying(false); setState(s=>({...s,failed:true})); } });
    } else { element.pause(); setPlaying(false); }
    return () => { cancelled = true; };
  }, [canPlay, attached]);
  // Watch actual playback progress, including a stream that freezes after playing.
  // Primitive dependencies keep unrelated scroll/visibility updates from extending it.
  useEffect(() => {
    const element = video.current;
    if (!attached || !canPlay || !element) return;
    let lastTime = element.currentTime;
    let lastProgress = performance.now();
    const progress = () => {
      if (element.currentTime !== lastTime) {
        lastTime = element.currentTime;
        lastProgress = performance.now();
      }
    };
    const timeout = window.setInterval(() => {
      progress();
      if (performance.now() - lastProgress >= 8000) {
        setPlaying(false);
        setState(s => ({...s, failed:true}));
      }
    }, 250);
    element.addEventListener("timeupdate", progress);
    return () => { window.clearInterval(timeout); element.removeEventListener("timeupdate", progress); };
  }, [attached, canPlay]);
  const fail = () => { setPlaying(false); setState(s=>({...s,failed:true})); };
  const showVideo = playing && !state.failed && !state.reducedMotion && !state.saveData;
  return <div ref={container} data-testid={testId}>
    <div className="relative overflow-hidden rounded-2xl bg-[#FFE560]">
      {children}
      {attached && !state.failed && <video ref={video} src={src} muted playsInline loop preload="none" aria-hidden="true" onPlaying={()=>setPlaying(true)} onError={fail} className={`absolute inset-0 h-full w-full bg-[#FFE560] object-contain ${showVideo ? "opacity-100" : "opacity-0"}`}/>}
    </div>
    <div className="min-h-[52px]">{attached && !state.failed && !state.reducedMotion && !state.saveData && (playing || state.paused) && <button type="button" aria-pressed={state.paused} onClick={()=>setState(s=>({...s,paused:!s.paused}))} className="mt-2 inline-flex min-h-11 min-w-11 items-center rounded-lg border border-co-text px-4 font-bold">{state.paused ? playLabel : pauseLabel}</button>}</div>
  </div>;
}
