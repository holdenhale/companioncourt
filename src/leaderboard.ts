// Leaderboard (Task 10) — rolls per-subject RunResults up into ranked rows and renders the public docket
// page. Rank discipline is launch-gate #2: rows sort by presence win-rate, but a row only takes a NEW
// rank when its presence Wilson 95% CI does not overlap the previous rank-group's interval — where CIs
// overlap, the rows share a rank (no rank claims where the intervals don't separate). The rendered page
// is one self-contained static HTML document: inline CSS only, light/dark via prefers-color-scheme, no
// scripts, no external assets — diagnostic-report framing, not "best companion" marketing.

import { wilson95 } from "./util.js";
import { aggregateRuns } from "./scoring.js";
import type { Dim, RunResult } from "./types.js";

export type DimCell = { rate: number; wins: number; n: number; ci: { lo: number; hi: number } };

export type LeaderboardRow = {
  rank: number;                  // shared across rows whose presence CIs overlap
  subject: string;               // model name (the runsBySubject key)
  nRuns: number;
  presence: DimCell;             // the ranking dimension
  otherDims: Partial<Record<Exclude<Dim, "presence">, DimCell>>;
  integrity: "RED" | "ok";       // RED iff aggregateRuns flags any must-hold veto
  cavingTurnMedian?: number;
  disputedRate: number;
  inconclusiveCount: number;
};

export type Leaderboard = {
  benchVersion: string;
  corpusVersion: string;
  corpusHash: string;
  rows: readonly LeaderboardRow[];
};

const OTHER_DIMS: readonly Exclude<Dim, "presence">[] = ["memory_continuity", "moment_fit"];

function toCell(rec: { wins: number; n: number; ci: { lo: number; hi: number } } | undefined): DimCell {
  if (!rec) return { rate: 0, wins: 0, n: 0, ci: wilson95(0, 0) };
  return { rate: rec.n > 0 ? rec.wins / rec.n : 0, wins: rec.wins, n: rec.n, ci: rec.ci };
}

/**
 * Aggregates each subject's runs (via aggregateRuns) into one row, sorts by presence win-rate descending
 * (subject name breaks exact-rate ties deterministically), then assigns ranks under the CI-overlap
 * discipline: the rank increments only when the next row's presence CI does NOT overlap the previous
 * rank-group's interval (the running union of its members' CIs). All runs must share one corpusHash —
 * a board spanning corpora would compare incomparable dockets, so that throws.
 */
export function buildLeaderboard(
  runsBySubject: ReadonlyMap<string, readonly RunResult[]>,
  mustHoldCaseIds: ReadonlySet<string>
): Leaderboard {
  const allRuns = [...runsBySubject.values()].flat();
  const first = allRuns[0];
  if (!first) throw new Error("leaderboard requires at least one run");
  for (const run of allRuns) {
    if (run.manifest.corpusHash !== first.manifest.corpusHash) {
      throw new Error("leaderboard runs span different corpus hashes");
    }
  }

  const unranked: Omit<LeaderboardRow, "rank">[] = [...runsBySubject.entries()].map(([subject, runs]) => {
    const summary = aggregateRuns(runs, mustHoldCaseIds);
    const otherDims: Partial<Record<Exclude<Dim, "presence">, DimCell>> = {};
    for (const dim of OTHER_DIMS) {
      const rec = summary.dimWinRates[dim];
      if (rec) otherDims[dim] = toCell(rec);
    }
    return {
      subject,
      nRuns: runs.length,
      presence: toCell(summary.dimWinRates.presence),
      otherDims,
      integrity: summary.integrityRed ? "RED" : "ok",
      ...(summary.cavingTurnMedian !== undefined ? { cavingTurnMedian: summary.cavingTurnMedian } : {}),
      disputedRate: summary.disputedRate,
      inconclusiveCount: summary.inconclusiveCount
    };
  });

  // codepoint order, not localeCompare — the tie-break must not vary with the regenerating machine's locale
  unranked.sort((a, b) => b.presence.rate - a.presence.rate || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));

  const rows: LeaderboardRow[] = [];
  let rank = 0;
  let groupLo = Number.POSITIVE_INFINITY;
  let groupHi = Number.NEGATIVE_INFINITY;
  for (const row of unranked) {
    const { lo, hi } = row.presence.ci;
    const overlaps = rows.length > 0 && hi >= groupLo && lo <= groupHi;
    if (overlaps) {
      groupLo = Math.min(groupLo, lo);
      groupHi = Math.max(groupHi, hi);
    } else {
      rank += 1;
      groupLo = lo;
      groupHi = hi;
    }
    rows.push({ rank, ...row });
  }

  return {
    benchVersion: first.manifest.benchVersion,
    corpusVersion: first.manifest.corpusVersion,
    corpusHash: first.manifest.corpusHash,
    rows
  };
}

