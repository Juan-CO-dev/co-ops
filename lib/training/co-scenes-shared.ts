/**
 * co-scenes-shared — where the vendored <crunchy-build> bundle lives, and the
 * narrow surface this app uses from it. Client-safe (a JSON import, no I/O).
 *
 * The bundle is co-scenes' hashed web build, vendored by
 * scripts/vendor-co-scenes.ts into public/vendor/co-scenes/ and pinned in
 * vendor/co-scenes/VERSION. The hashed filenames make every URL immutable, so
 * a re-vendor can never serve a stale chunk under an old name.
 *
 * The training entry exports `trainingSceneFactory(steps)`: today it draws the
 * co-scenes stub scene; track C's real Crunchy Boi scene replaces it INSIDE
 * co-scenes behind the same interface, so the swap here is a re-vendor only.
 */

import manifest from "@/public/vendor/co-scenes/asset-manifest.json";

import type { WebStep } from "./build-card-shared";

export const CO_SCENES_BASE = "/vendor/co-scenes/";

/** Public URL of the training entry module, from the vendored manifest. */
export const CO_SCENES_TRAINING_URL = `${CO_SCENES_BASE}${manifest.entries.training}`;

type SceneFactory = (canvas: HTMLCanvasElement, opts: { look: "stage" | "studio"; quality: "phone" | "full" }) => unknown;

/** The element instance, as far as this app touches it. */
export interface CrunchyBuildElementLike extends HTMLElement {
  factory: SceneFactory | null;
  setStep(n: number): void;
  ready(): Promise<unknown>;
}

export interface CrunchyStepEventDetail {
  step: number;
  mode: string;
  illustrated: boolean;
}

/** The training entry's exports. */
export interface CoScenesTraining {
  defineTrainingElement(tag?: string): void;
  trainingSceneFactory(steps: readonly WebStep[]): SceneFactory;
}

let loading: Promise<CoScenesTraining> | null = null;

/** Loads the vendored bundle once per page. A failed load is not cached, so a retry can succeed. */
export function loadCoScenesTraining(): Promise<CoScenesTraining> {
  loading ??= (
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ CO_SCENES_TRAINING_URL) as Promise<CoScenesTraining>
  ).catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}
