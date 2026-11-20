import type { Metadata } from "next";
import { Public_Sans, Saira_Condensed } from "next/font/google";
import "./globals.css";
import { siteUrl } from "./site";

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

export const metadata: Metadata = {
  // Share images need an absolute address: SITE_URL, else Netlify's (a deploy preview's own, or the site's).
  metadataBase: siteUrl(),
  title: "Mathematically Alive",
  description: "Every path to the playoff, for every team.",
  // Every page's share image shows wide in X and other apps that read Twitter cards.
  twitter: { card: "summary_large_image" },
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
