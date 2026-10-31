"use client";
import type { PathTree, TreeNode } from "@/core";
import { oddsTone, pct, type Locks } from "./Explorer";

type Ctx = {
  locks: Locks;
  teamId: number;
  oppOf: (gameId: number) => number;
  onPick: (gameId: number, winner: number | undefined) => void;
};

const winnerOf = (n: TreeNode, c: Ctx) => (n.win ? c.teamId : c.oppOf(n.gameId!));

function Branch({ node, ctx, off }: { node: TreeNode; ctx: Ctx; off: boolean }) {
  const leaf = node.children.length === 0;
  const root = node.gameId === undefined;
  return (
    <div className="branch">
      {root ? (
        <div className="rounded-full bg-navy px-4 py-2 text-white">
          <span className="text-sm font-bold">{node.label}</span>{" "}
          <span className="font-display text-xl">{pct(node.odds)}</span>
        </div>
      ) : (
        <NodePill node={node} ctx={ctx} off={off} leaf={leaf} />
      )}
      {!leaf && (
        <div className={`kids ${node.likely ? "likely" : ""}`}>
          {node.children.map((c) => {
            const contradicted = c.gameId !== undefined && ctx.locks[c.gameId] !== undefined && ctx.locks[c.gameId] !== winnerOf(c, ctx);
            return (
              <div key={c.label} className={`kid ${c.likely ? "likely" : ""}`}>
                <Branch node={c} ctx={ctx} off={off || contradicted} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NodePill({ node, ctx, off, leaf }: { node: TreeNode; ctx: Ctx; off: boolean; leaf: boolean }) {
  const locked = ctx.locks[node.gameId!] === winnerOf(node, ctx);
  const border = node.likely ? "border-2 border-turf" : "border border-ink-muted/40";
  return (
    <button
      type="button"
      disabled={off}
      aria-pressed={locked}
      aria-label={`${node.label}, ${node.detail}${node.record ? `, ${node.record}` : ""}, ${pct(node.odds)}`}
      onClick={() => ctx.onPick(node.gameId!, winnerOf(node, ctx))}
      className={`${border} group text-left transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-navy aria-pressed:text-white ${
        leaf ? "flex items-baseline gap-2 whitespace-nowrap rounded-full px-3 py-1.5" : "w-44 rounded-xl px-3 py-2 hover:bg-mist aria-pressed:hover:bg-navy"
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
      <span
        aria-hidden
        className={`font-display font-bold group-aria-pressed:text-white ${leaf ? "text-base" : "block text-2xl"} ${oddsTone(node.odds)}`}
      >
        {pct(node.odds)}
      </span>
    </button>
  );
}

export function TreeView({ tree, locks, teamId, oppOf, onPick }: { tree: PathTree } & Ctx) {
  const ctx = { locks, teamId, oppOf, onPick };
  return (
    <div>
      <div className="tree overflow-x-auto py-4">
        <div className="inline-block min-w-max pr-2">
          <Branch node={tree.root} ctx={ctx} off={false} />
        </div>
      </div>
      <p className="flex items-center gap-2 text-xs text-ink-muted">
        <span aria-hidden className="inline-block h-0.5 w-6 bg-turf" /> Most likely path
      </p>
    </div>
  );
}

/** Mobile: walk the locked choices from the root, then offer the next undecided game. */
export function Drill({ tree, locks, teamId, oppOf, onPick, onUnlock }: { tree: PathTree; onUnlock: (gameIds: number[]) => void } & Ctx) {
  const ctx = { locks, teamId, oppOf, onPick };
  const crumbs: TreeNode[] = [tree.root];
  for (let cur = tree.root; ; ) {
    const next = cur.children.find((c) => locks[c.gameId!] === winnerOf(c, ctx));
    if (!next) break;
    crumbs.push(next);
    cur = next;
  }
  const current = crumbs[crumbs.length - 1];
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
                  {c.label} <span className={oddsTone(c.odds)}>{pct(c.odds)}</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onUnlock(crumbs.slice(i + 1).map((n) => n.gameId!))}
                  className="min-h-11 text-ink-soft underline"
                >
                  {c.label} {pct(c.odds)}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {current.children.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">
          {crumbs.length > 1 ? `Final record ${current.record ?? "—"}` : "No games left to play."}
        </p>
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
                className={`min-h-11 rounded-xl bg-mist p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${c.likely ? "border-2 border-turf" : "border border-ink-muted/40"}`}
              >
                <span className="block text-sm font-bold">{c.label}</span>
                <span className="block text-xs text-ink-muted">{c.detail}</span>
                <span className={`block font-display text-3xl font-bold ${oddsTone(c.odds)}`}>{pct(c.odds)}</span>
              </button>
            ))}
          </div>
          {current.children[0].children.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-muted">Then</h3>
              <ul className="mt-1 divide-y divide-ink-muted/20 text-sm">
                {current.children.flatMap((c) =>
                  c.children.map((g) => (
                    <li key={`${c.label}/${g.label}`} className="flex justify-between gap-2 py-2">
                      <span className="text-ink-soft">
                        {c.win ? "Win" : "Loss"}, {g.label.charAt(0).toLowerCase() + g.label.slice(1)}
                      </span>
                      <span className={`font-bold tabular-nums ${oddsTone(g.odds)}`}>{pct(g.odds)}</span>
                    </li>
                  )),
                )}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
