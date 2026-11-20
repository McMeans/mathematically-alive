import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root: a stray lockfile in a parent folder otherwise confuses Turbopack.
  turbopack: { root: __dirname },
  experimental: { agentUpgrade: "security" },
  // The share images read the brand fonts from src/app/fonts at render time (src/app/og.tsx).
  outputFileTracingIncludes: { "/**": ["./src/app/fonts/**"] },
  // The playoff-field page became the Season Lab, which shows the field with no picks.
  async redirects() {
    return [{ source: "/national", destination: "/lab", permanent: true }];
  },
};

export default nextConfig;
