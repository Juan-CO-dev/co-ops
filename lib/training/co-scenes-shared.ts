/**
 * co-scenes-shared — where the vendored <crunchy-build> bundle lives, and the
 * narrow surface this app uses from it. Client-safe (a JSON import, no I/O).
 *
 * The bundle is co-scenes' hashed web build, vendored by
 * scripts/vendor-co-scenes.ts into vendor/co-scenes/dist/ (NOT public/) and
 * pinned in vendor/co-scenes/VERSION. The hashed filenames make every URL immutable, so
 * a re-vendor can never serve a stale chunk under an old name.
 *
 * The training entry exports `trainingSceneFactory(steps)`: today it draws the
 * co-scenes stub scene. SWAP POINT: after track C round 2, the REAL-PHOTO C1
 * scene replaces the stub INSIDE co-scenes (web/training-entry.ts) behind the
 * same interface, so the swap here is a re-vendor only
 * (scripts/vendor-co-scenes.ts); no CO-OPS code changes.
 */

import manifest from "@/vendor/co-scenes/dist/asset-manifest.json";

import type { WebStep } from "./build-card-shared";

/** Served by app/api/training/co-scenes/[...path]/route.ts, behind full session validation. */
export const CO_SCENES_BASE = "/api/training/co-scenes/";

/**
 * The manifest's own allowlist: a request path is an asset only if it is a key
 * of `files` (hash-checked by tests/co-scenes-vendor.test.ts). Returns the
 * content type to serve it with, or null. Pure, so the gate is testable.
 */
export function coScenesAsset(rel: string): { rel: string; contentType: string; sha256: string } | null {
  if (!Object.hasOwn(manifest.files, rel)) return null;
  const sha256 = (manifest.files as Record<string, string>)[rel];
  if (!sha256) return null;
  if (rel.endsWith(".js")) return { rel, contentType: "text/javascript; charset=utf-8", sha256 };
  if (rel.endsWith(".json")) return { rel, contentType: "application/json; charset=utf-8", sha256 };
  return null;
}

/** The strong ETag of an asset: its manifest sha256, quoted. */
export function coScenesEtag(sha256: string): string {
  return `"${sha256}"`;
}

/**
 * Whether an If-None-Match header matches this strong ETag (RFC 9110: a
 * comma-separated list, or "*"). Weak validators never match a strong ETag.
 */
export function ifNoneMatchHits(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => {
    const v = t.trim();
    return v === "*" || v === etag;
  });
}

/** URL of the training entry module, from the vendored manifest. */
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

/** Loads the vendored bundle once per page. A failed load is not cached, so the next mount (e.g. a language switch) retries. */
export function loadCoScenesTraining(): Promise<CoScenesTraining> {
  loading ??= (
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ CO_SCENES_TRAINING_URL) as Promise<CoScenesTraining>
  ).catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}
