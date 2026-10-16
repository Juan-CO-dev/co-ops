/** PII-free diagnostics for unexpected catalog failures. */
export function logCatalogFailure(error: unknown): void {
  const errorClass = error instanceof TypeError ? "TypeError"
    : error instanceof RangeError ? "RangeError"
    : error instanceof SyntaxError ? "SyntaxError"
    : error instanceof Error ? "Error"
    : error !== null && typeof error === "object" ? "Object"
    : typeof error;
  // Raw exception messages can contain SQL, customer data, or submitted values.
  console.error("catalog request failed", { errorClass, message: "unexpected catalog failure" });
}
