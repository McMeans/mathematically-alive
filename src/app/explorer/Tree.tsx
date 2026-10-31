"use client";
import { useState } from "react";
import type { PathTree, TreeNode } from "@/core";
import { oddsTone, type Locks } from "./Explorer";

type Ctx = {
  locks: Locks;
  /** "gameId:winner" picks of the likeliest way in, to highlight. */
  way?: Set<string>;
  teamId: number;
  oppOf: (gameId: number) => number;
  onPick: (gameId: number, winner: number | undefined) => void;
};

const winnerOf = (n: TreeNode, c: Ctx) => (n.win ? c.teamId : c.oppOf(n.gameId!));
const isLocked = (n: TreeNode, c: Ctx) => n.gameId !== undefined && c.locks[n.gameId] === winnerOf(n, c);

/** Verdict color: settled In/Out in turf/orange, rare and ruled-out muted, open odds by size. */
const verdictTone = (n: TreeNode) =>
  n.outcome === "in" ? "text-turf" : n.outcome === "out" ? "text-marker-text" : n.outcome ? "text-ink-muted" : oddsTone(n.odds);

const countLeaves = (n: TreeNode): number => (n.children.length ? n.children.reduce((a, c) => a + countLeaves(c), 0) : 1);

type View = Ctx & {
  isOpen: (key: string, n: TreeNode, level: number) => boolean;
  /** True when the user opened this branch (so it gets a collapse control). */
  userOpened: (key: string) => boolean;
  toggle: (key: string, n: TreeNode, level: number) => void;
};

const onWay = (n: TreeNode, c: Ctx) => n.gameId !== undefined && !!c.way?.has(`${n.gameId}:${winnerOf(n, c)}`);

