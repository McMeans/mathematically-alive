// Fit how results move a team from the committee's latest ranking (src/core/live.ts), and write the weights to
// src/core/movement-weights.ts. Usage: pnpm fit-movement. Reads fixtures/cfp-<year>.json; no API calls.
//
// For every pair of committee rankings in a season (an earlier one and any later one, the final included), each FBS
// team's score in the later ranking is modelled as
//   anchor * A + wins * dW + losses * dL + g6Wins * dW(G6 only) + upset * dU + champion * dC
// where A is its anchored score in the earlier ranking (the stand-in's score at the place the committee put it),
// dW/dL its wins and losses since, dU how surprising those results were (a win adds the chance it had of losing, a
// loss takes off the chance it had of winning) and dC whether it has since won a power conference's title game.
// Fitted by maximum likelihood on the pairs the later ranking states (as fit-committee.ts does), each ranking pair
// weighted equally, so the noise the simulation adds (standard Gumbel) gives the same pair odds.
// Prints how often each model orders the later top 25's pairs like the committee did, one week ahead and to the final.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { committeeRanking, gameWinProbability, seasonFromCfbd, type CfbdSnapshot } from "../src/core";
import { powerConferences, titleGameIndex } from "../src/core/committee";
import { powerTeam as isPower } from "../src/core/live";

type Fixture = { snapshot: CfbdSnapshot; rankings: { week: number; ranks: { rank: number; teamId: number }[] }[] };
const KEYS = ["anchor", "wins", "losses", "g6Wins", "upset", "champion"] as const;
const RIDGE = 0.01;

type Case = { ids: number[]; x: Map<number, number[]>; target: number[]; horizon: "next" | "final" | "other"; anchorOrder: number[] };

function cases(): Case[] {
  const out: Case[] = [];
  for (const file of readdirSync("fixtures").filter((f) => /^cfp-\d{4}\.json$/.test(f)).sort()) {
    const fx = JSON.parse(readFileSync(path.join("fixtures", file), "utf8")) as Fixture;
    const season = seasonFromCfbd(fx.snapshot);
    if (fx.rankings.length < 2 || season.year >= 2026) continue;
    const fbs = season.teams.filter((t) => t.classification === "fbs").map((t) => t.id);
    const power = new Map(fbs.map((id) => [id, isPower(season, id)]));
    const prob = season.games.map((g) => gameWinProbability(season, g));
    const titleGames = new Set(powerConferences(season.year).map((c) =>
      titleGameIndex(season, new Set(season.teams.filter((t) => t.conference === c).map((t) => t.id)))).filter((i) => i >= 0));
    const last = fx.rankings.length - 1;
    for (let r = 0; r < last; r++) {
      const cur = fx.rankings[r];
      // Anchored score: the stand-in's score at the place the committee (then the stand-in, below its 25) put the team.
      const stand = committeeRanking(season, { throughWeek: cur.week - 1 });
      const ranked = cur.ranks.map((x) => x.teamId).filter((id) => power.has(id));
      const inR = new Set(ranked);
      const anchorOrder = [...ranked, ...stand.map((t) => t.teamId).filter((id) => !inR.has(id))];
      const anchorScore = new Map(anchorOrder.map((id, p) => [id, stand[p].score]));
      for (let q = r + 1; q <= last; q++) {
        const nxt = fx.rankings[q];
        const x = new Map(fbs.map((id) => [id, [anchorScore.get(id) ?? 0, 0, 0, 0, 0, 0]]));
        season.games.forEach((g, i) => {
          if (!g.completed || g.week < cur.week || g.week >= nxt.week) return;
          const homeWon = g.homePoints! > g.awayPoints!;
          const [w, l] = homeWon ? [g.homeId, g.awayId] : [g.awayId, g.homeId];
          const pw = homeWon ? prob[i] : 1 - prob[i];
          const xw = x.get(w), xl = x.get(l);
          if (xw) { xw[1]++; if (!power.get(w)) xw[3]++; xw[4] += 1 - pw; if (titleGames.has(i)) xw[5] = 1; }
          if (xl) { xl[2]++; xl[4] -= pw; }
        });
        out.push({ ids: fbs, x, target: nxt.ranks.map((t) => t.teamId).filter((id) => power.has(id)), horizon: q === r + 1 ? "next" : q === last ? "final" : "other", anchorOrder });
      }
    }
  }
  return out;
}

