// The season data model every other part of the core works on, plus the
// conversion from raw CollegeFootballData (CFBD) responses into it.

export type Classification = "fbs" | "fcs" | "other";

/** How CFBD names the FBS independents' "conference". An FBS team with no conference at all counts as one too. */
export const INDEPENDENTS = "FBS Independents";

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
  /**
   * Barred from the postseason this season (an NCAA or conference penalty): it can't play in its conference's title
   * game or the playoff, though its games count for everyone else. Set from POSTSEASON_BANS; absent otherwise.
   */
  postseasonBan?: boolean;
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
  /** A matchup the conference has projected but not confirmed, standing in until the data has the real game (the Pac-12's flex week). */
  projected?: boolean;
  /**
   * The conference's title game (see `seasonFromCfbd`). Never a conference game, whichever way CFBD flags it: it comes
   * after the standings and every tiebreak.
   */
  titleGame?: boolean;
};

/**
 * A College Football Playoff game as CFBD lists it once its matchup is set: its round and the seeds the committee gave
 * its two teams (CFBD's `playoff` field on postseason games, from the 2024 season).
 */
export type PlayoffGame = Game & {
  /** CFBD's round: "first_round", "quarterfinal", "semifinal" or "championship". */
  round: string;
  homeSeed: number | null;
  awaySeed: number | null;
};

/** One College Football Playoff committee ranking: team ids best first. */
export type CommitteeRelease = {
  /** CFBD's week for it: the selection-day ranking comes the week after the title games. */
  week: number;
  postseason: boolean;
  teamIds: number[];
};

export type Season = {
  year: number;
  /** ISO 8601 time the source data was fetched. */
  fetchedAt: string;
  teams: Team[];
  /** Regular-season games, the conference title games included. Bowls and playoff games are not here. */
  games: Game[];
  /** Playoff games CFBD lists (the matchups are set once the field is announced); absent or empty before. */
  playoffGames?: PlayoffGame[];
  /** The committee's rankings so far, oldest first; absent when the data has none. */
  committeeRankings?: CommitteeRelease[];
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
  /** "regular" or "postseason"; rows without one are regular-season games. */
  seasonType?: string | null;
  /** CFBD's note on the game: "SEC Championship", "College Football Playoff First Round Game". */
  notes?: string | null;
  /** On playoff games (2024 on): the round and the two teams' seeds. */
  playoff?: CfbdPlayoff | null;
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

export type CfbdPlayoff = {
  /** "cfp" for the College Football Playoff. */
  competition?: string | null;
  round?: string | null;
  bracketSlot?: string | null;
  homeSeed?: number | null;
  awaySeed?: number | null;
};

/** One week of CFBD's /rankings: every poll released that week. The committee's is "Playoff Committee Rankings". */
export type CfbdPollWeek = {
  season?: number;
  seasonType?: string | null;
  week: number;
  polls: { poll: string; ranks: { rank: number; teamId: number; school?: string }[] }[];
};

/** The committee's poll in CFBD's /rankings. */
export const COMMITTEE_POLL = "Playoff Committee Rankings";

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
  /** CFBD's /rankings weeks (only the committee's poll is read); absent in older snapshots. */
  rankings?: CfbdPollWeek[];
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
      ...(POSTSEASON_BANS[raw.year]?.includes(t.school) ? { postseasonBan: true } : {}),
    });
  }

  const spreadByGame = new Map<number, number>();
  for (const l of raw.lines) {
    const spreads = (l.lines ?? []).map((x) => x.spread).filter((s): s is number => typeof s === "number");
    if (spreads.length > 0) spreadByGame.set(l.id, median(spreads));
  }

  const games: Game[] = [];
  const playoffGames: PlayoffGame[] = [];
  const named = new Set<number>();
  const seen = new Set<number>();
  for (const g of raw.games) {
    if (seen.has(g.id)) throw new Error(`duplicate game id ${g.id}`);
    seen.add(g.id);
    // A matchup not set yet (a team to be decided) isn't a game we can use.
    if (typeof g.homeId !== "number" || typeof g.awayId !== "number") continue;
    const postseason = g.seasonType === "postseason";
    // Bowls other than the playoff's don't matter here.
    if (postseason && !isPlayoffRow(g)) continue;

    addOpponent(teams, g.homeId, g.homeTeam, g.homeConference, g.homeClassification);
    addOpponent(teams, g.awayId, g.awayTeam, g.awayConference, g.awayClassification);

    const homePoints = g.homePoints ?? null;
    const awayPoints = g.awayPoints ?? null;
    if (g.completed && (homePoints === null || awayPoints === null)) {
      throw new Error(`completed game ${g.id} has no final score`);
    }

    const game: Game = {
      id: g.id,
      week: g.week,
      start: g.startDate,
      neutralSite: g.neutralSite,
      conferenceGame: g.conferenceGame && !isArmyNavy(g.homeTeam, g.awayTeam) &&
        !isFlexGame(raw.year, g.week, teams.get(g.homeId)?.conference ?? g.homeConference, teams.get(g.awayId)?.conference ?? g.awayConference),
      homeId: g.homeId,
      awayId: g.awayId,
      homePoints: g.completed ? homePoints : null,
      awayPoints: g.completed ? awayPoints : null,
      completed: g.completed,
      spread: spreadByGame.get(g.id) ?? null,
    };
    if (postseason) {
      playoffGames.push({ ...game, conferenceGame: false, round: g.playoff?.round ?? "", homeSeed: g.playoff?.homeSeed ?? null, awaySeed: g.playoff?.awaySeed ?? null });
      continue;
    }
    if (/championship/i.test(g.notes ?? "")) named.add(g.id);
    games.push(game);
  }

  markTitleGames(raw.year, teams, games, named);
  games.push(...projectedFlexGames(raw.year, teams, games));
  games.sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
  playoffGames.sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);
  const teamList = [...teams.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { year: raw.year, fetchedAt: raw.fetchedAt, teams: teamList, games, playoffGames, committeeRankings: committeeRankings(raw.rankings ?? []) };
}