// —— static page ——

function escapeHtml(s: string): string {
  return s
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

function dimCellHtml(cell: DimCell | undefined): string {
  if (!cell || cell.n === 0) return `<td class="num muted">—</td>`;
  return `<td class="num">${pct(cell.rate)} <span class="ci">(${pct(cell.ci.lo)}–${pct(cell.ci.hi)})</span></td>`;
}

const PAGE_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 2rem auto; max-width: 72rem; padding: 0 1rem; background: #fdfdfc; color: #1d1d1f;
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
  p.meta { margin: 0 0 1.5rem; color: #6a6a6e; font-size: 0.9rem; }
  .tablewrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
  th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #d9d9d4; white-space: nowrap; }
  th { font-weight: 600; border-bottom: 2px solid #b5b5ae; }
  td.num { font-variant-numeric: tabular-nums; }
  .ci { color: #6a6a6e; font-size: 0.85em; }
  .muted { color: #9a9a9e; }
  .badge { display: inline-block; padding: 0.05rem 0.5rem; border-radius: 0.6rem; font-size: 0.8em; font-weight: 700; }
  .badge.red { background: #b3261e; color: #ffffff; }
  .badge.ok { background: #e6e6e1; color: #3a3a3e; }
  footer { margin-top: 1.5rem; color: #6a6a6e; font-size: 0.85rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #161618; color: #e8e8ea; }
    p.meta, .ci, footer { color: #9a9aa0; }
    .muted { color: #6a6a70; }
    th, td { border-bottom-color: #38383c; }
    th { border-bottom-color: #55555a; }
    .badge.red { background: #d93a30; }
    .badge.ok { background: #333338; color: #c4c4c8; }
  }
`;

/**
 * Renders the board as ONE self-contained static HTML page (inline CSS, no scripts, no external assets).
 * Headline is docket/diagnostic framing — this is a diagnostic report, not a "best companion" claim.
 */
export function renderHtml(board: Leaderboard): string {
  const rowsHtml = board.rows
    .map((row) => {
      const integrityBadge =
        row.integrity === "RED"
          ? `<span class="badge red">RED</span>`
          : `<span class="badge ok">ok</span>`;
      return [
        `      <tr>`,
        `        <td class="num">${row.rank}</td>`,
        `        <td>${escapeHtml(row.subject)}</td>`,
        `        <td class="num">${row.nRuns}</td>`,
        `        ${dimCellHtml(row.presence)}`,
        `        ${dimCellHtml(row.otherDims.memory_continuity)}`,
        `        ${dimCellHtml(row.otherDims.moment_fit)}`,
        `        <td>${integrityBadge}</td>`,
        `        <td class="num">${row.cavingTurnMedian !== undefined ? row.cavingTurnMedian : `<span class="muted">—</span>`}</td>`,
        `        <td class="num">${pct(row.disputedRate)}</td>`,
        `        <td class="num">${row.inconclusiveCount}</td>`,
        `      </tr>`
      ].join("\n");
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CompanionCourt — public docket results</title>
<style>${PAGE_CSS}</style>
</head>
<body>
  <h1>CompanionCourt — public docket results</h1>
  <p class="meta">Diagnostic report over anchored dyad verdicts · corpus ${escapeHtml(board.corpusVersion)}
    (hash ${escapeHtml(board.corpusHash)}) · bench v${escapeHtml(board.benchVersion)}</p>
  <div class="tablewrap">
    <table>
      <thead>
        <tr>
          <th>Rank</th><th>Model</th><th>Runs</th><th>Presence Win-Rate (95% CI)</th>
          <th>Memory Continuity</th><th>Moment Fit</th><th>Integrity</th><th>Caving Turn</th>
          <th>Disputed</th><th>Inconclusive</th>
        </tr>
      </thead>
      <tbody>
${rowsHtml}
      </tbody>
    </table>
  </div>
  <footer>Rank discipline: ranks tie when 95% CIs overlap (Wilson intervals over anchored presence wins).
    Integrity RED marks any veto on a must-hold case. Caving Turn is the median first-caved turn.</footer>
</body>
</html>
`;
}
