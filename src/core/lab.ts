// Season Lab (docs/plan-season-lab.md): play out the rest of the season with picks for any regular-season game,
// conference title game or playoff game, and see every conference's title race, the stand-in ranking, the field and
// the bracket. Picks travel in a URL, so the codec lives here too. All wording comes from here.
import { simulateNational, titleRace, type NationalResult } from "./national";
import { conferenceName, formatFine, formatSideOdds } from "./paths";
import { bracketGames, findFormat } from "./playoff";
import type { Season } from "./season";
import { nationalView, type NationalView } from "./view";

/** Every pick in the Lab. */
export type LabLocks = {
  /** Regular-season game id -> the team that wins it. */
  games: Record<number, number>;
  /** Conference -> the team that wins its title game, in the seasons that team plays in it. */
  titles: Record<string, number>;
  /** Bracket game index (`NationalView.bracket`) -> the team that wins it, in the seasons that team plays in it. */
  bracket: Record<number, number>;
};

export type LabOptions = {
  iterations: number;
  seed: number;
  /** Conferences whose title games are simulated. Each needs tiebreak rules for the season. */
  conferences: readonly string[];
  locks?: Partial<LabLocks>;
  /** The no-picks run (or any earlier run of the same season, seed and iterations), to reuse what it can. */
  reuse?: NationalResult;
  /** How many teams the ranking lists (default 25). */
  top?: number;
};

export type LabTitleTeam = {
  teamId: number;
  /** Shares of seasons it plays in, and wins, its conference's title game. */
  titleGame: number;
  champion: number;
  /** "Title game 64% · champion 41%". */
  text: string;
};

export type LabConference = {
  conference: string;
  /** Display name: "MAC", "SEC". */
  name: string;
  /** The team picked to win its title game, or null. */
  picked: number | null;
  /** Members with any chance of playing in the title game, likeliest first. */
  teams: LabTitleTeam[];
};

export type LabRanked = {
  /** Place by average rank, 1 is best. */
  rank: number;
  teamId: number;
  meanRank: number;
  /** "Average rank 7.4 · top 12 in 63%". */
  text: string;
};

export type SeasonLab = {
  national: NationalResult;
  /** How many picks are in effect. */
  picks: number;
  /** "3 picks · 20,000 simulated seasons", or "No picks yet · 20,000 simulated seasons". */
  summary: string;
  /** The field and bracket; null when the season's playoff isn't simulated. */
  playoff: NationalView | null;
  /** Each simulated conference's title race, in the order given. */
  conferences: LabConference[];
  /** The committee stand-in's ranking by average place, best first. Modelled, not the committee. */
  ranking: LabRanked[];
};

const empty = (): LabLocks => ({ games: {}, titles: {}, bracket: {} });

/** Run the Lab: the national simulation with every pick, and what the page shows. */
export function seasonLab(season: Season, opts: LabOptions): SeasonLab {
  const locks = { ...empty(), ...opts.locks };
  const national = simulateNational(season, {
    iterations: opts.iterations, seed: opts.seed, conferences: opts.conferences,
    locks: locks.games, titleLocks: locks.titles, bracketLocks: locks.bracket, reuse: opts.reuse,
  });
  const picks = Object.keys(locks.games).length + Object.keys(locks.titles).length + Object.keys(locks.bracket).length;
  const seasons = `${national.iterations.toLocaleString("en-US")} simulated seasons`;
  const conferences = national.conferences.map((conference): LabConference => ({
    conference,
    name: conferenceName(conference),
    picked: locks.titles[conference] ?? null,
    teams: national.teams
      .filter((t) => t.conference === conference && (t.titleGame ?? 0) > 0)
      .sort((a, b) => b.titleGame! - a.titleGame! || b.champion! - a.champion! || a.teamId - b.teamId)
      .map((t) => ({
        teamId: t.teamId, titleGame: t.titleGame!, champion: t.champion!,
        text: `Title game ${formatSideOdds(t.titleGame!, "alive")} · champion ${formatSideOdds(t.champion!, "alive")}`,
      })),
  }));
  const ranking = national.teams.slice(0, opts.top ?? 25).map((t, k) => ({
    rank: k + 1, teamId: t.teamId, meanRank: t.meanRank,
    text: `Average rank ${t.meanRank.toFixed(1)} · top 12 in ${formatFine(t.top12)}`,
  }));
  return {
    national,
    picks,
    summary: `${picks === 0 ? "No picks yet" : picks === 1 ? "1 pick" : `${picks} picks`} · ${seasons}`,
    playoff: nationalView(national, { season }),
    conferences,
    ranking,
  };
}

// --- Lock codec: picks as a short URL-safe string. ---------------------------------------------------------------
// Bytes, as unsigned LEB128 varints: a version (1); the game picks, sorted by id, each (id gap * 2 + 1 if the away
// team wins); the title picks, each (conference's place in the season's sorted conference list, team id); the
// bracket picks, each (game index, team id). Each list starts with its length. Then base64url without padding.

const VERSION = 1;

const conferencesOf = (season: Season): string[] =>
  [...new Set(season.teams.flatMap((t) => (t.conference ? [t.conference] : [])))].sort();

