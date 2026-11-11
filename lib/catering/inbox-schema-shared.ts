/** Deployment-window errors only; other database failures remain failures. */
export function isInboxSchemaMissing(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error
    && ["PGRST205", "42P01", "42883", "PGRST202"].includes(String(error.code));
}
