/**
 * Session management — Phase 2.
 *
 * Session is an httpOnly cookie holding our JWT, plus a sessions table row
 * that tracks last_activity_at, step_up_unlocked, etc.
 *
 * Functions:
 *   - createSession(user, authMethod, req)
 *   - readSession(req): returns null when expired, idle-timed-out, or revoked
 *   - touchSession(sessionId): updates last_activity_at
 *   - revokeSession(sessionId)
 *   - unlockStepUp(sessionId), clearStepUp(sessionId)
 *
 * Idle timeout: 10 minutes (SESSION_IDLE_MINUTES env var).
 * Step-up clears on: idle timeout, logout, navigation away from /admin/*.
 */
export {};
