import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { TENANT_NAME } from "@/lib/tenant";

// DM Sans is self-hosted (app/fonts, the Google Fonts v17 latin variable face, 400–800,
// OFL). next/font/google fetched it from Google at every build, and Vercel builds failed
// intermittently in its font loader ("next/font/google queries have exactly one entry",
// 2026-10-14/15). A committed file has no build-time network dependency.
const dmSans = localFont({
  src: "./fonts/dm-sans-latin.woff2",
  weight: "400 800",
  style: "normal",
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  // Absolute base so the file-based opengraph-image (app/opengraph-image.png)
  // and icons resolve to full URLs in link previews. Falls back to the prod
  // canonical when NEXT_PUBLIC_APP_URL is unset (e.g. CI build with no env).
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://co-ops-ashy.vercel.app"),
  title: "CO-OPS",
  description: `${TENANT_NAME} Operations Platform`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${dmSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
