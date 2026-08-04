-- 0173: P3 verifier fix (card t_1f829628 #2) — par_qty is a mandatory snapshot of the
-- day's par at walk time (submitParPass throws no_par before ever writing null). Nullable
-- schema invited a future writer to land null, which loadShrinkageSignals silently skips.
-- Pre-flighted 2026-08-04: par_pass_lines has zero rows.
alter table public.par_pass_lines alter column par_qty set not null;
