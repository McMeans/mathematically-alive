// The season data model every other part of the core works on, plus the
// conversion from raw CollegeFootballData (CFBD) responses into it.

export type Classification = "fbs" | "fcs" | "other";

export type Team = {
  id: number;
  name: string;
  abbreviation: string | null;
  /** Conference name as CFBD spells it ("ACC", "Big Ten"), or null for independents and unknowns. */
  conference: string | null;
  classification: Classification;
  color: string | null;
  altColor: string | null;
  /** SP+ rating in points per game above average, when published. */
  rating: number | null;
};

export type Game = {
  id: number;
  week: number;
  /** ISO 8601 kickoff time. */
  start: string;
  neutralSite: boolean;
  conferenceGame: boolean;
  homeId: number;
  awayId: number;
  /** Final score; null until the game is completed. */
  homePoints: number | null;
  awayPoints: number | null;
  completed: boolean;
  /** Consensus point spread from the home side's view (negative = home favored), or null if no line. */
  spread: number | null;
};

export type Season = {
  year: number;
  /** ISO 8601 time the source data was fetched. */
  fetchedAt: string;
  teams: Team[];
  games: Game[];
};

/** The CFBD fields we read. Responses carry more; extra fields are ignored. */
export type CfbdTeam = {
  id: number;
  school: string;
  abbreviation?: string | null;
  conference?: string | null;
  classification?: string | null;
  color?: string | null;
  alternateColor?: string | null;
};

export type CfbdGame = {
  id: number;
  week: number;
  startDate: string;
  completed: boolean;
  neutralSite: boolean;
  conferenceGame: boolean;
  homeId: number;
  homeTeam: string;
  homeConference?: string | null;
  homeClassification?: string | null;
  homePoints?: number | null;
  awayId: number;
  awayTeam: string;
  awayConference?: string | null;
  awayClassification?: string | null;
  awayPoints?: number | null;
};

export type CfbdLines = {
  id: number;
  lines?: { provider?: string; spread?: number | null }[] | null;
};

export type CfbdRating = {
  team: string;
  rating?: number | null;
};

export type CfbdSnapshot = {
  year: number;
  fetchedAt: string;
  teams: CfbdTeam[];
  games: CfbdGame[];
  lines: CfbdLines[];
  ratings: CfbdRating[];
};

/**
 * Build a Season from raw CFBD responses. Teams that appear only as an opponent
 * (usually FCS) are added from the game rows. Throws on data that would make
 * results wrong: a completed game without a score, or duplicate game ids.
 */
export function seasonFromCfbd(raw: CfbdSnapshot): Season {
  const ratingByName = new Map<string, number>();
  for (const r of raw.ratings) {
    if (typeof r.rating === "number") ratingByName.set(r.team, r.rating);
  }

  const teams = new Map<number, Team>();
  for (const t of raw.teams) {
    teams.set(t.id, {
      id: t.id,
      name: t.school,
      abbreviation: t.abbreviation ?? null,
      conference: t.conference ?? null,
      classification: classification(t.classification),
      color: t.color ?? null,
      altColor: t.alternateColor ?? null,
      rating: ratingByName.get(t.school) ?? null,
    });
  }

  const spreadByGame = new Map<number, number>();
  for (const l of raw.lines) {
    const spreads = (l.lines ?? []).map((x) => x.spread).filter((s): s is number => typeof s === "number");
    if (spreads.length > 0) spreadByGame.set(l.id, median(spreads));
  }

  const games: Game[] = [];
  const seen = new Set<number>();
  for (const g of raw.games) {
    if (seen.has(g.id)) throw new Error(`duplicate game id ${g.id}`);
    seen.add(g.id);

    addOpponent(teams, g.homeId, g.homeTeam, g.homeConference, g.homeClassification);
    addOpponent(teams, g.awayId, g.awayTeam, g.awayConference, g.awayClassification);

    const homePoints = g.homePoints ?? null;
    const awayPoints = g.awayPoints ?? null;
    if (g.completed && (homePoints === null || awayPoints === null)) {
      throw new Error(`completed game ${g.id} has no final score`);
    }

    games.push({
      id: g.id,
      week: g.week,
      start: g.startDate,
      neutralSite: g.neutralSite,
      conferenceGame: g.conferenceGame,
      homeId: g.homeId,
      awayId: g.awayId,
      homePoints: g.completed ? homePoints : null,
      awayPoints: g.completed ? awayPoints : null,
      completed: g.completed,
      spread: spreadByGame.get(g.id) ?? null,
    });
  }

  games.sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
  const teamList = [...teams.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { year: raw.year, fetchedAt: raw.fetchedAt, teams: teamList, games };
}

export type TeamRecord = {
  wins: number;
  losses: number;
  conferenceWins: number;
  conferenceLosses: number;
};

/** A team's record from completed games, plus any locked results (game id -> winner) of games not yet played. */
export function teamRecord(season: Season, teamId: number, locks: Record<number, number> = {}): TeamRecord {
  const rec: TeamRecord = { wins: 0, losses: 0, conferenceWins: 0, conferenceLosses: 0 };
  for (const g of season.games) {
    if (g.homeId !== teamId && g.awayId !== teamId) continue;
    let won: boolean;
    if (g.completed) won = g.homeId === teamId ? g.homePoints! > g.awayPoints! : g.awayPoints! > g.homePoints!;
    else if (g.id in locks) won = locks[g.id] === teamId;
    else continue;
    if (won) rec.wins++;
    else rec.losses++;
    if (g.conferenceGame) {
      if (won) rec.conferenceWins++;
      else rec.conferenceLosses++;
    }
  }
  return rec;
}

function addOpponent(
  teams: Map<number, Team>,
  id: number,
  name: string,
  conference: string | null | undefined,
  cls: string | null | undefined,
): void {
  if (teams.has(id)) return;
  teams.set(id, {
    id,
    name,
    abbreviation: null,
    conference: conference ?? null,
    classification: classification(cls),
    color: null,
    altColor: null,
    rating: null,
  });
}

function classification(c: string | null | undefined): Classification {
  return c === "fbs" || c === "fcs" ? c : "other";
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