function fit(all: Case[]): number[] {
  const groups = all.map((c) => {
    const inT = new Set(c.target);
    // Unranked teams: the ones that could plausibly be ranked (the anchor's top 40), to keep the fit about the top.
    const unranked = c.anchorOrder.slice(0, 40).filter((id) => !inT.has(id));
    const diffs: number[][] = [];
    const d = (a: number, b: number) => c.x.get(a)!.map((v, k) => v - c.x.get(b)![k]);
    c.target.forEach((a, i) => {
      for (const b of c.target.slice(i + 1)) diffs.push(d(a, b));
      for (const b of unranked) diffs.push(d(a, b));
    });
    return diffs;
  });
  const n = KEYS.length;
  let w = new Array<number>(n).fill(0);
  for (let iter = 0; iter < 60; iter++) {
    const grad = w.map((x) => -RIDGE * x);
    const hess = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? -RIDGE : 0)));
    for (const diffs of groups) {
      const s = 1 / diffs.length;
      for (const dd of diffs) {
        const p = 1 / (1 + Math.exp(-dd.reduce((acc, v, k) => acc + v * w[k], 0)));
        for (let i = 0; i < n; i++) {
          grad[i] += s * (1 - p) * dd[i];
          for (let j = 0; j < n; j++) hess[i][j] -= s * p * (1 - p) * dd[i] * dd[j];
        }
      }
    }
    const step = solve(hess, grad.map((g) => -g));
    w = w.map((v, k) => v + step[k]);
    if (Math.max(...step.map(Math.abs)) < 1e-10) break;
  }
  return w;
}

/** Share of the target top 25's pairs a model's order agrees with. */
function agreement(all: Case[], horizon: Case["horizon"], order: (c: Case) => number[]): number {
  let sum = 0, n = 0;
  for (const c of all.filter((x) => x.horizon === horizon)) {
    const pos = new Map(order(c).map((id, k) => [id, k]));
    let a = 0, m = 0;
    for (let i = 0; i < c.target.length; i++) for (let j = i + 1; j < c.target.length; j++) {
      m++;
      if ((pos.get(c.target[i]) ?? 1e9) < (pos.get(c.target[j]) ?? 1e9)) a++;
    }
    sum += a / m; n++;
  }
  return sum / n;
}

function main() {
  const all = cases();
  const w = fit(all);
  const byScore = (wt: number[]) => (c: Case) => [...c.ids].sort((a, b) =>
    c.x.get(b)!.reduce((s, v, k) => s + v * wt[k], 0) - c.x.get(a)!.reduce((s, v, k) => s + v * wt[k], 0));
  const old = [1, 0.9529, -1.419, 0, 3 * 0.1225, 0.744]; // the earlier live ranking: stand-in weights, RESULT_POINTS 3
  for (const h of ["next", "final"] as const) {
    console.log(`${h}: no change ${(agreement(all, h, (c) => c.anchorOrder) * 100).toFixed(1)}%  earlier ${(agreement(all, h, byScore(old)) * 100).toFixed(1)}%  fitted ${(agreement(all, h, byScore(w)) * 100).toFixed(1)}%`);
  }
  const weights = Object.fromEntries(KEYS.map((k, i) => [k, Number(w[i].toPrecision(4))]));
  const out = path.join("src", "core", "movement-weights.ts");
  writeFileSync(out, `// Generated by scripts/fit-movement.ts (pnpm fit-movement) from fixtures/cfp-<year>.json. Do not hand-edit.
export const MOVEMENT_WEIGHTS = ${JSON.stringify(weights).replace(/"/g, "").replace(/,/g, ", ").replace(/:/g, ": ").replace(/^\{/, "{ ").replace(/\}$/, " }")};
`);
  console.log(`${out}: ${JSON.stringify(weights)} from ${all.length} ranking pairs`);
}

function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = c + 1; r < n; r++) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x;
}

main();
