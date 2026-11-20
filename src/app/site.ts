// The site's own address, for absolute links (share images, the sitemap).

/** The site's address for absolute links; localhost when none is set or it doesn't parse. */
export function siteUrl(): URL {
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
