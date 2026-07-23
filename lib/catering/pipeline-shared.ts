/**
 * Pipeline — CLIENT-SAFE shared surface (stage vocabulary only; no I/O, no
 * server imports). Split from pipeline.ts on 2026-07-23: the `server-only`
 * guard on lib/supabase-server.ts surfaced PipelineClient.tsx's runtime import
 * of PIPELINE_STAGES dragging the service-role module into the client graph
 * (PR #165 CI catch — third chain). Types stay importable from pipeline.ts
 * (type-only imports are erased); only runtime values need to live here.
 */

export const PIPELINE_STAGES = ["inquiry", "quote_sent", "confirmed", "out", "completed", "lost"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
