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
 * FALLBACK: if the bundle cannot load, the same steps render as a plain list,
 * so the page still teaches the build.
 */

import { useEffect, useRef, useState } from "react";

import type { BuildLang, WebStep } from "@/lib/training/build-card-shared";
import {
  loadCoScenesTraining,
  type CrunchyBuildElementLike,
  type CrunchyStepEventDetail,
} from "@/lib/training/co-scenes-shared";
import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";

export function LearnTheBuild({ item, steps }: { item: string; steps: Record<BuildLang, WebStep[]> }) {
  const { language, t, setLanguage } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef(0);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [updating, setUpdating] = useState(false);
  const [langError, setLangError] = useState<string | null>(null);
  // Follows the element: the stub is all drawn; the real-photo scene (track C) clears it where no drawn food shows.
  const [illustrated, setIllustrated] = useState(true);
  const langSteps = steps[language];

  useEffect(() => {
    let cancelled = false;
    let el: CrunchyBuildElementLike | null = null;
    const resume = stepRef.current;
    const onStep = (e: Event) => {
      const { step, illustrated: drawn } = (e as CustomEvent<CrunchyStepEventDetail>).detail;
      if (step > 0) stepRef.current = step;
      setIllustrated(drawn);
    };
    loadCoScenesTraining()
      .then((mod) => {
        const host = hostRef.current;
        if (cancelled || !host) return;
        mod.defineTrainingElement();
        el = document.createElement("crunchy-build") as CrunchyBuildElementLike;
        el.factory = mod.trainingSceneFactory(langSteps);
        el.setAttribute("mode", "training");
        el.setAttribute("look", "studio");
        el.setAttribute("lang", language);
        el.addEventListener("crunchy-step", onStep);
        host.replaceChildren(el);
        if (resume > 1) {
          const mounted = el;
          void mounted.ready().then(() => {
            if (!cancelled) mounted.setStep(resume);
          });
        }
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
      el?.removeEventListener("crunchy-step", onStep);
      el?.remove(); // disconnect releases the scene, renderer and GL context
    };
  }, [language, langSteps]);

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
        {status === "failed" ? <FallbackSteps steps={langSteps} lang={language} failedText={t("training.build.failed")} heading={t("training.build.steps_heading")} /> : null}
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
  failedText: string;
  heading: string;
}) {
  return (
    <div>
      <p className="m-0 mb-2 text-sm text-co-text-muted" role="status">
        {failedText}
      </p>
      <h2 className="m-0 mb-1 text-xs font-bold tracking-wide text-co-text-muted">{heading}</h2>
      <ol className="m-0 list-none p-0">
        {steps.map((s) => (
          <li key={s.key} className="border-t border-co-border py-2">
            <p className="m-0 text-sm font-bold text-co-text">
              {s.n}. {s.label}
            </p>
            {s.ingredient ? <p className="m-0 text-xs text-co-text-muted">{s.action}</p> : null}
            {s.howto?.[lang] ? <p className="m-0 mt-1 text-sm text-co-text-muted">{s.howto[lang]}</p> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