/** Picks as a short URL-safe string. Throws for a game pick on a game the season doesn't have, or a team not in it. */
export function encodeLabLocks(season: Season, locks: Partial<LabLocks>): string {
  const { games, titles, bracket } = { ...empty(), ...locks };
  const out: number[] = [];
  const put = (v: number) => {
    let x = v;
    while (x >= 0x80) { out.push((x & 0x7f) | 0x80); x = Math.floor(x / 128); }
    out.push(x);
  };
  put(VERSION);
  const byId = new Map(season.games.map((g) => [g.id, g]));
  const ids = Object.keys(games).map(Number).sort((a, b) => a - b);
  put(ids.length);
  let prev = 0;
  for (const id of ids) {
    const g = byId.get(id);
    if (!g) throw new Error(`pick for unknown game ${id}`);
    if (games[id] !== g.homeId && games[id] !== g.awayId) throw new Error(`team ${games[id]} is not in game ${id}`);
    put((id - prev) * 2 + (games[id] === g.awayId ? 1 : 0));
    prev = id;
  }
  const confs = conferencesOf(season);
  const cs = Object.keys(titles).sort();
  put(cs.length);
  for (const c of cs) {
    const at = confs.indexOf(c);
    if (at < 0) throw new Error(`${c} isn't a conference in ${season.year}`);
    put(at);
    put(titles[c]);
  }
  const ks = Object.keys(bracket).map(Number).sort((a, b) => a - b);
  put(ks.length);
  for (const k of ks) { put(k); put(bracket[k]); }
  return toBase64Url(out);
}

export type DecodedLabLocks = {
  locks: LabLocks;
  /** Picks dropped because the real game has since gone final. */
  settled: number;
  /** Picks dropped because they no longer fit the season (unknown game, team or bracket game), or a malformed string. */
  dropped: number;
  /** "2 picks were settled by real results." and the like; empty when nothing was dropped. */
  note: string;
};

/** Read picks back from `encodeLabLocks`. Never throws: anything that no longer fits the season is dropped and counted. */
export function decodeLabLocks(season: Season, text: string): DecodedLabLocks {
  const locks = empty();
  let settled = 0;
  let dropped = 0;
  const done = (): DecodedLabLocks => ({ locks, settled, dropped, note: dropNote(settled, dropped) });
  const bytes = fromBase64Url(text);
  if (bytes === null) return (dropped = text === "" ? 0 : 1), done();
  let p = 0;
  const get = (): number => {
    let v = 0;
    let scale = 1;
    for (;;) {
      if (p >= bytes.length) throw new RangeError("truncated");
      const b = bytes[p++];
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
      scale *= 128;
      if (scale > 2 ** 49) throw new RangeError("too long");
    }
  };
  try {
    if (get() !== VERSION) return (dropped = 1), done();
    const byId = new Map(season.games.map((g) => [g.id, g]));
    let id = 0;
    for (let n = get(); n > 0; n--) {
      const v = get();
      id += Math.floor(v / 2);
      const g = byId.get(id);
      if (!g) dropped++;
      else if (g.completed) settled++;
      else locks.games[id] = v % 2 === 1 ? g.awayId : g.homeId;
    }
    const confs = conferencesOf(season);
    for (let n = get(); n > 0; n--) {
      const c = confs[get()];
      const team = get();
      const t = season.teams.find((x) => x.id === team);
      if (c === undefined || t?.conference !== c) { dropped++; continue; }
      let final: boolean;
      try { final = titleRace(season, c).game?.completed === true; } catch { dropped++; continue; } // no title-game rules
      if (final) settled++;
      else locks.titles[c] = team;
    }
    const size = bracketGames(findFormat(season.year)?.teams ?? 12).length;
    for (let n = get(); n > 0; n--) {
      const k = get();
      const team = get();
      if (k >= size || !season.teams.some((x) => x.id === team)) dropped++;
      else locks.bracket[k] = team;
    }
    if (p !== bytes.length) dropped++;
  } catch {
    // A cut-off string keeps the picks read so far.
    dropped++;
  }
  return done();
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const dropNote = (settled: number, dropped: number): string =>
  [
    settled > 0 ? `${settled} ${plural(settled, "pick was", "picks were")} settled by real results.` : "",
    dropped > 0 ? `${dropped} ${plural(dropped, "pick", "picks")} no longer ${plural(dropped, "fits", "fit")} the season and ${plural(dropped, "was", "were")} left out.` : "",
  ].filter(Boolean).join(" ");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64Url(bytes: readonly number[]): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) s += ALPHABET[(n >> (18 - 6 * j)) & 63];
  }
  return s;
}

function fromBase64Url(s: string): number[] | null {
  if (s === "" || s.length % 4 === 1) return null;
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const chunk = s.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const v = j < chunk.length ? ALPHABET.indexOf(chunk[j]) : 0;
      if (v < 0) return null;
      n = (n << 6) | v;
    }
    const bytes = Math.floor((chunk.length * 6) / 8);
    for (let j = 0; j < bytes; j++) out.push((n >> (16 - 8 * j)) & 255);
  }
  return out;
}
