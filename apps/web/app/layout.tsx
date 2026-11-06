import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/geist-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ghar · Pay the bills back home from your stablecoins",
  description:
    "Ghar holds your USDT in an onchain vault and pays your family's bills, only to accounts a licensed provider verified.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f4f3ef" };

// Hide reveal targets before first paint only when JS runs and motion is allowed.
const boot = `if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('js')`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: boot }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
