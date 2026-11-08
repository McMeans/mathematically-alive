import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root: a stray lockfile in a parent folder otherwise confuses Turbopack.
  turbopack: { root: __dirname },
  // The playoff-field page became the Season Lab, which shows the field with no picks.
  async redirects() {
    return [{ source: "/national", destination: "/lab", permanent: true }];
  },
};

export default nextConfig;
