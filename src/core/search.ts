// Team search: how well a team fits what someone typed, by its name or its abbreviation ("UVA"). The site bar and
// the Season Lab's games search both rank with it, whatever the screen shows.

/**
 * How well a team fits a search, best first, or null when it doesn't: its abbreviation exactly ("uva"), its name's
 * start, then its abbreviation's or any word's start, then anywhere in its name. Case and surrounding spaces don't
 * matter; an empty search fits nothing.
 */
export function teamMatch(query: string, name: string, abbr?: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === "") return null;
  const n = name.toLowerCase(), a = abbr?.toLowerCase() ?? "";
  if (a === q) return 0;
  if (n.startsWith(q)) return 1;
  if (a.startsWith(q) || n.split(/[\s&.'-]+/).some((w) => w.startsWith(q))) return 2;
  if (n.includes(q)) return 3;
  return null;
}
