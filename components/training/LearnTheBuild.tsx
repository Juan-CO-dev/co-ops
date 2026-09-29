"use client";

/**
 * LearnTheBuild — the interactive build for staff (co-scenes spec §9,
 * "Learn the build" on /training).
 *
 * Embeds the vendored <crunchy-build mode="training"> element: Back/Next steps,
 * each showing the action, the amount GENERATED from the build card, and the
 * how-to note in the viewer's language. No autoplay; the element loads WebGL
 * lazily and honours prefers-reduced-motion itself.
 *
 * LANGUAGE follows the app: the page's TranslationProvider carries the user's
 * saved language, and the toggle here is the same PATCH /api/users/me/language
 * + setLanguage idiom as UserMenu and Settings, so the whole page flips together.
 * Step labels are baked into the scene's steps, so a language change mounts a
 * fresh element on the same step.
 *
 * The element is created imperatively (not as JSX) so its `factory` is set
 * BEFORE it connects: the element starts its scene as soon as it nears the
 * viewport, and a factory assigned after that would be too late.
 *
 * FALLBACK: if the viewer does not come up — the bundle fails to load or hangs,
 * scene init fails inside the element (it bounds its own load with
 * `prepare-timeout`), or nothing settles by the backstop ceiling
 * (lib/training/viewer-start.ts) — the reason is logged, the element is removed
 * and the same steps render as a plain list, so the page still teaches the
 * build. There is no flat early cut-off while the element is still loading.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { BuildLang, WebStep } from "@/lib/training/build-card-shared";
import {
  CO_SCENES_DATA_URL,
  loadCoScenesTraining,
  type CoScenesTraining,
  type CrunchyBuildElementLike,
  type CrunchyStepEventDetail,
} from "@/lib/training/co-scenes-shared";
import {
  startViewer,
  viewerInputs,
  VIEWER_CEILING_MS,
  VIEWER_IMPORT_TIMEOUT_MS,
  VIEWER_PREPARE_TIMEOUT_MS,
} from "@/lib/training/viewer-start";
import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";

export function LearnTheBuild({ item, steps }: { item: string; steps: Record<BuildLang, WebStep[]> }) {
  const { language, t, setLanguage } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef(0);
  // The viewer's outcome, tagged with the language it was mounted for: a language
  // switch remounts, and an outcome for another language reads as "loading" (derived
  // during render, so the effect never has to reset state synchronously).
  const [viewer, setViewer] = useState<{ lang: Language; status: "ready" | "failed" } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [langError, setLangError] = useState<string | null>(null);
  // Follows the element: the stub is all drawn; the real-photo scene (track C) clears it where no drawn food shows.
  const [illustrated, setIllustrated] = useState(true);
  const langSteps = steps[language];
  // Decided up front and never throws: a step mismatch or a missing scene-data file
  // is a build/config problem that degrades to the plain list, not a render crash.
  const inputs = useMemo(() => viewerInputs(steps.en, steps.es, CO_SCENES_DATA_URL), [steps]);
  const status: "loading" | "ready" | "failed" | "unavailable" =
    inputs.kind === "unavailable" ? "unavailable" : viewer?.lang === language ? viewer.status : "loading";

  useEffect(() => {
    if (inputs.kind !== "ok") {
      console.error(`Learn the build: viewer unavailable (${inputs.reason}): ${inputs.detail}`);
      return;
    }
    const { steps: elementSteps, dataUrl } = inputs;
    let cancelled = false;
    let el: CrunchyBuildElementLike | null = null;
    const resume = stepRef.current;
    const onStep = (e: Event) => {
      const { step, illustrated: drawn } = (e as CustomEvent<CrunchyStepEventDetail>).detail;
      if (step > 0) stepRef.current = step;
      setIllustrated(drawn);
    };
    void startViewer<CoScenesTraining, CrunchyBuildElementLike>({
      load: loadCoScenesTraining,
      mount: (mod) => {
        const host = hostRef.current;
        if (cancelled || !host) throw new Error("unmounted");
        mod.defineTrainingElement();
        const made = document.createElement("crunchy-build") as CrunchyBuildElementLike;
        // Track C's real-photo C1 scene (stage look) from the vendored data file;
        // the entry falls back to the drawn studio look itself if any photo is
        // missing or fails its sha256 check (then the element marks it Illustrated).
        made.factory = mod.trainingSceneFactory(elementSteps, dataUrl);
        made.setAttribute("mode", "training");
        made.setAttribute("look", "stage");
        made.setAttribute("lang", language);
        // The element's own ceiling for data + photos + scene prepare; past it, it reports "failed".
        made.setAttribute("prepare-timeout", String(VIEWER_PREPARE_TIMEOUT_MS));
        made.addEventListener("crunchy-step", onStep);
        host.replaceChildren(made);
        el = made;
        return made;
      },
      // ready() starts the scene and settles with the element's status (and error): "failed"
      // when scene init failed inside it (no WebGL, a failed lazy chunk, a refused photo, its prepare-timeout).
      ready: (made) => made.ready(),
      importTimeoutMs: VIEWER_IMPORT_TIMEOUT_MS,
      ceilingMs: VIEWER_CEILING_MS,
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (id) => window.clearTimeout(id as number),
      report: (reason) => {
        if (!cancelled) console.error(`Learn the build: viewer failed, showing the step list (${reason})`);
      },
    }).then((outcome) => {
      if (cancelled) return;
      if (outcome === "ready") {
        if (resume > 1) el?.setStep(resume);
        setViewer({ lang: language, status: "ready" });
        return;
      }
      // Failed or hung: drop the element (it would only say "Preview unavailable")
      // and teach from the plain list instead.
      el?.removeEventListener("crunchy-step", onStep);
      el?.remove();
      el = null;
      setViewer({ lang: language, status: "failed" });
    });
    return () => {
      cancelled = true;
      el?.removeEventListener("crunchy-step", onStep);
      el?.remove(); // disconnect releases the scene, renderer and GL context
    };
  }, [language, inputs]);

  const selectLanguage = async (next: Language) => {
    if (next === language || updating) return;
    setUpdating(true);
    setLangError(null);
    try {
      const res = await fetch("/api/users/me/language", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: next }),
        redirect: "manual",
      });
      if (res.ok) setLanguage(next);
      else setLangError(t("settings.error.generic"));
    } catch {
      setLangError(t("settings.error.generic"));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-16">
      <p className="m-0 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
        {t("training.build.eyebrow")}
      </p>
      <h1 className="m-0 text-base font-bold text-co-text">{item}</h1>
      <p className="mt-1 mb-3 text-xs text-co-text-muted">{t("training.build.intro")}</p>

      <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label={t("user_menu.language")}>
        {(["en", "es"] as const).map((l) => {
          const label = t(l === "en" ? "user_menu.language.en" : "user_menu.language.es");
          const active = language === l;
          return (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={t("user_menu.language.aria_select", { language: label })}
              disabled={updating}
              onClick={() => void selectLanguage(l)}
              className={[
                "inline-flex min-h-[44px] items-center rounded-lg border-2 px-4 text-sm font-bold uppercase tracking-[0.1em] transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "border-co-text bg-co-gold text-co-text"
                  : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text hover:text-co-text",
              ].join(" ")}
            >
              {label}
            </button>
          );
        })}
      </div>
      {updating ? <p className="-mt-1 mb-2 text-[11px] text-co-text-dim">{t("user_menu.language.updating")}</p> : null}
      {langError ? <p className="-mt-1 mb-2 text-sm text-co-cta-text">{langError}</p> : null}

      {illustrated ? (
        <p className="mb-3 rounded-xl border border-co-border bg-co-surface-inset px-3 py-2 text-xs font-medium text-co-text-muted">
          {t("training.build.illustrated_note")}
        </p>
      ) : null}
      {language === "es" ? (
        <p className="mb-3 rounded-xl border border-co-border bg-co-surface-inset px-3 py-2 text-xs font-medium text-co-info">
          {t("training.build.spanish_draft")}
        </p>
      ) : null}

      <section className="co-card p-3" aria-label={t("training.build.viewer_aria", { item })}>
        <div ref={hostRef} />
        {status === "loading" ? (
          <p className="m-0 py-6 text-center text-sm text-co-text-muted" role="status">
            {t("training.build.loading")}
          </p>
        ) : null}
        {status === "failed" || status === "unavailable" ? (
          <FallbackSteps
            steps={langSteps}
            lang={language}
            // "unavailable" is a build/config problem (logged), not something the reader did or
            // can retry: the steps show without the "could not load" line.
            failedText={status === "failed" ? t("training.build.failed") : null}
            heading={t("training.build.steps_heading")}
          />
        ) : null}
      </section>
    </div>
  );
}

function FallbackSteps({
  steps,
  lang,
  failedText,
  heading,
}: {
  steps: WebStep[];
  lang: Language;
  failedText: string | null;
  heading: string;
}) {
  return (
    <div>
      {failedText ? (
        <p className="m-0 mb-2 text-sm text-co-text-muted" role="status">
          {failedText}
        </p>
      ) : null}
      <h2 className="m-0 mb-1 text-xs font-bold tracking-wide text-co-text-muted">{heading}</h2>
      <ol className="m-0 list-none p-0">
        {steps.map((s) => (
          <li key={s.key} className="border-t border-co-border py-2">
            <p className="m-0 text-sm font-bold text-co-text">
              {s.n}. {s.label}
            </p>
            {s.action !== s.label ? <p className="m-0 text-xs text-co-text-muted">{s.action}</p> : null}
            {s.howto?.[lang] ? <p className="m-0 mt-1 text-sm text-co-text-muted">{s.howto[lang]}</p> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
