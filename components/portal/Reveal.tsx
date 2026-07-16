"use client";

/**
 * Reveal — lowkey scroll-in. Fades + lifts its children the first time they enter the
 * viewport, then disconnects (one-shot, cheap). Used to let content "surface naturally as
 * you scroll" without anything heavy or janky. Respects prefers-reduced-motion via CSS.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
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
    return () => io.disconnect();
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
