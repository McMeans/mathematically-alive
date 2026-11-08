// College Football Playoff formats per season (phase 4, stages 4 and 5): who gets in, how they are seeded, and the
// bracket they play. Every format cites its source. A season with no format is an error.
import { committeeRanking, powerConferences } from "./committee";
import type { Season } from "./season";

export type PlayoffFormat = {
  /** Seasons this format covers. */
  seasons: readonly number[];
  /** Where the rules come from. */
  source: string;
  teams: 4 | 12;
  /**
   * Automatic bids. "none": the top four by ranking. "top5Champions": the five highest-ranked conference champions,
   * from any conference. "power4G6": each power conference's champion, the highest-ranked Group of Six team
   * (champion or not), and Notre Dame when it ranks in the top 12.
   */
  autoBids: "none" | "top5Champions" | "power4G6";
  /** "ranking": seeds go straight by ranking. "topChampions": the four highest-ranked champions are seeds 1-4. */
  seeding: "ranking" | "topChampions";
};

const FORMATS: readonly PlayoffFormat[] = [
  {
    seasons: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
    source: "CFP selection committee protocol, four-team format (2014-2023): the top four teams in the final ranking, 1 vs 4 and 2 vs 3 in the semifinals.",
    teams: 4,
    autoBids: "none",
    seeding: "ranking",
  },
  {
    seasons: [2024],
    source: "CFP Board of Managers, 12-team format (Sept. 2, 2022; five-plus-seven model, Dec. 6, 2023): the five highest-ranked conference champions and the next seven; the four highest-ranked champions are seeds 1-4 with byes.",
    teams: 12,
    autoBids: "top5Champions",
    seeding: "topChampions",
  },
  {
    seasons: [2025],
    source: "CFP Management Committee, May 22, 2025: straight seeding by the final ranking, top four with byes; the five highest-ranked conference champions still get in.",
    teams: 12,
    autoBids: "top5Champions",
    seeding: "ranking",
  },
  {
    seasons: [2026],
    source:
      "CFP Management Committee, 2026 season (no rule document published; reported by SI, Jan. 27, 2026, https://www.si.com/college/boise-state/football/college-football-playoff-changes-format-for-group-of-six-representation, Front Office Sports, Feb. 2, 2026, and NCAA.com, Feb. 3, 2026, https://www.ncaa.com/news/football/article/2026-02-03/how-college-football-playoff-automatic-qualifiers-work-byes-seeds): 12 teams; the ACC, Big 12, Big Ten and SEC champions, the highest-ranked Group of Six team whether or not it won its conference, and Notre Dame with a top-12 finish get in; seven at-large; straight seeding, top four with byes, no reseeding.",
    teams: 12,
    autoBids: "power4G6",
    seeding: "ranking",
  },
];

/** The season's format, or undefined. Not part of the public API. */
export const findFormat = (year: number): PlayoffFormat | undefined => FORMATS.find((x) => x.seasons.includes(year));

/** The season's playoff format. Throws for a season with none. */
export function playoffFormat(year: number): PlayoffFormat {
  const f = findFormat(year);
  if (!f) throw new Error(`No playoff format for ${year}`);
  return f;
}

/** Which conference champions the format needs to pick a field: none, the power conferences', or every one. */
export const championsNeeded = (f: PlayoffFormat): "none" | "power" | "all" =>
  f.autoBids === "none" ? "none" : f.autoBids === "power4G6" ? "power" : "all";

/** Picks and seeds a field from a ranking. Set up once per season; `pick` runs once per simulated season. */
export type FieldPicker = (ranking: ArrayLike<number>, isChampion: (teamId: number) => boolean) => number[];

