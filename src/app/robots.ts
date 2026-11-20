// Crawl everything, and point to the sitemap. Shared Lab links stay open to crawlers so chat and social apps can read
// their previews; the pages themselves ask not to be indexed.
import type { MetadataRoute } from "next";
import { siteUrl } from "./site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("/sitemap.xml", siteUrl()).toString(),
  };
}
