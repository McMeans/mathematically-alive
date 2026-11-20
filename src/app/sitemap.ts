// Every page worth finding: the home page, the Season Lab and each team's page.
import type { MetadataRoute } from "next";
import { season, supportedTeams } from "./season";
import { siteUrl } from "./site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const at = (path: string) => new URL(path, base).toString();
  const lastModified = new Date(season.fetchedAt);
  return [
    { url: at("/"), lastModified, changeFrequency: "daily", priority: 1 },
    { url: at("/lab"), lastModified, changeFrequency: "daily", priority: 0.9 },
    { url: at("/about"), changeFrequency: "monthly", priority: 0.5 },
    ...supportedTeams.map((t) => ({ url: at(`/team/${t.id}`), lastModified, changeFrequency: "daily" as const, priority: 0.8 })),
  ];
}
