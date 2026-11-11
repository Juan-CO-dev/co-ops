import "server-only";

/** Retains raw bytes for HMAC; bounds streamed bodies even without Content-Length. */
export async function readBoundedBytes(source: Request | Response, limit = 262144): Promise<
  { ok: true; bytes: Uint8Array } | { ok: false; status: 400 | 413 }
> {
  const length = source.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) return { ok: false, status: 413 };
  if (!source.body) return { ok: false, status: 400 };
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new Error("body_timeout")); }, 2000);
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), timeout]);
      if (part.done) break;
      count += part.value.byteLength;
      if (count > limit) { void reader.cancel().catch(() => {}); return { ok: false, status: 413 }; }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, bytes };
  } catch { return { ok: false, status: 400 }; }
  finally { clearTimeout(timer); reader.releaseLock(); }
}
