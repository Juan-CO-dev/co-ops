/**
 * Admin layout — step-up gate lives here.
 *
 * Phase 3 wires this up:
 *   - Reads session from cookie
 *   - Blocks if !session or session.role_level < 6.5
 *   - If session.step_up_unlocked === false, renders <PasswordModal />
 *   - On nav-away or 10-min idle, server clears step_up_unlocked
 *
 * For Phase 0, this is just a passthrough so the placeholder admin pages
 * are reachable without auth.
 */

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
