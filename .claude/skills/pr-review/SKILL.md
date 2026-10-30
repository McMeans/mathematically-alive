---
name: pr-review
description: Review a Mathematically Alive change the way a PR reviewer would — the current branch against main, or a GitHub PR number — for correctness, black-box test coverage of new behavior, and project-specific risks. Use when asked to review a PR, branch, or diff. Pass --post to post the review as a PR comment.
---

# Mathematically Alive PR review

## 1. Get the diff

- No argument: `git fetch origin main`, then `git diff origin/main...HEAD` plus `git log --oneline origin/main..HEAD`. Use `origin/main`, not local `main`, which may be stale. Include uncommitted changes (`git diff HEAD`) if any.
- A PR number: `gh pr view <n>` and `gh pr diff <n>`.

Read every changed file in full around each hunk, not only the hunk itself.

## 2. Check

Rank by severity. Only report things you can point at a line for.

**Correctness (`src/core`)**
- Simulation: completed games changed by a what-if (the past is never changed), locked results ignored, wrong home/away or spread sign, probabilities outside [0, 1] or not summing to 1.
- Randomness: sims must be reproducible from a seed; no `Math.random()` in core.
- Tiebreakers: wrong order of steps, head-to-head across 3+ teams, ties among teams that didn't all play each other, divisions vs. no divisions.
- Paths: "needs" lists that contradict the sim, impact ordering, pruning that drops a team's only path.
- Data: CollegeFootballData field mapping, neutral sites, FCS opponents, canceled/postponed games, time zones on game dates.

**App (`src/app`)**
- Heavy sims blocking the main thread (should run in a worker), URL scenario encoding that doesn't round-trip.
- Server code leaking the CFBD API key to the client; the key is server/build-time only.
- User-facing wording for paths and odds should come from `src/core`, not inline, so tests can check it.

**Tests (from CLAUDE.md)**
- New or changed public behavior in `src/core` without a test in `tests/blackbox`: flag it.
- A black-box test importing anything but `@/core`, mocking internals, or asserting on private state: flag it.
- Something exported only so a test could reach it: flag it.
- Run `.claude/skills/coverage-gate/gate.sh` and include the result.

## 3. Output

```
## Review: <branch or PR #>
Gate: <pass/fail, NN.N%>

1. [high|medium|low] path/to/file.ts:LINE — what's wrong. Failure: concrete input → wrong result.
...

No issues found in: <areas checked clean>
```

Keep it to real findings. No style nits unless they hide a bug.

## 4. Posting

Only with `--post` and a PR number: `gh pr comment <n> --body-file <review.md>`. Without `--post`, print the review only.
