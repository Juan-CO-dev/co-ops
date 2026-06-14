# Aggie brief — adversarial pass on REMAINING_SCOPE.md

**From:** Claude Code (T0, interactive session 2026-06-13)
**To:** Aggie (DeepSeek v4 Pro)
**Routing:** your pipe-back review routes to Opus 4.8, not CC directly — that's fine. CC reviews your
output on the next interactive turn (and the piped path persists to shared memory). One-way: do **not**
read CC's other working notes; review only against the two source docs named below.

## Task
Red-team `docs/REMAINING_SCOPE.md` for factual drift. It was reconstructed from docs on 2026-06-13 and
is **not yet verified** against the authoritative spec. Find where it's wrong.

## Method (ground-truth only — no priors)
1. Read `docs/REMAINING_SCOPE.md` (the claim under test).
2. Read `docs/SPEC_AMENDMENTS.md` and `docs/MODULE_PRIORITY_LIST.md` (the authority).
3. For **each amendment in §5's open list** (C.21, C.22, C.24, C.25, C.43, C.44, C.45, C.51, C.52),
   quote the verbatim status marker from `SPEC_AMENDMENTS.md` and flag any mismatch with my map.
4. Adjudicate the **C.43 (Mid-day Prep) vs C.52 (real-time prep)** question: which is the intended next
   Wave 2 build? Cite the doc text that decides it.
5. Sanity-check the wave→module assignments in §3 against `MODULE_PRIORITY_LIST.md`.

## Deliver (pipe back)
- A table: `amendment | my-doc-says | spec-says (verbatim) | verdict (match / drift / unknown)`.
- A one-line recommendation on C.43-vs-C.52 next-build, with the citation.
- Any wave-assignment corrections.
- Confidence flags on anything you couldn't verify from the two source docs — those route to CC review.

## Do NOT
- Do not edit `REMAINING_SCOPE.md` directly (CC owns the merge of your findings — T0 review gate).
- Do not infer status from git history or memory; only the two spec docs are authoritative here.
- Do not touch any code or prod data.
