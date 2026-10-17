"use client";

/**
 * Reveal — lowkey scroll-in. Fades + lifts its children the first time they enter the
 * viewport, then disconnects (one-shot, cheap). Used to let content "surface naturally as
 * you scroll" without anything heavy or janky. Respects prefers-reduced-motion via CSS.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // SSR and the first hydration frame are always visible.
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    setShown(false);
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e && e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -48px 0px" },
    );
    io.observe(el);
    const revealOnReduction = () => { if (motion.matches) { setShown(true); io.disconnect(); } };
    motion.addEventListener("change", revealOnReduction);
    return () => { io.disconnect(); motion.removeEventListener("change", revealOnReduction); };
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`motion-safe:transition-all motion-safe:duration-700 motion-safe:ease-out ${shown ? "translate-y-0 opacity-100" : "motion-safe:translate-y-8 motion-safe:opacity-0"} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