/** Not part of the public API: `playoffField` and `simulateNational` share it. */
export function fieldPicker(season: Season): FieldPicker {
  const format = playoffFormat(season.year);
  const power = new Set(powerConferences(season.year));
  const conf = new Map(season.teams.map((t) => [t.id, t.conference]));
  const g6 = new Set(
    season.teams
      .filter((t) => t.classification === "fbs" && t.conference !== null && t.conference !== "FBS Independents" && !power.has(t.conference))
      .map((t) => t.id),
  );
  const notreDame = season.teams.find((t) => t.name === "Notre Dame")?.id;
  // Teams barred from the postseason are skipped: no bid of any kind, and the next team takes the spot.
  const barred = new Set(season.teams.filter((t) => t.postseasonBan).map((t) => t.id));

  // Places (indexes into the ranking) of the automatic bids, reused across calls: this runs once per simulated season.
  const autos: number[] = [];
  // The ranking without barred teams, reused across calls the same way.
  const eligible: number[] = [];
  const powerCount = power.size;
  return (all, isChampion) => {
    let ranking: ArrayLike<number> = all;
    if (barred.size > 0) {
      eligible.length = 0;
      for (let k = 0; k < all.length; k++) if (!barred.has(all[k])) eligible.push(all[k]);
      ranking = eligible;
    }
    const n = ranking.length;
    const T = Math.min(format.teams, n);
    if (format.autoBids === "none") return Array.from({ length: T }, (_, k) => ranking[k]);
    autos.length = 0;
    if (format.autoBids === "top5Champions") {
      for (let k = 0; k < n && autos.length < 5; k++) if (isChampion(ranking[k])) autos.push(k);
    } else {
      let g6Taken = false;
      let champs = 0;
      // Past the top 12 with every power champion and the Group of Six team found, nothing else gets a bid.
      for (let k = 0; k < n && !(k >= 12 && g6Taken && champs === powerCount); k++) {
        const id = ranking[k];
        const c = conf.get(id);
        if (c != null && power.has(c) && isChampion(id)) { autos.push(k); champs++; }
        else if (!g6Taken && g6.has(id)) { autos.push(k); g6Taken = true; }
        else if (id === notreDame && k < 12) autos.push(k);
      }
    }
    // The rest go at large, best ranked first; the field lists everyone in ranking order.
    let atLarge = Math.max(0, T - autos.length);
    const field: number[] = [];
    for (let k = 0; k < n && field.length < Math.max(T, autos.length); k++) {
      if (autos.includes(k)) field.push(ranking[k]);
      else if (atLarge > 0) { field.push(ranking[k]); atLarge--; }
    }
    // Seeds: by ranking, except that "topChampions" puts the four highest-ranked champions first.
    if (format.seeding === "ranking") return field;
    const top = field.filter((id) => isChampion(id)).slice(0, 4);
    return [...top, ...field.filter((id) => !top.includes(id))];
  };
}

/**
 * The season's playoff field, seeded (seed 1 first), from a ranking of FBS teams (best first) and the conference
 * champions. A team barred from the postseason (`Team.postseasonBan`) is skipped, so the Group of Six bid goes to
 * the highest-ranked Group of Six team that can play. What counts as a champion depends on the format: every
 * conference's in 2024-2025, the power conferences' from 2026. Four-team seasons ignore champions.
 */
export function playoffField(season: Season, ranking: readonly number[], champions: readonly number[]): number[] {
  const set = new Set(champions);
  return fieldPicker(season)(ranking, (id) => set.has(id));
}

/**
 * The bracket as games over seed slots (0 is seed 1). Each game is [a, b, home]: a and b are a seed slot or, when
 * written as ~g, the winner of game g; home is true when `a` (the higher seed) hosts. The last game is the final.
 * 12 teams: first round 5-12, 6-11, 7-10, 8-9 at the higher seed; quarterfinals at neutral sites with 1-4 against
 * the winners (1 meets 8/9, 2 meets 7/10, 3 meets 6/11, 4 meets 5/12); semifinals 1/8/9 bracket against 4/5/12, 2
 * against 3; no reseeding. 4 teams: 1 vs 4, 2 vs 3, then the final, all neutral.
 */
export function bracketGames(teams: 4 | 12): readonly (readonly [number, number, boolean])[] {
  if (teams === 4) return [[0, 3, false], [1, 2, false], [~0, ~1, false]];
  return [
    [4, 11, true], [5, 10, true], [6, 9, true], [7, 8, true],
    [0, ~3, false], [1, ~2, false], [2, ~1, false], [3, ~0, false],
    [~4, ~7, false], [~5, ~6, false],
    [~8, ~9, false],
  ];
}

/** The field the committee announced, seed 1 first, and where it came from. */
export type AnnouncedField = {
  /** Team ids, seed 1 first. */
  seeds: number[];
  /**
   * "bracket": every seed from CFBD's playoff games (their `playoff.homeSeed` and `awaySeed`). "ranking": some or all
   * from the committee's selection-day ranking under the season's format (CFBD's /rankings), the bracket's seeds kept
   * where it lists them: CFBD may list the first round before the quarterfinals, whose top four seeds have byes.
   */
  source: "bracket" | "ranking";
};

/**
 * The playoff field the committee announced, once the data has it; null before (the field is then simulated). From
 * CFBD's playoff games when they name every seed; otherwise from the committee's selection-day ranking (the first one
 * released after every title game the format needs is final) under the season's format, with the champions the
 * title games in the data crowned, the seeds the playoff games already name kept. Teams the ranking leaves out (it
 * ranks 25) follow in the committee stand-in's order, so an unranked champion with an automatic bid is seeded last.
 */
