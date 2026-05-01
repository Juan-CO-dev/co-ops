# CO-OPS

**Compliments Only Operations Platform.** A single-tenant, role-based daily operations app for Compliments Only — the chef-inspired sub shop in Washington, DC. Two locations live (Capitol Hill / MEP, P Street / EM); built to scale to more.

CO-OPS digitizes operational data at the source — every shift, every location, every role — so management can forecast at granular levels and use that data to make better decisions.

> **CO-OPS is not BLOC OS.** BLOC OS is a separate, multi-tenant agentic platform. CO-OPS is single-tenant, internal, and purpose-built for CO. Different products, different repos.

The complete design is in `CO-OPS_Foundation_Spec_v1.2.md` (kept outside this repo, in shared drive). This README is for getting the code running.

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Runtime | Node.js 22 LTS |
| Language | TypeScript (strict + `noUncheckedIndexedAccess`) |
| Database | Supabase Postgres 17 (with RLS) |
| Storage | Supabase Storage |
| Auth | Custom JWT layer over Supabase (peppered bcrypt, dual-mode PIN / email+password) |
| AI | Claude Sonnet 4.6 (`claude-sonnet-4-6`) via server-side proxy |
| Email | Resend |
| SMS | Twilio (adapter scaffolded, activation deferred) |
| POS | Toast (adapter scaffolded, activation deferred) |
| Scheduling | 7shifts (adapter scaffolded, activation deferred) |
| Styling | Tailwind CSS v4 (CSS-first config via `@theme inline`) |
| Hosting | Vercel (auto-deploy from GitHub `main`) |

The spec specifies Next.js 14 / Sonnet 4 / Node 20; foundation runs current stable versions instead — see the Phase 0 recap for the deviation rationale.

---

## Prerequisites

You will need accounts on:

- **GitHub** (this repo lives there)
- **Vercel** (linked to GitHub)
- **Supabase** (project name `co-ops`, region `us-east-1`)
- **Resend** (sender domain verification optional at start)
- **Anthropic Console** (for the API key)

You will need installed locally:

- **Node 22 LTS** (recommended via `nvm-windows` on Windows or `nvm` / `volta` on macOS/Linux). The repo's `.nvmrc` pins `22.20.0`.
- **Git**
- **Vercel CLI** (`npm i -g vercel`) for `vercel link`, `vercel env pull`, `vercel logs`.

---

## First-time setup

1. **Clone the repo.**
   ```bash
   git clone https://github.com/<your-username>/co-ops.git
   cd co-ops
   ```

2. **Activate Node 22.** With nvm-windows or any nvm:
   ```bash
   nvm use   # picks up .nvmrc
   node --version  # should print v22.20.0
   ```

3. **Install dependencies.**
   ```bash
   npm install
   ```

4. **Create your `.env.local`.**
   ```bash
   cp .env.local.example .env.local
   ```
   Then edit `.env.local` and fill in the real values. **Never commit this file.**

5. **Generate secrets.** Three values (`AUTH_JWT_SECRET`, `AUTH_PIN_PEPPER`, `AUTH_PASSWORD_PEPPER`) need to be cryptographically random. Run:
   ```bash
   npm run secrets:generate           # Windows / PowerShell
   # or
   bash scripts/generate-secrets.sh   # macOS / Linux / WSL
   ```
   Copy the printed values into `.env.local` and into the Vercel dashboard env vars (Production + Preview + Development scopes).

6. **Critical — Supabase HS256 standby key.** Supabase's new JWT signing-keys system (late 2025+) replaces the editable single JWT Secret. Configure your `AUTH_JWT_SECRET` as an **HS256 standby key** in the Supabase dashboard:
   - Supabase Dashboard → JWT Keys → Create standby key
   - Algorithm: HS256
   - Key value: paste your `AUTH_JWT_SECRET` (the exact same string, no encoding changes)
   - Save without promoting to current
   
   This lets Supabase PostgREST verify the JWTs our app signs, so RLS sees `request.jwt.claim.user_id` natively. **If the two values drift apart, every authenticated request 500s.** Rotate them together. See `docs/runbooks/jwt-rotation.md` (Phase 2).

7. **Run the dev server.**
   ```bash
   npm run dev
   ```
   Visit `http://localhost:3000`.

---

## Project layout

See `CO-OPS_Foundation_Spec_v1.2.md` Section 15 for the full file map. Top-level:

```
app/         Next.js App Router pages (login, dashboard, modules, /admin/*, /api/*)
components/  Reusable React components (Nav, PlaceholderCard, Modals, etc.)
lib/         Pure logic — types, roles, permissions, auth, checklists, handoff, adapters
scripts/     One-off CLIs (secret generation, future migrations)
middleware.ts  Edge middleware for session validation + idle timeout (Phase 2)
```

Module pages currently render `<PlaceholderCard />` — they're stubbed during foundation and replaced module-by-module across the build.

---

## Build status

| Phase | Status |
|---|---|
| 0 — Repo + scaffold | in progress |
| 1 — Database schema + RLS | not started |
| 2 — Auth | not started |
| 3 — RBAC | not started (constants/types written during Phase 0) |
| 4 — Nav shell | not started |
| 5 — Foundation admin tools | not started |
| 6 — Shared services | not started |
| 7 — Integration adapters | not started |
| 8 — Acceptance | not started |

When all of Phase 0–8 lands, foundation ships and Module #1 (Daily Operations) begins in a fresh chat session.

---

## Common commands

```bash
npm run dev               # Dev server (Turbopack)
npm run build             # Production build
npm run start             # Start the production build locally
npm run lint              # ESLint
npm run typecheck         # tsc --noEmit
npm run secrets:generate  # Generate JWT secret + peppers
```

---

## Security and ops notes

- **Service role key** never reaches the client. Server-side only — `lib/supabase-server.ts`.
- **`.env.local`** is in `.gitignore`. Verify with `git check-ignore .env.local` before any commit.
- **Audit log** captures every destructive action with actor, before/after state, and IP. Read-only — RLS denies updates and deletes.
- **RLS policies** are the security boundary. Database access without RLS context is service-role only.

For incident response or credential rotation procedures, see `docs/runbooks/` (created in Phase 2 onwards).

---

*Last updated: Phase 0 of foundation.*
