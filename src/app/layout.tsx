import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: "700",
});

/** The site's address for absolute links; localhost when none is set or it doesn't parse. */
function siteUrl(): URL {
  const preview = process.env.CONTEXT && process.env.CONTEXT !== "production" ? process.env.DEPLOY_PRIME_URL : undefined;
  for (const v of [process.env.SITE_URL, preview, process.env.URL]) {
    try {
      if (v) return new URL(v);
    } catch {
      // not an address: try the next
    }
  }
  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  // Share images need an absolute address: SITE_URL, else Netlify's (a deploy preview's own, or the site's).
  metadataBase: siteUrl(),
  title: "Mathematically Alive",
  description: "Every path to the playoff, for every team.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${spaceGrotesk.variable} antialiased`}>{children}</body>
    </html>
  );
}
