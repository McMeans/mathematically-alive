// The team page's board: the playoff odds by final record and the ways in, help from elsewhere grouped by the team
// to root against, the likeliest title-game matchup, and the playoff race around the cut line. Read from one season
// simulation and the national run over the same seasons. All wording the page shows is here.
import type { NationalResult } from "./national";
import { conferenceName, formatOdds, formatRecord, formatSideOdds, shownSideOdds } from "./paths";
import { powerConferences } from "./committee";
import { fieldPicker, playoffFormat } from "./playoff";
import { INDEPENDENTS, teamRecord, type Game, type Season } from "./season";
import { gameWinProbability, type SimResult } from "./sim";
import { OVERALL, isClear } from "./signal";
import type { Likeliest } from "./tree";

/** One final record the team can finish with, and its odds there. */
export type RecordOdds = {
  wins: number;
  losses: number;
  /** "9-3". */
  record: string;
  /** "9-3 · win out" for the best record left, else the record. */
  label: string;
  /** Share of simulated seasons it finishes with this record. */
  share: number;
  /** "24% likely". */
  likely: string;
  /** Its playoff odds (EXPERIMENTAL) in those seasons, and for display ("15%", "<0.1%"). */
  playoff: number;
  playoffText: string;
  /** Its conference title-game odds in those seasons; null for an independent. */
  titleGame: number | null;
  titleGameText: string | null;
};

/** One way into the playoff: winning the conference, or an at-large spot. */
export type WayIn = {
  /** "Win the ACC", "At-large". */
  label: string;
  /** Share of simulated seasons it gets in this way, and for display. */
  odds: number;
  oddsText: string;
  /** "The champion gets a spot.", "Almost only at 9-3." */
  text: string;
};

/** One side of a game elsewhere, with the team's odds if that side wins. */
export type HelpSide = {
  teamId: number;
  /** "SMU wins". */
  label: string;
  /** "44% chance": this side's chance to win the game. */
  chance: string;
  /** The team's playoff odds (EXPERIMENTAL) in the seasons this side wins, and for display. */
  playoff: number;
  playoffText: string;
  /** The team's title-game odds in those seasons; null for an independent. */
  titleGame: number | null;
  titleGameText: string | null;
  /**
   * What this side does to the team's playoff odds, in whole points against its odds today: "+5" for the side to root
   * for, "−2" for the other; null when it rounds to no change.
   */
  playoffChange: string | null;
  /** The side to root for. */
  root: boolean;
};

/** A game elsewhere that moves the team's playoff odds, seen from the team to root against. */
export type HelpGame = {
  gameId: number;
  /** "Nov 14". */
  date: string;
  /** Where the team to root against plays it: "at", "vs" (home) or "vs" at a neutral site. */
  site: "at" | "vs";
  opponentId: number;
  opponent: string;
  /** The side to root for first. */
  sides: [HelpSide, HelpSide];
};

/** The games elsewhere a team needs one team to lose. */
export type HelpGroup = {
  /** The team to root against. */
  teamId: number;
  team: string;
  /** Its record so far, picks counted: "8-1 (5-1 ACC)". */
  record: string;
  /** "Root against Wake Forest". */
  title: string;
  games: HelpGame[];
};

/** The conference title game as it looks now: its likeliest matchup, and the team's odds in it when it's one of the two. */
export type TitleWeek = {
  conference: string;
  /** "ACC title game". */
  label: string;
  /** The likeliest two teams, likelier to play in it first. */
  teams: [number, number];
  /** Both ids sorted, so a flip in order is the same matchup. */
  key: string;
  /** "Likeliest matchup: Miami vs Wake Forest." */
  line: string;
  /** "Louisville gets a pick here once your picks put it in that matchup."; null when it's in it. */
  waiting: string | null;
  /** The team's side when it's one of the two; null otherwise. */
  mine: {
    opponentId: number;
    /** Its chance to win the game when they meet, and for display ("31% chance if they meet"); null when too few seasons have this matchup. */
    winChance: number | null;
    winText: string;
    loseText: string;
    /** Its playoff odds (EXPERIMENTAL) if it wins or loses that game, for display. */
    ifWin: string;
    ifLose: string;
  } | null;
};