/** A College Football Playoff game: CFBD's `playoff.competition` is "cfp", or (before that field) its note says so. */
const isPlayoffRow = (g: CfbdGame): boolean =>
  g.playoff ? g.playoff.competition === "cfp" : /college football playoff/i.test(g.notes ?? "");

/** The committee's rankings from CFBD's /rankings weeks, oldest first (regular season, then postseason, by week). */
function committeeRankings(weeks: readonly CfbdPollWeek[]): CommitteeRelease[] {
  return weeks
    .flatMap((w) => w.polls.filter((p) => p.poll === COMMITTEE_POLL).map((p) => ({
      week: w.week,
      postseason: w.seasonType === "postseason",
      teamIds: [...p.ranks].sort((a, b) => a.rank - b.rank).map((r) => r.teamId),
    })))
    .sort((a, b) => Number(a.postseason) - Number(b.postseason) || a.week - b.week);
}

/**
 * Seasons whose schedules were too broken (COVID-19 in 2020: canceled and postponed games everywhere) for the
 * game-count check in findTitleGame; there the title game is found as it was before that check.
 */
const IRREGULAR_SEASONS: readonly number[] = [2020];

/**
 * The title game of the conference whose members are `ids`, as an index into `games`, or -1. Not part of the public
 * API. A game CFBD's note names (`named`: "SEC Championship") between two members comes first. Otherwise, among
 * games between two members in the latest week that has any (once earlier weeks have some): the only one, or else
 * the only one at a neutral site (a regular-season game postponed into title week, like Cal-Stanford in 2018, is at
 * home). It must also come after both teams' conference schedules: a game that leaves both of its teams short of
 * the median member's count of games against members, or either one two short, is a postponed or last-week game, not
 * the title game (before the title game is listed, the last regular week's only neutral-site game, like Michigan
 * State-Maryland at Ford Field in 2025, would otherwise be taken for it). CFBD's conference flag can't tell: title
 * games are conference games before 2025, non-conference games from 2025. Army-Navy (two American members, the week
 * after the title game) and the Pac-12's flex games (week 13, the week before its title game) are left out. A
 * conference of two teams (the Pac-12 in 2024-2025, which played twice) has none unless the note names one.
 */
export function findTitleGame(year: number, teams: ReadonlyMap<number, Team>, games: readonly Game[], ids: ReadonlySet<number>, named?: ReadonlySet<number>): number {
  const between = games.flatMap((g, i) => {
    const h = teams.get(g.homeId);
    const a = teams.get(g.awayId);
    const late = isArmyNavy(h?.name, a?.name) || isFlexGame(year, g.week, h?.conference, a?.conference);
    return ids.has(g.homeId) && ids.has(g.awayId) && !late ? [i] : [];
  });
  const byName = between.filter((i) => named?.has(games[i].id));
  if (byName.length > 0) return byName.reduce((x, i) => (games[i].week > games[x].week ? i : x));
  // Two members (the Pac-12 in 2024-2025) play each other twice and have no title game.
  if (between.length === 0 || ids.size < 3) return -1;
  const last = Math.max(...between.map((i) => games[i].week));
  const inLast = between.filter((i) => games[i].week === last);
  if (inLast.length === between.length) return -1;
  let pick = -1;
  if (inLast.length === 1) pick = inLast[0];
  else {
    const neutral = inLast.filter((i) => games[i].neutralSite);
    if (neutral.length === 1) pick = neutral[0];
  }
  if (pick < 0 || IRREGULAR_SEASONS.includes(year)) return pick;
  const count = new Map<number, number>([...ids].map((id) => [id, 0]));
  for (const i of between) {
    if (i === pick) continue;
    count.set(games[i].homeId, count.get(games[i].homeId)! + 1);
    count.set(games[i].awayId, count.get(games[i].awayId)! + 1);
  }
  const counts = [...count.values()].sort((a, b) => a - b);
  const median = counts[counts.length >> 1];
  const h = count.get(games[pick].homeId)!;
  const a = count.get(games[pick].awayId)!;
  // With most members yet to play one another, the season is too early for a title game.
  return median === 0 || (h < median && a < median) || h < median - 1 || a < median - 1 ? -1 : pick;
}

