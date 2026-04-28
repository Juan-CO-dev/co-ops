/**
 * Login page — Phase 2 will replace this with the real PIN / email+password
 * sign-in UI per spec Section 6. For now, a stub landing page so the
 * deployment isn't a blank screen.
 */

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-co-bg p-6">
      <div className="mx-auto w-full max-w-[320px] rounded-xl border border-co-border bg-co-surface p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-co-gold to-co-gold-deep text-base font-extrabold text-white">
          CO
        </div>
        <h1 className="m-0 mb-1 text-2xl font-bold text-white">CO-OPS</h1>
        <p className="m-0 text-[10px] text-co-text-dim">Operations Platform</p>
        <p className="mt-6 text-[11px] text-co-text-muted">
          Foundation Phase 0 — sign-in lands in Phase 2.
        </p>
      </div>
    </main>
  );
}