/** One team in the playoff race. */
export type RaceRow = {
  kind: "team";
  teamId: number;
  team: string;
  /** Its seed in the projected field; null when it's out. */
  seed: number | null;
  /** Its projected final rank, 1 is best: where the committee stand-in ranks it after championship week, over the simulated seasons. */
  projected: number;
  /**
   * The automatic bid it holds in the projected field: its conference ("ACC", "B1G", "SEC", "B12") for a power
   * champion, "G6" for the Group of Six bid, "ND" when the top-12 rule is what puts Notre Dame in. Null otherwise.
   */
  tag: string | null;
  /** In the field on an automatic bid, seeded below the last at-large team. */
  under: boolean;
  /** Its chance to make the field, and for display ("63%"). */
  field: number;
  text: string;
  /** The page's team. */
  me: boolean;
};

/**
 * One line of the playoff race card, top to bottom: a team, the first-round bye line (under seed 4), the cut (under
 * the last at-large team), the "Next in line" heading over the teams out, the Group of Six bid line (under the top
 * Group of Six team), or a gap where teams are left out.
 */
export type RaceItem =
  | RaceRow
  | { kind: "bye"; label: string }
  | { kind: "cut"; label: string }
  | { kind: "next"; label: string }
  | { kind: "bid"; label: string }
  | { kind: "gap" };

/**
 * The playoff race as a projected field: the projected final ranking, the field the format picks from it and the
 * likeliest champions, seeded, then the teams out by projected rank. Shows the slice around the page's team: two
 * seeds either side when it's well inside the field; otherwise the two teams above the cut, every automatic bid under
 * it, the first teams out, and the page's team.
 *
 * A Group of Six team's page (in a format with a Group of Six bid) leads with its own race instead, `g6`: the Group of
 * Six teams by projected rank, the top one (the bid) over the bid line, the first four and the page's team. `items`
 * is then just the at-large line: the last at-large team and the first team out, each unless `g6` already shows it.
 */
export type PlayoffRace = {
  /** On a Group of Six page, the Group of Six race ("Group of Six bid"); null otherwise. */
  g6: { title: string; items: RaceItem[] } | null;
  /** The heading over `items` when `g6` is shown ("At-large line"); null otherwise. */
  title: string | null;
  items: RaceItem[];
  /** "Projected seeds and final ranking". */
  note: string;
  /** Column headings: ["Seed", "Team", "Proj.", "Field"]. */
  columns: string[];
};

/** Each side's chance to win one of the team's own games left. */
export type OwnChance = {
  gameId: number;
  /** "58% chance" for the team, "42% chance" for its opponent. */
  win: string;
  lose: string;
};

/**
 * One row of the best shot's ladder: where things stand today, a step of the way in (the team's own results, one
 * rival's, the favorites winning the rest), or the title game itself. Each row's odds are over the seasons where it
 * and every row above it happen.
 */
export type ShotStep = {
  kind: "today" | "step" | "rest" | "title";
  /** "Today", "Louisville wins all 3 left", "Wake Forest loses to SMU", "Favorites win the rest", "Louisville wins the title game". */
  text: string;
  /** Under it: "24% likely" (its chance on its own), "5 games" (the rest), "vs Miami · 26% chance". Empty for today. */
  detail: string;
  /** The team's title-game odds after this row: "23%", "In", "Won", "—" when too few seasons go this way. */
  titleGame: string;
  /** Its playoff odds after this row (EXPERIMENTAL): "13%", "In", "—". */
  playoff: string;
  /** What the row adds to the row above, in points: "+14", "−3"; null for today, for no change, and for "—". */
  titleAdd: string | null;
  playoffAdd: string | null;
  /** The results the row needs: the picks that complete it. Empty for today and the title game. */
  results: { gameId: number; winner: number }[];
};

/** The likeliest way into the title game as a ladder, each step with what it does for the title game and the playoff. */
export type BestShot = {
  /** "Way into the ACC title game". */
  title: string;
  /** "The likeliest results that put Louisville in it. Each row adds to the rows above." */
  sub: string;
  /** The way in one line: "Win out, Wake Forest loses once". */
  headline: string;
  /** Column heads: "After", "Title game", "Playoff". */
  columns: [string, string, string];
  /** Today first, then each step, then the title game. */
  steps: ShotStep[];
  /**
   * "All of it happens in about 1 in 30 seasons. The champion gets a playoff spot.", after the way's own note when it
   * has one: "With these results Louisville gets in about 33% of the time, depending on the ranking tiebreak."
   */
  note: string;
  /** "Fill in this path". */
  fill: string;
  /** "Your picks leave this path.": shown in place of `note` once a pick goes against a step. */
  left: string;
};

