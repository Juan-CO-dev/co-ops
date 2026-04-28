<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

## Phase 0 — Foundation Scaffold (complete 2026-04-28)

### Stack as actually built

- **Next.js 16.2.4** + **React 19.2.4** (App Router, Turbopack stable)
- **Tailwind v4** — CSS-first config in `app/globals.css` via `@theme inline` blocks. **No `tailwind.config.ts`.** If you're tempted to create one because you "remember" Tailwind that way, stop. Tailwind v4 dropped that file. Tokens are in `app/globals.css`. Add new tokens by extending the `@theme inline` block.
- **TypeScript** — `strict: true` AND `noUncheckedIndexedAccess: true`. Array access returns `T | undefined`. Add a guard or use a non-null assertion only when you've verified the access is safe.
- **Node 22.20.0 LTS** via nvm-windows. Pinned in `.nvmrc` and `package.json` `engines`. The `.gitattributes` enforces LF on `*.sh` so the bash secrets script works on macOS/Linux/WSL — don't undo this.

### Spec deviations (intentional, signed off by Juan)

The Foundation Spec v1.2 specifies older versions. We deviated to current stable. **Do not "fix" these back to the spec literal — the deviations are intentional.**

- Next.js **14 → 16** (App Router same model; Turbopack default; `middleware.ts` is now `proxy.ts`)
- Claude **Sonnet 4 → Sonnet 4.6** (`claude-sonnet-4-6`) — see `lib/ai-prompts.ts` `AI_MODEL` constant
- Node **20 → 22 LTS**
- Tailwind **v3 → v4** (token file moved, see above)

### Naming conventions discovered in Next 16

- **`middleware.ts` → `proxy.ts`.** Same export shape, same `config.matcher`, same role. The deprecation warning fires if you write `middleware.ts`. Use `proxy.ts`.
- Auto-generated `AGENTS.md` (this file) is preserved. Auto-generated `CLAUDE.md` is a one-liner `@AGENTS.md` include — keep it.

### Auth architecture

- **Custom JWT layer**, not Supabase Auth. We sign tokens; Supabase verifies them.
- `AUTH_JWT_SECRET` — HS256 secret used to sign JWTs from `lib/auth.ts` (Phase 2).
- **Supabase configured with an HS256 standby key** whose value matches `AUTH_JWT_SECRET`. (Old "JWT Secret" field is no longer editable in the new Supabase JWT signing-keys system, late 2025+.) Standby keys verify but don't sign — exactly what we need.
- RLS reads `current_setting('request.jwt.claim.user_id')`. Helper functions in spec §5 (`current_user_id`, `current_user_role_level`, `current_user_locations`).
- **FOOTGUN:** rotating one without the other = every authenticated request 500s. `docs/runbooks/jwt-rotation.md` will document the procedure when auth lands in Phase 2.

### What's already built ahead of schedule

These foundation libraries are populated in full from spec §4 + §7. Phase 3 doesn't need to write them — only runtime helpers (location scoping logic, step-up modal wiring, session cookie readers).

- `lib/roles.ts` — full role registry, level lookups, `minPinLength()` (5 for level ≥5, 4 below). PIN length is a Juan addition not in spec — see Phase 0 transcript decision #1.
- `lib/permissions.ts` — full permission matrix
- `lib/destructive-actions.ts` — full destructive action list
- `lib/types.ts` — TypeScript shapes for every artifact (User, Location, Vendor, VendorItem, ParLevel, ChecklistTemplate, ChecklistInstance, ChecklistCompletion, ChecklistSubmission, ChecklistIncompleteReason, PrepListResolution, ShiftOverlay, WrittenReport, Announcement, TrainingReport, ReportPhoto, AuditLogEntry, HandoffFlag). camelCase at the application layer; the Supabase client layer (Phase 1) handles the snake_case translation.

### `.env.local` handling pattern

- **`.env*` is gitignored** with `!.env.local.example` exception so the template ships and real env files don't.
- **Never paste secret values into chat.** Always: write to `.env.local` (gitignored), set in Vercel dashboard UI manually.
- **`scripts/generate-secrets.ps1`** (Windows) and **`scripts/generate-secrets.sh`** (POSIX) generate `AUTH_JWT_SECRET`, `AUTH_PIN_PEPPER`, `AUTH_PASSWORD_PEPPER`. Output goes to stdout — redirect to a `.env.local.generated.tmp` file (also gitignored), copy values out, delete the tmp file.
- **`.vercelignore`** excludes `.env*` from CLI uploads as defense-in-depth. The `Detected .env file` warning Vercel emits during builds is about its own injected `.env.production.local`, not ours — it's harmless.

### Domain correction

The CO domain is **`complimentsonlysubs.com`**, NOT `complimentsonly.com`. The original spec had this wrong; the corrected v1.2 (with corrections log) is the source of truth. `EMAIL_FROM` will eventually be `ops@complimentsonlysubs.com` once the domain is verified in Resend; until then `EMAIL_FROM=onboarding@resend.dev`.

If you find any committed reference to `complimentsonly.com`, fix it in the same commit you noticed it.

### Juan's working pattern

- **Discuss before building.** Surface ambiguity in batches of 3–5 related questions, not one at a time. Architectural ambiguity surfaces *immediately* — don't draft around it.
- **Push back on flawed assumptions in real time.** Juan prefers honest collaboration over agreement. If a spec instruction conflicts with current reality, flag it before you act on it.
- **Quality over speed.** This goes in front of Pete (Owner) and Cristian (MoO). Take the extra session to do it right.
- **Foreground commands for anything that prompts.** GUI dialogs (GCM, vercel device-code) don't render reliably from background processes.
- **Never paste secrets into chat.** No exceptions.

### Carry-overs to future phases

- **`docs/runbooks/jwt-rotation.md`** — owed when auth lands in Phase 2.
- **`NEXT_PUBLIC_APP_URL`** — currently unset in Vercel env. Resolve when production domain is known (or use `VERCEL_URL` injection).
- **PAT expiration calendar reminder** — Juan's responsibility; flagged once during Phase 0 push troubleshooting.
- **Resend domain verification** — `complimentsonlysubs.com` not yet verified; `EMAIL_FROM` swap deferred until it is.
