import test from "node:test";
import assert from "node:assert/strict";
import { buildLeaderboard, renderHtml } from "./leaderboard.js";
import { REDACTION_PATTERN } from "./util.js";
import type { CaseVerdict, RunManifest, RunResult } from "./types.js";

const mkVerdict = (over: any = {}): CaseVerdict => ({
  caseKey: "cb-01",
  caseId: "cb-01",
  runId: "r1",
  mode: "dyad",
  status: "scored",
  vetoes: [],
  dims: { presence: "sut" },
  personaSelfRate: 3,
  hookRate: 0.3,
  disputed: false,
  transcripts: { sut: [{ who: "user", text: "u" }, { who: "companion", text: "s" }] },
  ...over
});

const mkManifest = (over: any = {}): RunManifest => ({
  runId: "20260708-abcdefabcdef",
  benchVersion: "0.1.0",
  adapterVersion: "openai-chat-v1",
  corpusVersion: "corpus-v1",
  corpusHash: "c".repeat(12),
  anchorPackHash: "a".repeat(12),
  promptHashes: { friend: "f".repeat(12), persona: "p".repeat(12), judges: "j".repeat(12) },
  mode: "dyad",
  sut: { model: "m1", temperature: 0.7 },
  anchor: { model: "a1", temperature: 0.7 },
  personaActor: { model: "p1", temperature: 0.9 },
  judgeA: { model: "j1", temperature: 0 },
  judgeB: { model: "j2", temperature: 0 },
  seedHonored: "unprobed",
  startedAt: "2026-07-08",
  seed: "s1",
  ...over
});

const mkRun = (verdicts: readonly CaseVerdict[], manifestOver: any = {}): RunResult => ({
  manifest: mkManifest(manifestOver),
  verdicts
});

// `sutWins` of the batch go to the SUT, the rest to the anchor — controls the presence win-rate exactly.
const presenceBatch = (count: number, sutWins: number): CaseVerdict[] =>
  Array.from({ length: count }, (_, i) =>
    mkVerdict({
      caseKey: `cb-${i}`,
      caseId: `cb-${i}`,
      dims: { presence: i < sutWins ? "sut" : "anchor" }
    })
  );

// 2 subjects × 3 RunResults each. model-a sweeps presence (30/30); model-b loses it all (0/30) and its
// first run carries both a must-hold veto (integrity RED) and one inconclusive case.
const mkBoardFixture = (): ReadonlyMap<string, readonly RunResult[]> =>
  new Map([
    [
      "model-a",
      [mkRun(presenceBatch(10, 10)), mkRun(presenceBatch(10, 10)), mkRun(presenceBatch(10, 10))]
    ],
    [
      "model-b",
      [
        mkRun([
          ...presenceBatch(10, 0),
          mkVerdict({
            caseKey: "mh-01",
            caseId: "mh-01",
            vetoes: ["caving_signature"],
            cavingTurn: 3,
            dims: { presence: "anchor" }
          }),
          mkVerdict({
            caseKey: "inc-01",
            caseId: "inc-01",
            status: "inconclusive",
            inconclusiveReason: "provider failure",
            vetoes: [],
            dims: {}
          })
        ]),
        mkRun(presenceBatch(10, 0)),
        mkRun(presenceBatch(10, 0))
      ]
    ]
  ]);

test("rows sort by presence win-rate; separated CIs rank apart; must-hold veto shows RED", () => {
  const board = buildLeaderboard(mkBoardFixture(), new Set(["mh-01"]));

  assert.deepEqual(board.rows.map((r) => r.subject), ["model-a", "model-b"]);
  assert.equal(board.rows[0]?.rank, 1);
  assert.equal(board.rows[1]?.rank, 2); // 30/30 vs 0/31 — Wilson CIs clearly separate
  assert.equal(board.rows[0]?.integrity, "ok");
  assert.equal(board.rows[1]?.integrity, "RED");
  assert.equal(board.rows[0]?.nRuns, 3);
  assert.equal(board.rows[1]?.cavingTurnMedian, 3);
  assert.equal(board.rows[1]?.inconclusiveCount, 1);
  assert.ok((board.rows[0]?.presence.ci.lo ?? 0) > (board.rows[1]?.presence.ci.hi ?? 1));

  assert.equal(board.benchVersion, "0.1.0");
  assert.equal(board.corpusVersion, "corpus-v1");
  assert.equal(board.corpusHash, "c".repeat(12));
});

test("overlapping presence CIs share the same rank", () => {
  const runs = new Map<string, readonly RunResult[]>([
    ["model-a", [mkRun(presenceBatch(10, 10)), mkRun(presenceBatch(10, 10)), mkRun(presenceBatch(10, 10))]],
    // 28/30 — Wilson CI overlaps 30/30's, so the rank claim is not allowed to separate them.
    ["model-c", [mkRun(presenceBatch(10, 10)), mkRun(presenceBatch(10, 9)), mkRun(presenceBatch(10, 9))]]
  ]);
  const board = buildLeaderboard(runs, new Set());

  assert.deepEqual(board.rows.map((r) => r.subject), ["model-a", "model-c"]); // still rate-sorted
  assert.equal(board.rows[0]?.rank, 1);
  assert.equal(board.rows[1]?.rank, 1);
});

test("throws when runs span different corpus hashes", () => {
  const runs = new Map<string, readonly RunResult[]>([
    ["model-a", [mkRun(presenceBatch(2, 2))]],
    ["model-b", [mkRun(presenceBatch(2, 0), { corpusHash: "x".repeat(12) })]]
  ]);
  assert.throws(() => buildLeaderboard(runs, new Set()), /leaderboard runs span different corpus hashes/);
});

test("renderHtml: docket page carries model names, corpus version, Caving Turn column, tie footer", () => {
  const board = buildLeaderboard(mkBoardFixture(), new Set(["mh-01"]));
  const html = renderHtml(board);

  assert.ok(html.includes("model-a"));
  assert.ok(html.includes("model-b"));
  assert.ok(html.includes("corpus-v1"));
  assert.ok(html.includes("Caving Turn"));
  assert.ok(html.includes("public docket"), "headline is diagnostic/docket framing, not marketing");
  assert.ok(html.includes("ranks tie when 95% CIs overlap"), "footer states the rank-tie discipline");
  assert.ok(html.includes("prefers-color-scheme: dark"), "light/dark via media query, inline CSS only");
  assert.ok(!/<script/iu.test(html), "no scripts required");
  assert.ok(!REDACTION_PATTERN.test(html), "no tracked secret/endpoint patterns in the emitted artifact");
});
