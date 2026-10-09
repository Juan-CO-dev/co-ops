/** URL-encoded Toast date parameter: exactly milliseconds and a +0000 offset. */
export function toastModifiedParam(at: Date): string {
  return encodeURIComponent(at.toISOString().replace("Z", "+0000"));
}
