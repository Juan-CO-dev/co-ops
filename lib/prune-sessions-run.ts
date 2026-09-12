import "server-only";

// The existing work already lives in a shared function.
export { pruneExpiredSessions as runPruneSessions } from "@/lib/session";
