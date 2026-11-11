import type { Metadata } from "next";
import { Public_Sans, Saira_Condensed } from "next/font/google";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

// Board lettering and numbers.
const saira = Saira_Condensed({
  variable: "--font-saira",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
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
      <body className={`${publicSans.variable} ${saira.variable} antialiased`}>{children}</body>
    </html>
  );
}
