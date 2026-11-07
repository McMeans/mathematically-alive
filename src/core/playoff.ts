// College Football Playoff formats per season (phase 4, stages 4 and 5): who gets in, how they are seeded, and the
// bracket they play. Every format cites its source. A season with no format is an error.
import { powerConferences } from "./committee";
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

  return (ranking, isChampion) => {
    const n = ranking.length;
    if (format.autoBids === "none") return Array.from({ length: Math.min(format.teams, n) }, (_, k) => ranking[k]);
    const take = new Set<number>();
    if (format.autoBids === "top5Champions") {
      for (let k = 0; k < n && take.size < 5; k++) if (isChampion(ranking[k])) take.add(ranking[k]);
    } else {
      let g6Taken = false;
      for (let k = 0; k < n; k++) {
        const id = ranking[k];
        const c = conf.get(id);
        if (c != null && power.has(c) && isChampion(id)) take.add(id);
        else if (!g6Taken && g6.has(id)) { take.add(id); g6Taken = true; }
        else if (id === notreDame && k < 12) take.add(id);
      }
    }
    for (let k = 0; k < n && take.size < format.teams; k++) take.add(ranking[k]);
    // Seeds: by ranking, except that "topChampions" puts the four highest-ranked champions first.
    const inField = Array.from({ length: n }, (_, k) => ranking[k]).filter((id) => take.has(id));
    if (format.seeding === "ranking") return inField;
    const top = inField.filter((id) => isChampion(id)).slice(0, 4);
    return [...top, ...inField.filter((id) => !top.includes(id))];
  };
}

/**
 * The season's playoff field, seeded (seed 1 first), from a ranking of FBS teams (best first) and the conference
 * champions. What counts as a champion depends on the format: every conference's in 2024-2025, the power
 * conferences' from 2026. Four-team seasons ignore champions.
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