/** Marks each conference's title game (`Game.titleGame`), which is never a conference game. */
function markTitleGames(year: number, teams: ReadonlyMap<number, Team>, games: Game[], named: ReadonlySet<number>): void {
  const conferences = new Set([...teams.values()].map((t) => t.conference).filter((c): c is string => c !== null && c !== INDEPENDENTS));
  for (const c of conferences) {
    const ids = new Set([...teams.values()].filter((t) => t.conference === c).map((t) => t.id));
    if (ids.size < 2) continue;
    const i = findTitleGame(year, teams, games, ids, named);
    if (i >= 0) games[i] = { ...games[i], conferenceGame: false, titleGame: true };
  }
}

/**
 * FBS teams barred from the postseason, by season and school name (`Team.postseasonBan`). None in 2026: Akron, the
 * last one (a 2025 Academic Progress Rate ban), had it lifted by an NCAA waiver in March 2026
 * (https://gozips.com/news/2026/3/4/akron-football-bowl-eligible-for-2026-practice-restrictions-lifted), and teams
 * moving up to FBS are eligible at once (NCAA Division I Cabinet, June 24, 2026).
 */
const POSTSEASON_BANS: Readonly<Record<number, readonly string[]>> = { 2026: [] };

/**
 * Army-Navy, by the two schools' names. Both are American members (Army for football only, since 2024), so CFBD flags
 * their game a conference game, but it isn't one of the American's eight conference games and is played the week
 * after its title game. seasonFromCfbd makes it a non-conference game; titleGameIndex never takes it for the title game.
 */
export const isArmyNavy = (home: string | undefined, away: string | undefined): boolean =>
  (home === "Army" && away === "Navy") || (home === "Navy" && away === "Army");

/**
 * The Pac-12's 2026 flex week. Its eight members play a seven-game round robin in weeks 5-12, and the title-game
 * teams are set after week 12. In week 13 each plays another member, a game "considered a non-conference matchup for
 * standings", so seasonFromCfbd makes every game between members that week a non-conference game. The league named
 * projected pairings, its home teams fixed, to be confirmed six days before at the latest and changeable for CFP
 * considerations ("The new Pac-12 announces its 2026 football schedule", Feb. 11, 2026:
 * https://pac-12.com/news/2026/2/9/general-the-new-pac-12-announces-its-2026-football-schedule.aspx). Until the
 * data has a member's week-13 game, the projected one stands in, with a negative id.
 */
const FLEX_WEEKS = [
  {
    year: 2026,
    conference: "Pac-12",
    week: 13,
    // Saturday, Nov. 28; no kickoff time yet, so noon Eastern.
    start: "2026-11-28T17:00:00.000Z",
    /** [home, away]. */
    projected: [
      ["Utah State", "Boise State"],
      ["Colorado State", "Texas State"],
      ["Fresno State", "San Diego State"],
      ["Washington State", "Oregon State"],
    ],
  },
] as const;

/** A game between two members of a conference in its flex week: played after the title-game teams are set, and not in the standings. */
export const isFlexGame = (year: number, week: number, home: string | null | undefined, away: string | null | undefined): boolean =>
  FLEX_WEEKS.some((f) => f.year === year && f.week === week && home === f.conference && away === f.conference);

/** The projected flex games the data doesn't have yet: each pairing whose two teams have no game that week. */
function projectedFlexGames(year: number, teams: Map<number, Team>, games: Game[]): Game[] {
  const out: Game[] = [];
  for (const f of FLEX_WEEKS) {
    if (f.year !== year) continue;
    const busy = new Set(games.filter((g) => g.week === f.week).flatMap((g) => [g.homeId, g.awayId]));
    const member = (name: string) => [...teams.values()].find((t) => t.name === name && t.conference === f.conference);
    f.projected.forEach(([h, a], k) => {
      const home = member(h);
      const away = member(a);
      if (!home || !away || busy.has(home.id) || busy.has(away.id)) return;
      out.push({
        id: -(k + 1), week: f.week, start: f.start, neutralSite: false, conferenceGame: false,
        homeId: home.id, awayId: away.id, homePoints: null, awayPoints: null, completed: false, spread: null, projected: true,
      });
    });
  }
  return out;
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