export type TeamBoard = {
  /** "Playoff odds by final record." */
  recordsNote: string;
  /** Best record first; only records it can still finish with. */
  records: RecordOdds[];
  /** Its ways into the playoff, likeliest first; empty when the page can't say (a Group of Six team, an independent). */
  ways: WayIn[];
  /** Games elsewhere that move its playoff odds, grouped by the team to root against; biggest swing first. */
  help: HelpGroup[];
  /** "Every game elsewhere that moves Louisville’s playoff odds by more than a point has one team in it." */
  helpNote: string;
  /** "Every other game moves Louisville’s odds by less than a point."; null when no game does. */
  quiet: string | null;
  /** Null for an independent, or when the conference's title game isn't simulated. */
  titleWeek: TitleWeek | null;
  race: PlayoffRace | null;
  /** The team's own games left, in schedule order, with each side's chance to win. */
  own: OwnChance[];
  /** The best-shot card; null without a likeliest way into the title game. */
  bestShot: BestShot | null;
};

/**
 * Odds as a plain "1 in N" ("1 in 5") below a half, so a long shot reads as one; otherwise whole percents. Under 1 in
 * 100 shows "<1 in 100".
 */
export function oneIn(p: number): string {
  if (p >= 0.5) return formatOdds(p);
  if (p < 0.01) return "<1 in 100";
  return `1 in ${Math.round(1 / p)}`;
}