function Branch({ node, ctx, off, path, level, way }: { node: TreeNode; ctx: View; off: boolean; path: string; level: number; way: boolean }) {
  const hasKids = node.children.length > 0;
  const root = node.gameId === undefined;
  const open = hasKids && ctx.isOpen(path, node, level);
  const toggle = (label: string, expanded: boolean) => (
    <button
      type="button"
      onClick={() => ctx.toggle(path, node, level)}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Hide" : "Show"} what follows ${node.label}`}
      className="ml-2 min-h-11 shrink-0 whitespace-nowrap rounded-full border border-dashed border-ink-muted/60 px-3 text-xs font-bold text-ink-soft hover:bg-mist focus-visible:outline-2 focus-visible:outline-navy md:min-h-8"
    >
      {label}
    </button>
  );
  return (
    <div className="branch">
      {root ? (
        <div className="rounded-full bg-navy px-4 py-2 text-white" title={node.note ?? undefined}>
          <span className="text-sm font-bold">{node.label}</span>{" "}
          <span className="font-display text-xl">{node.verdict}</span>
        </div>
      ) : (
        <NodePill node={node} ctx={ctx} off={off} leaf={!hasKids} way={way} />
      )}
      {hasKids && !open && toggle(`+ ${countLeaves(node)} outcomes`, false)}
      {open && !root && ctx.userOpened(path) && toggle("−", true)}
      {open && (
        <div className={`kids ${node.likely ? "likely" : ""}`}>
          {node.children.map((c) => {
            // A branch the current lock rules out stays clickable: clicking it switches the lock.
            const key = path + (c.win ? "W" : "L");
            return (
              <div key={key} className={`kid ${c.likely ? "likely" : ""}`}>
                <Branch node={c} ctx={ctx} off={off} path={key} level={level + 1} way={way && onWay(c, ctx)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NodePill({ node, ctx, off, leaf, way }: { node: TreeNode; ctx: Ctx; off: boolean; leaf: boolean; way: boolean }) {
  const locked = isLocked(node, ctx);
  const border = (node.likely ? "border-2 border-turf" : "border border-ink-muted/40") + (way ? " ring-2 ring-marker ring-offset-1" : "");
  const extra = [node.record, node.note].filter(Boolean).join(". ");
  return (
    <button
      type="button"
      disabled={off}
      aria-pressed={locked}
      title={node.note ?? undefined}
      aria-label={`${node.label}, ${node.detail}, ${node.verdict}${extra ? `. ${extra}` : ""}`}
      onClick={() => ctx.onPick(node.gameId!, winnerOf(node, ctx))}
      className={`${border} group text-left transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-navy aria-pressed:text-white ${
        leaf ? "flex w-44 items-baseline justify-between gap-2 rounded-xl px-3 py-1.5 hover:bg-mist aria-pressed:hover:bg-navy" : "w-44 rounded-xl px-3 py-2 hover:bg-mist aria-pressed:hover:bg-navy"
      } bg-white`}
    >
      <span className={`text-sm font-bold ${leaf ? "" : "block"}`} aria-hidden>
        {node.label}
        {leaf && node.record ? <span className="font-normal"> · {node.record}</span> : null}
      </span>
      {!leaf && (
        <span className="block text-xs text-ink-muted group-aria-pressed:text-white" aria-hidden>
          {node.detail}
        </span>
      )}
      <span aria-hidden className={`font-display font-bold group-aria-pressed:text-white ${leaf ? "text-base" : "block text-2xl"} ${verdictTone(node)}`}>
        {node.verdict}
      </span>
    </button>
  );
}

export function TreeView({ tree, locks, way, teamId, oppOf, onPick }: { tree: PathTree } & Ctx) {
  // Open by default: the first two levels, the most likely path and the locked path. Clicks override.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const base: Ctx = { locks, way, teamId, oppOf, onPick };
  const byDefault = (n: TreeNode, level: number) =>
    level < 2 || n.likely || n.children.some((c) => isLocked(c, base) || (!!way && onWay(c, base)));
  const ctx: View = {
    ...base,
    isOpen: (key, n, level) => toggled[key] ?? byDefault(n, level),
    userOpened: (key) => toggled[key] === true,
    toggle: (key, n, level) => setToggled((t) => ({ ...t, [key]: !(t[key] ?? byDefault(n, level)) })),
  };
  return (
    <div>
      <div className="tree -mx-4 overflow-x-auto px-4 py-4 md:-mx-6 md:px-6">
        <div className="inline-block min-w-max">
          <Branch node={tree.root} ctx={ctx} off={false} path="" level={0} way={!!way} />
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-0.5 w-6 bg-turf" /> Most likely path
        </span>
      </p>
      {tree.footnote && <p className="mt-2 text-xs text-ink-muted">{tree.footnote}</p>}
    </div>
  );
}

/** Mobile: walk the locked choices from the root, then offer the next undecided game. */
export function Drill({ tree, locks, teamId, oppOf, onPick, onUnlock }: { tree: PathTree; onUnlock: (gameIds: number[]) => void } & Ctx) {
  const ctx = { locks, teamId, oppOf, onPick };
  const crumbs: TreeNode[] = [tree.root];
  for (let cur = tree.root; ; ) {
    const next = cur.children.find((c) => isLocked(c, ctx));
    if (!next) break;
    crumbs.push(next);
    cur = next;
  }
  const current = crumbs[crumbs.length - 1];
  const end = current.note ?? (current.record ? `Final record ${current.record}.` : crumbs.length === 1 ? "No conference games left to play." : "");
  return (
    <div className="mt-3">
      <ol className="flex flex-wrap items-center gap-x-1 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={i} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden className="text-ink-muted">›</span>}
              {last ? (
                <span aria-current="step" className="py-2 font-bold">
                  {c.label} <span className={verdictTone(c)}>{c.verdict}</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onUnlock(crumbs.slice(i + 1).map((n) => n.gameId!))}
                  className="min-h-11 text-ink-soft underline"
                >
                  {c.label} {c.verdict}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {current.children.length === 0 ? (
        end && <p className="mt-3 text-sm text-ink-muted">{end}</p>
      ) : (
        <>
          <p className="mt-2 text-xs text-ink-muted">
            {current.children[0].detail.split(" · ")[0]} · {current.children[0].label.replace(/^Beat /, "vs ")}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {current.children.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => onPick(c.gameId!, winnerOf(c, ctx))}
                className={`min-h-11 rounded-xl bg-mist p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-40 ${c.likely ? "border-2 border-turf" : "border border-ink-muted/40"}`}
              >
                <span className="block text-sm font-bold">{c.label}</span>
                <span className="block text-xs text-ink-muted">{c.detail}</span>
                <span className={`block font-display text-3xl font-bold ${verdictTone(c)}`}>{c.verdict}</span>
                {c.note && c.outcome !== "never" && <span className="mt-1 block text-xs text-ink-muted">{c.note}</span>}
              </button>
            ))}
          </div>
          {current.children.some((c) => c.children.length > 0) && (
            <div className="mt-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-muted">Then</h3>
              <ul className="mt-1 divide-y divide-ink-muted/20 text-sm">
                {current.children.flatMap((c) =>
                  c.children.map((g) => (
                    <li key={`${c.label}/${g.label}`} className="flex justify-between gap-2 py-2">
                      <span className="text-ink-soft">
                        {c.win ? "Win" : "Loss"}, {g.label.charAt(0).toLowerCase() + g.label.slice(1)}
                      </span>
                      <span className={`font-bold tabular-nums ${verdictTone(g)}`}>{g.verdict}</span>
                    </li>
                  )),
                )}
              </ul>
            </div>
          )}
        </>
      )}
      {tree.footnote && <p className="mt-3 text-xs text-ink-muted">{tree.footnote}</p>}
    </div>
  );
}
