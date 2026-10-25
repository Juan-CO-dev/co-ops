/** Unicode code-point order, matching PostgreSQL UTF-8 COLLATE "C" (not UTF-16 order). */
export function compareCodePoint(a: string, b: string): number {
  const left = a[Symbol.iterator](), right = b[Symbol.iterator]();
  for (;;) {
    const x = left.next(), y = right.next();
    if (x.done || y.done) return x.done === y.done ? 0 : x.done ? -1 : 1;
    const delta = x.value.codePointAt(0)! - y.value.codePointAt(0)!;
    if (delta) return delta < 0 ? -1 : 1;
  }
}