/** The team's latest committee rank, as shown by its name ("#16"), for every ranked team; empty before the first ranking. */
export function committeeRanks(season: Season): Record<number, string> {
  const latest = (season.committeeRankings ?? []).at(-1);
  return latest ? Object.fromEntries(latest.teamIds.map((id, k) => [id, `#${k + 1}`])) : {};
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
// Help from elsewhere: at most this many teams to root against, and games in all.
const MAX_GROUPS = 4;
const MAX_GAMES = 8;
// Seasons a title-game matchup needs before its odds are shown.
const MIN_MATCHUP = 50;
// The playoff race: rows either side of a team well inside the field; teams out shown under the cut (more when the
// page's team is among the first this many out).
const AROUND = 2;
const FIRST_OUT = 2;
const NEAR_OUT = 5;
// A Group of Six page's race: the top Group of Six teams it lists before skipping down to the page's team.
const G6_SHOWN = 4;
// The power conferences' tags on the race.
const BID_TAGS: Record<string, string> = { "Big Ten": "B1G", "Big 12": "B12" };

/**
 * The board for `teamId` (`conference` null for an independent). `sim` and `national` must be the same simulated
 * seasons (same iterations, seed and locks). `locks` are those locks, for the records shown in the title week.
 */
export function teamBoard(season: Season, sim: SimResult, national: NationalResult, teamId: number, conference: string | null, locks: Record<number, number> = {}, likeliest: Likeliest | null = null): TeamBoard | null {
  if (!national.playoff || sim.iterations !== national.iterations) return null;
  const n = sim.iterations;
  const name = (id: number) => season.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;
  const me = name(teamId);
  const titled = conference !== null && national.conferences.includes(conference);
  const unplayed = season.games.map((g, index) => ({ g, index })).filter(({ g }) => !g.completed && !g.titleGame);
  const own = unplayed.filter(({ g }) => g.homeId === teamId || g.awayId === teamId);
  const others = unplayed.filter(({ g }) => g.homeId !== teamId && g.awayId !== teamId);

  // Each game's place in the season, as the simulation's winnerOf takes it.
  const index = new Map(season.games.map((g, i) => [g.id, i]));
  // The best shot's steps: the team's own results, then each rival's, then the rest (favorites winning).
  const involves = (gameId: number, id: number) => { const g = season.games[index.get(gameId)!]; return g.homeId === id || g.awayId === id; };
  const shotGroups: { kind: "step" | "rest"; text: string; detail: string; results: { gameId: number; winner: number }[] }[] = [];
  if (likeliest && likeliest.picks.length > 0) {
    const taken = new Set<number>();
    const add = (kind: "step" | "rest", text: string, detail: string, results: { gameId: number; winner: number }[]) => {
      if (results.length === 0) return;
      for (const r of results) taken.add(r.gameId);
      shotGroups.push({ kind, text, detail, results });
    };
    add("step", `${me} ${likeliest.ownSummary}`, `${formatOdds(likeliest.ownChance)} likely`, likeliest.picks.filter((p) => involves(p.gameId, teamId)));
    for (const rv of likeliest.rivals) {
      add("step", `${rv.team} ${rv.line.charAt(0).toLowerCase()}${rv.line.slice(1)}`, `${formatOdds(rv.chance)} likely`,
        likeliest.picks.filter((p) => !taken.has(p.gameId) && !involves(p.gameId, teamId) && involves(p.gameId, rv.teamId)));
    }
    const rest = likeliest.picks.filter((p) => !taken.has(p.gameId));
    add("rest", "Favorites win the rest", `${rest.length} ${rest.length === 1 ? "game" : "games"}`, rest);
  }
  const groupIdx = shotGroups.map((gr) => gr.results.map((p) => ({ i: index.get(p.gameId)!, winner: p.winner })));
  // Per season: the team's wins in its games left, which side won each game elsewhere, and how many of the best
  // shot's steps happened in a row, from the first.
  const reach = new Uint8Array(n);
  const ownWins = new Uint8Array(n);
  const homeWon = new Uint8Array(n * others.length);
  sim.forEachIteration((it, winnerOf) => {
    let w = 0;
    for (const { index } of own) if (winnerOf(index) === teamId) w++;
    ownWins[it] = w;
    let r = 0;
    while (r < groupIdx.length && groupIdx[r].every((p) => winnerOf(p.i) === p.winner)) r++;
    reach[it] = r;
    others.forEach(({ g, index }, k) => { if (winnerOf(index) === g.homeId) homeWon[it * others.length + k] = 1; });
  });
  // Per season: in the field, in the title game, its conference's champion.
  const inField = new Uint8Array(n);
  const inTitle = new Uint8Array(n);
  const champ = new Uint8Array(n);
  const pairs = new Map<string, number>();
  const pairOf = new Array<string>(n);
  const champOf = new Int32Array(n);
  // For the race: each team's final ranks (a histogram), and each power conference's champions.
  const fbs = national.teams.map((t) => t.teamId);
  const fbsAt = new Map(fbs.map((id, i) => [id, i]));
  const rankHist = new Uint32Array(fbs.length * fbs.length);
  const powers = powerConferences(season.year).filter((c) => national.conferences.includes(c));
  const champCounts = new Map(powers.map((c) => [c, new Map<number, number>()]));
  national.forEachIteration((it, s) => {
    s.ranking.forEach((id, k) => { const i = fbsAt.get(id); if (i !== undefined) rankHist[i * fbs.length + k]++; });
    for (const [c, m] of champCounts) { const w = s.champion(c); m.set(w, (m.get(w) ?? 0) + 1); }
    if (s.field?.includes(teamId)) inField[it] = 1;
    if (!titled) return;
    const [a, b] = s.titleGame(conference!);
    if (a === teamId || b === teamId) inTitle[it] = 1;
    const c = s.champion(conference!);
    champOf[it] = c;
    if (c === teamId) champ[it] = 1;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    pairOf[it] = key;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  });

  const show = (p: number) => formatSideOdds(p, "alive");
  const base = teamRecord(season, teamId);
  const most = own.length;

  // By final record, best first.
  const byWins = Array.from({ length: most + 1 }, () => ({ n: 0, field: 0, title: 0, atLarge: 0 }));
  for (let it = 0; it < n; it++) {
    const r = byWins[ownWins[it]];
    r.n++;
    r.field += inField[it];
    r.title += inTitle[it];
    if (inField[it] && !champ[it]) r.atLarge++;
  }
  const recordOf = (w: number) => `${base.wins + w}-${base.losses + most - w}`;
  const records: RecordOdds[] = [];
  for (let w = most; w >= 0; w--) {
    const r = byWins[w];
    if (r.n === 0) continue;
    const record = recordOf(w);
    records.push({
      wins: base.wins + w, losses: base.losses + most - w, record,
      label: w === most && most > 0 ? `${record} · win out` : record,
      share: r.n / n, likely: `${formatOdds(r.n / n)} likely`,
      playoff: r.field / r.n, playoffText: show(r.field / r.n),
      titleGame: titled ? r.title / r.n : null, titleGameText: titled ? show(r.title / r.n) : null,
    });
  }

  // The ways in: the conference title (an automatic bid for a power conference from 2026), and an at-large spot.
  const ways: WayIn[] = [];
  const format = playoffFormat(season.year);
  const autoBid = titled && format.autoBids === "power4G6" && powerConferences(season.year).includes(conference!);
  if (autoBid) {
    let won = 0, wonIn = 0, atLarge = 0;
    for (let it = 0; it < n; it++) {
      if (champ[it]) { won++; wonIn += inField[it]; } else atLarge += inField[it];
    }
    const champText = won === 0 || wonIn / won >= 0.995 ? "The champion gets a spot." : `The champion gets in ${formatOdds(wonIn / won)} of the time.`;
    ways.push({ label: `Win the ${conferenceName(conference!)}`, odds: won / n, oddsText: show(won / n), text: champText });
    if (atLarge > 0) {
      // Where the at-large seasons come from: the record most of them finish with.
      const at = byWins.map((r, w) => ({ w, k: r.atLarge })).filter((x) => x.k > 0).sort((x, y) => y.k - x.k || y.w - x.w);
      const top = at[0].k / atLarge;
      const text = top >= 0.8 ? `Almost only at ${recordOf(at[0].w)}.` : top >= 0.5 || at.length === 1 ? `Mostly at ${recordOf(at[0].w)}.` : `At ${recordOf(at[0].w)} or ${recordOf(at[1].w)}.`;
      ways.push({ label: "At-large", odds: atLarge / n, oddsText: show(atLarge / n), text });
    }
    ways.sort((x, y) => y.odds - x.odds);
  }

  // Help from elsewhere: games that clearly move the playoff odds, grouped by the side to root against.
  const games: { game: HelpGame; against: number; swing: number }[] = [];
  // In points of the odds as shown beside it, so "0.4%" against today's "<0.1%" reads "+0.3".
  const today = shownSideOdds(inField.reduce((a, b) => a + b, 0) / n, "alive");
  const change = (p: number) => { const d = Math.round((shownSideOdds(p, "alive") - today) * 10) / 10; return d > 0 ? `+${d}` : d < 0 ? `−${-d}` : null; };
  others.forEach(({ g }, k) => {
    let hn = 0, hIn = 0, aIn = 0, hT = 0, aT = 0;
    for (let it = 0; it < n; it++) {
      if (homeWon[it * others.length + k]) { hn++; hIn += inField[it]; hT += inTitle[it]; } else { aIn += inField[it]; aT += inTitle[it]; }
    }
    const an = n - hn;
    if (!isClear(hn, hIn, an, aIn, OVERALL)) return;
    const pHome = gameWinProbability(season, g);
    const side = (id: number, home: boolean): HelpSide => {
      const [k2, f, t] = home ? [hn, hIn, hT] : [an, aIn, aT];
      return {
        teamId: id, label: `${name(id)} wins`, chance: `${formatOdds(home ? pHome : 1 - pHome)} chance`,
        playoff: f / k2, playoffText: show(f / k2),
        titleGame: titled ? t / k2 : null, titleGameText: titled ? show(t / k2) : null, playoffChange: change(f / k2), root: false,
      };
    };
    const home = side(g.homeId, true), away = side(g.awayId, false);
    const [good, bad] = home.playoff >= away.playoff ? [home, away] : [away, home];
    good.root = true;
    games.push({
      against: bad.teamId, swing: good.playoff - bad.playoff,
      game: {
        gameId: g.id, date: when(g), site: g.neutralSite || bad.teamId === g.homeId ? "vs" : "at",
        opponentId: good.teamId, opponent: name(good.teamId), sides: [good, bad],
      },
    });
  });
  games.sort((x, y) => y.swing - x.swing || x.game.gameId - y.game.gameId);
  const kept = games.slice(0, MAX_GAMES);
  const groups = new Map<number, { games: typeof kept; swing: number }>();
  for (const x of kept) {
    const grp = groups.get(x.against) ?? groups.set(x.against, { games: [], swing: 0 }).get(x.against)!;
    grp.games.push(x);
    grp.swing += x.swing;
  }
  const help: HelpGroup[] = [...groups].sort((a, b) => b[1].swing - a[1].swing).slice(0, MAX_GROUPS).map(([id, grp]) => ({
    teamId: id, team: name(id), title: `Root against ${name(id)}`,
    record: formatRecord(teamRecord(season, id, locks), season.teams.find((t) => t.id === id)?.conference ?? null),
    games: grp.games.map((x) => x.game).sort((a, b) => index.get(a.gameId)! - index.get(b.gameId)!),
  }));
  const helpNote = help.length === 0
    ? `No game elsewhere moves ${me}’s playoff odds by more than a point.`
    : help.length === 1
      ? `Every game elsewhere that moves ${me}’s playoff odds by more than a point has one team in it.`
      : `The games elsewhere that move ${me}’s playoff odds by more than a point, by the team to root against.`;
  const quiet = help.length === 0 ? null : `Every other game moves ${me}’s odds by less than a point.`;

  // The title game: the likeliest matchup, and the team's odds in it when it's one of the two.
  let titleWeek: TitleWeek | null = null;
  if (titled && pairs.size > 0) {
    const [key] = [...pairs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const share = (id: number) => national.teams.find((t) => t.teamId === id)?.titleGame ?? 0;
    const [x, y] = key.split("|").map(Number);
    const teams: [number, number] = share(x) >= share(y) ? [x, y] : [y, x];
    let mine: TitleWeek["mine"] = null;
    if (teams.includes(teamId)) {
      let m = 0, won = 0, wonIn = 0, lostIn = 0;
      for (let it = 0; it < n; it++) {
        if (pairOf[it] !== key) continue;
        m++;
        if (champOf[it] === teamId) { won++; wonIn += inField[it]; } else lostIn += inField[it];
      }
      const enough = m >= MIN_MATCHUP;
      const p = enough ? won / m : null;
      mine = {
        opponentId: teams[0] === teamId ? teams[1] : teams[0],
        winChance: p,
        winText: p === null ? "Too few seasons to say" : `${formatOdds(p)} chance if they meet`,
        loseText: p === null ? "Too few seasons to say" : `${formatOdds(1 - p)} chance if they meet`,
        ifWin: won > 0 ? show(wonIn / won) : "—",
        ifLose: m - won > 0 ? show(lostIn / (m - won)) : "—",
      };
    }
    titleWeek = {
      conference: conference!, label: `${conferenceName(conference!)} title game`, teams, key,
      line: `Likeliest matchup: ${name(teams[0])} vs ${name(teams[1])}.`, mine,
      waiting: mine ? null : `${me} gets a pick here once your picks put it in that matchup.`,
    };
  }

  const race = playoffRace(season, national, teamId, fbs, rankHist, champCounts);

  const ownChances = own.map(({ g }): OwnChance => {
    const pHome = gameWinProbability(season, g);
    const p = g.homeId === teamId ? pHome : 1 - pHome;
    return { gameId: g.id, win: `${formatOdds(p)} chance`, lose: `${formatOdds(1 - p)} chance` };
  });
  // The best shot: the likeliest way into the title game as a ladder, each row's odds over the seasons where it and
  // every row above it happen, ending with the title game itself.
  let bestShot: BestShot | null = null;
  if (shotGroups.length > 0) {
    // A power conference's champion gets an automatic bid (`autoBid`, above).
    const pct = (p: number) => (p >= 1 ? "In" : show(p));
    const add = (now: number | null, before: number | null) => {
      if (now === null || before === null) return null;
      const d = Math.round(now * 100) - Math.round(before * 100);
      return d > 0 ? `+${d}` : d < 0 ? `−${-d}` : null;
    };
    const steps: ShotStep[] = [];
    let prevT: number | null = titled ? 0 : null, prevF: number | null = 0;
    const row = (kind: ShotStep["kind"], text: string, detail: string, results: ShotStep["results"], k: number, t: number, f: number) => {
      const enough = k >= MIN_MATCHUP;
      const T = enough && titled ? t / k : null, F = enough ? f / k : null;
      steps.push({
        kind, text, detail, results,
        titleGame: T === null ? "—" : pct(T), playoff: F === null ? "—" : pct(F),
        titleAdd: kind === "today" ? null : add(T, prevT), playoffAdd: kind === "today" ? null : add(F, prevF),
      });
      prevT = T; prevF = F;
    };
    let t0 = 0, f0 = 0;
    for (let it = 0; it < n; it++) { t0 += inTitle[it]; f0 += inField[it]; }
    row("today", "Today", "", [], n, t0, f0);
    shotGroups.forEach((gr, j) => {
      let k = 0, t = 0, f = 0;
      for (let it = 0; it < n; it++) if (reach[it] > j) { k++; t += inTitle[it]; f += inField[it]; }
      row(gr.kind, gr.text, gr.detail, gr.results, k, t, f);
    });
    // The title game, in the seasons the whole way happens: its likeliest opponent there, and how often the team wins.
    let all = 0, played = 0, won = 0, wonIn = 0;
    const opp = new Map<number, number>();
    for (let it = 0; it < n; it++) {
      if (reach[it] < shotGroups.length) continue;
      all++;
      if (!inTitle[it]) continue;
      played++;
      const [a, b] = pairOf[it].split("|").map(Number);
      const o = a === teamId ? b : a;
      opp.set(o, (opp.get(o) ?? 0) + 1);
      if (champ[it]) { won++; wonIn += inField[it]; }
    }
    if (titled && played >= MIN_MATCHUP) {
      const rival = [...opp].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0];
      const F = autoBid ? 1 : won >= MIN_MATCHUP ? wonIn / won : null;
      steps.push({
        kind: "title", text: `${me} wins the title game`, detail: `vs ${name(rival)} · ${formatOdds(won / played)} chance`,
        titleGame: "Won", playoff: F === null ? "—" : pct(F), titleAdd: null, playoffAdd: add(F, prevF), results: [],
      });
    }
    const p = titled && played > 0 ? (all / n) * (won / played) : all / n;
    const often = p >= 0.5 ? `in ${formatOdds(p)} of seasons` : p < 0.01 ? "in fewer than 1 in 100 seasons" : `in about ${oneIn(p)} seasons`;
    const conf = conference !== null ? conferenceName(conference) : "";
    bestShot = {
      title: titled ? `Way into the ${conf} title game` : "Way in",
      sub: `The likeliest results that put ${me} in it. Each row adds to the rows above.`,
      headline: likeliest!.summary,
      columns: ["After", "Title game", "Playoff"],
      steps,
      // A way that leaves a ranking tiebreak to chance says so: it's why the title-game odds stop short of In.
      note: [likeliest!.note ?? "", `All of it happens ${often}.`, autoBid ? "The champion gets a playoff spot." : ""].filter(Boolean).join(" "),
      fill: "Fill in this path", left: "Your picks leave this path.",
    };
  }
  return { recordsNote: "Playoff odds by final record.", records, ways, help, helpNote, quiet, titleWeek, race, own: ownChances, bestShot };
}

function when(g: Game): string {
  return DATE_FORMAT.format(new Date(g.start));
}

/** The race card: the projected field around the page's team. Null when the team isn't ranked or no field can be picked. */
function playoffRace(season: Season, national: NationalResult, teamId: number, fbs: number[], rankHist: Uint32Array, champCounts: Map<string, Map<number, number>>): PlayoffRace | null {
  const n = national.iterations, F = fbs.length;
  const format = playoffFormat(season.year);
  if (F <= format.teams) return null;
  const name = (id: number) => season.teams.find((t) => t.id === id)!.name;
  // Projected final ranking: by median rank over the seasons, then mean rank.
  const mean = new Map(national.teams.map((t) => [t.teamId, t.meanRank]));
  const median = (i: number) => {
    let seen = 0;
    for (let k = 0; k < F; k++) { seen += rankHist[i * F + k]; if (seen * 2 >= n) return k; }
    return F;
  };
  const order = fbs.map((id, i) => ({ id, m: median(i) })).sort((a, b) => a.m - b.m || mean.get(a.id)! - mean.get(b.id)! || a.id - b.id).map((x) => x.id);
  const projected = new Map(order.map((id, k) => [id, k + 1]));
  if (!projected.has(teamId)) return null;
  // The likeliest champion of each power conference.
  const champs = new Map<number, string>();
  for (const [c, m] of champCounts) {
    const best = [...m].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (best) champs.set(best[0], BID_TAGS[c] ?? c);
  }
  const field = national.announced?.seeds ?? fieldPicker(season)(order, (id) => champs.has(id));
  const inField = new Set(field);
  // The automatic bids the field holds, and the last at-large team (the cut line goes under it).
  const conf = new Map(season.teams.map((t) => [t.id, t]));
  const power = new Set(powerConferences(season.year));
  const groupOfSix = (id: number) => {
    const t = conf.get(id)!;
    return t.classification === "fbs" && t.conference !== null && t.conference !== INDEPENDENTS && !power.has(t.conference);
  };
  const tags = new Map<number, string>();
  if (format.autoBids === "power4G6") {
    for (const id of field) if (champs.has(id)) tags.set(id, champs.get(id)!);
    const g6 = order.find((id) => inField.has(id) && !tags.has(id) && groupOfSix(id));
    if (g6 !== undefined) tags.set(g6, "G6");
    const nd = field.find((id) => conf.get(id)!.name === "Notre Dame" && projected.get(id)! <= 12);
    if (nd !== undefined) tags.set(nd, "ND");
  }
  const atLarge = field.filter((id) => !tags.has(id));
  const last = atLarge.length > 0 && tags.size > 0 ? atLarge.reduce((a, b) => (projected.get(a)! > projected.get(b)! ? a : b)) : field.at(-1)!;
  const lastRank = projected.get(last)!;
  // Notre Dame keeps its tag only when the top-12 rule is what gets it in: ranked below the last at-large team.
  for (const [id, tag] of tags) if (tag === "ND" && projected.get(id)! < lastRank) tags.delete(id);
  const odds = new Map(national.teams.map((t) => [t.teamId, t.playoff?.field ?? 0]));
  const row = (id: number): RaceRow => {
    const seed = field.indexOf(id) + 1 || null;
    const p = odds.get(id) ?? 0;
    return {
      kind: "team", teamId: id, team: name(id), seed, projected: projected.get(id)!, tag: tags.get(id) ?? null,
      under: seed !== null && tags.has(id) && projected.get(id)! > lastRank, field: p, text: formatOdds(p), me: id === teamId,
    };
  };
  // Every team in card order: the field by seed, then the teams out by projected rank. `above`: rows above the cut.
  const rows = [...field, ...order.filter((id) => !inField.has(id))].map(row);
  const above = field.findIndex((id) => id === last) + 1;
  const at = rows.findIndex((r) => r.me);
  const show = new Set<number>();
  if (at < above - AROUND) {
    const lo = Math.max(0, Math.min(at - AROUND, above - 2 * AROUND - 1));
    for (let k = lo; k <= lo + 2 * AROUND; k++) show.add(k);
  } else {
    show.add(above - 2).add(above - 1);
    for (let k = above; k < field.length; k++) show.add(k);
    const firstOut = field.length;
    const outs = at >= firstOut && at - firstOut < NEAR_OUT ? Math.max(FIRST_OUT, at - firstOut + 1) : FIRST_OUT;
    for (let k = firstOut; k < Math.min(rows.length, firstOut + outs); k++) show.add(k);
    show.add(at);
  }
  const cutLabel = format.autoBids === "none" ? "Last spot in" : "Last at-large";
  const items: RaceItem[] = [];
  let prev = -1;
  for (const k of [...show].filter((k) => k >= 0 && k < rows.length).sort((a, b) => a - b)) {
    if (prev >= 0) {
      if (format.teams === 12 && prev < 4 && k >= 4) items.push({ kind: "bye", label: "First-round byes" });
      if (prev < above && k >= above) items.push({ kind: "cut", label: cutLabel });
      if (k > prev + 1) items.push({ kind: "gap" });
      if (prev < field.length && k >= field.length) items.push({ kind: "next", label: "Next in line" });
    }
    items.push(rows[k]);
    prev = k;
  }
  const race = { g6: null, title: null, items, note: "Projected seeds and final ranking", columns: ["Seed", "Team", "Proj.", "Field"] };
  if (format.autoBids !== "power4G6" || !groupOfSix(teamId)) return race;
  // A Group of Six page: its race is for the bid. The first few Group of Six teams, then the page's team if further down.
  const g6s = order.filter(groupOfSix);
  const mine = g6s.indexOf(teamId);
  const listed = mine < G6_SHOWN ? g6s.slice(0, G6_SHOWN) : [...g6s.slice(0, G6_SHOWN - 1), null, teamId];
  const g6Items: RaceItem[] = [];
  listed.forEach((id, k) => {
    g6Items.push(id === null ? { kind: "gap" } : row(id));
    if (k === 0 && listed.length > 1) g6Items.push({ kind: "bid", label: "Top G6 gets the bid" });
  });
  // The at-large line under it: the last team in at large and the first team out, unless already listed above.
  const firstOut = order.find((id) => !inField.has(id));
  const line: RaceItem[] = [];
  if (!listed.includes(last)) line.push(row(last));
  line.push({ kind: "cut", label: cutLabel });
  if (firstOut !== undefined && !listed.includes(firstOut)) line.push(row(firstOut));
  return { ...race, g6: { title: "Group of Six bid", items: g6Items }, title: "At-large line", items: line };
}
