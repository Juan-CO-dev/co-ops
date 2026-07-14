"use client";

/**
 * Root global error boundary. Replaces the ROOT layout when a throw escapes it,
 * so it must render its own <html>/<body> and cannot rely on globals.css or any
 * provider having loaded — hence inline styles with raw brand hex (Mayo bg,
 * Diet Coke text, Mustard CTA). Bilingual, locale-neutral. Last-resort screen.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "20px",
          padding: "24px",
          textAlign: "center",
          background: "#FFF9E4",
          color: "#141414",
          fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/co-wordmark.png" alt="Compliments Only" style={{ height: "26px", width: "auto" }} />
        <div style={{ maxWidth: "24rem" }}>
          <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: "18px", fontWeight: 600, margin: "4px 0 0", color: "#4A4A4A" }}>Algo salió mal</p>
        </div>
        <button
          type="button"
          onClick={reset}
          style={{
            border: "none",
            borderRadius: "9999px",
            background: "#FFE560",
            color: "#141414",
            fontSize: "14px",
            fontWeight: 700,
            padding: "10px 20px",
            cursor: "pointer",
          }}
        >
          Try again · Reintentar
        </button>
        {error.digest && (
          <p style={{ fontSize: "11px", letterSpacing: "0.14em", textTransform: "uppercase", color: "#A0A0A0" }}>
            ref {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