export function announcedField(season: Season): AnnouncedField | null {
  const format = findFormat(season.year);
  if (!format) return null;
  const T = format.teams;
  const known = new Map<number, number>();
  for (const g of season.playoffGames ?? []) {
    if (g.homeSeed !== null && g.homeSeed >= 1 && g.homeSeed <= T) known.set(g.homeSeed, g.homeId);
    if (g.awaySeed !== null && g.awaySeed >= 1 && g.awaySeed <= T) known.set(g.awaySeed, g.awayId);
  }
  const listed = Array.from({ length: T }, (_, s) => known.get(s + 1));
  if (listed.every((id) => id !== undefined) && new Set(listed).size === T) return { seeds: listed as number[], source: "bracket" };

  const fromRanking = rankingField(season, format);
  if (!fromRanking) return null;
  // The bracket's seeds win; the ranking's field fills the rest in its order.
  const placed = new Set(listed.filter((id): id is number => id !== undefined));
  const rest = fromRanking.filter((id) => !placed.has(id));
  return { seeds: listed.map((id) => id ?? rest.shift()!), source: "ranking" };
}

/** The field the format picks from the committee's selection-day ranking and the data's title games; null without them. */
function rankingField(season: Season, format: PlayoffFormat): number[] | null {
  const titles = season.games.filter((g) => g.titleGame === true);
  const conf = new Map(season.teams.map((t) => [t.id, t.conference]));
  const needs = championsNeeded(format);
  const power = powerConferences(season.year);
  const counted = titles.filter((g) => needs === "all" || power.includes(conf.get(g.homeId) ?? ""));
  if (needs === "power" && !power.every((c) => counted.some((g) => conf.get(g.homeId) === c))) return null;
  if (titles.length === 0 || counted.some((g) => !g.completed)) return null;
  const titleWeek = Math.max(...titles.map((g) => g.week));
  const releases = (season.committeeRankings ?? []).filter((r) => r.postseason || r.week > titleWeek);
  if (releases.length === 0) return null;
  // The first ranking after the title games is selection day's.
  const ranked = releases[0].teamIds;
  const inRanking = new Set(ranked);
  const ranking = [...ranked, ...committeeRanking(season).map((r) => r.teamId).filter((id) => !inRanking.has(id))];
  const champions = needs === "none" ? [] : counted.map((g) => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId));
  return playoffField(season, ranking, champions);
}

/** A team's playoff once the field is announced. */
export type PlayoffRun = {
  /** Its seed; null when it wasn't selected. */
  seed: number | null;
  /** "in": selected and still playing; "out": not selected, or lost a playoff game; "champion": won the final. */
  state: "in" | "out" | "champion";
  /**
   * "Seed 3 in the playoff, with a first-round bye", "Seed 10 in the playoff: beat Ohio State 24-14 in the
   * quarterfinal", "Seed 2 in the playoff: lost to Miami 24-14 in the quarterfinal", "Seed 1 in the playoff: won the
   * national title, 27-21 over Miami", or "Not selected for the playoff".
   */
  text: string;
};

const ROUND_NAMES: Record<string, string> = {
  first_round: "first round", quarterfinal: "quarterfinal", semifinal: "semifinal", championship: "national title game",
};

/** A team's run through the announced field and the playoff games played so far. Not part of the public API. */
export function playoffRun(season: Season, field: readonly number[], teamId: number): PlayoffRun {
  const k = field.indexOf(teamId);
  if (k < 0) return { seed: null, state: "out", text: "Not selected for the playoff" };
  const seed = k + 1;
  const head = `Seed ${seed} in the playoff`;
  const played = (season.playoffGames ?? []).filter((g) => g.completed && (g.homeId === teamId || g.awayId === teamId));
  const last = played[played.length - 1];
  if (!last) return { seed, state: "in", text: field.length === 12 && seed <= 4 ? `${head}, with a first-round bye` : head };
  const other = last.homeId === teamId ? last.awayId : last.homeId;
  const name = season.teams.find((t) => t.id === other)?.name ?? `Team ${other}`;
  const score = `${Math.max(last.homePoints!, last.awayPoints!)}-${Math.min(last.homePoints!, last.awayPoints!)}`;
  const won = (last.homePoints! > last.awayPoints! ? last.homeId : last.awayId) === teamId;
  const round = ROUND_NAMES[last.round] ?? "playoff";
  if (!won) return { seed, state: "out", text: `${head}: lost to ${name} ${score} in the ${round}` };
  if (last.round === "championship") return { seed, state: "champion", text: `${head}: won the national title, ${score} over ${name}` };
  return { seed, state: "in", text: `${head}: beat ${name} ${score} in the ${round}` };
}
