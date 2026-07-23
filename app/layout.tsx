import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { TENANT_NAME } from "@/lib/tenant";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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
