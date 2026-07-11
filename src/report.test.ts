import test from "node:test";
import assert from "node:assert/strict";
import { buildDiagnosticReport, normalizeProviderObserved, type ReportInputs } from "./report.js";
import type { CaseVerdict, RunManifest, RunResult } from "./types.js";
import type { Ruling } from "./registry.js";

// The banner is duplicated here ON PURPOSE (not imported): dropping or editing it in report.ts is a
// deliberate post-launch-gates change and must break this test until both sides are edited.
const BANNER =
  "> INTERNAL / PRE-PUBLICATION — not a public ranking claim. Verdicts are publicly contestable once published, never validated: the adversarial survival record (with exposure denominators) begins at zero at publication, and construct-level consequence evidence is pending.";

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
  runId: "r1",
  benchVersion: "0.1.0",
  adapterVersion: "openai-chat-v1",
  corpusVersion: "corpus-v1",
  corpusHash: "c".repeat(12),
  anchorPackHash: "a".repeat(12),
  promptHashes: { friend: "f".repeat(12), persona: "p".repeat(12), judges: "j".repeat(12) },
  mode: "dyad",
  sut: { model: "model-x", temperature: 0.7 },
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

// 1 subject × 2 runs: r1 carries a clean win, a must-hold veto (mh-01), a disputed case (dp-01) and an
// inconclusive case (inc-01); r2 repeats the clean win so caseKey-then-runId ordering is observable.
const mkInputs = (): ReportInputs => ({
  subject: "model-x",
  runs: [
    mkRun(
      [
        mkVerdict({
          transcripts: {
            sut: [{ who: "user", text: "u" }, { who: "companion", text: "s" }],
            anchor: [{ who: "user", text: "u" }, { who: "companion", text: "anchor-said" }]
          }
        }),
        mkVerdict({
          caseKey: "mh-01",
          caseId: "mh-01",
          vetoes: ["caving_signature"],
          cavingTurn: 3,
          dims: { presence: "anchor" }
        }),
        mkVerdict({ caseKey: "dp-01", caseId: "dp-01", dims: { presence: "disputed" }, disputed: true }),
        mkVerdict({
          caseKey: "inc-01",
          caseId: "inc-01",
          status: "inconclusive",
          inconclusiveReason: "provider failure",
          vetoes: [],
          dims: {},
          personaSelfRate: undefined
        })
      ],
      { runId: "r1", seed: "s1" }
    ),
    mkRun([mkVerdict({ runId: "r2" })], { runId: "r2", seed: "s2", startedAt: "2026-07-09" })
  ],
  mustHoldCaseIds: new Set(["mh-01"])
});

const caseRuling = (over: Partial<Ruling> = {}): Ruling => ({
  id: "R-001",
  matches: { caseKey: "dp-01", kind: "dim", dim: "presence" },
  scope: "case-specific",
  resolution: "sut",
  rationale: "family A applied the door-closed guidance correctly",
  ruledAt: "2026-07-08T00:00:00Z",
  ruledBy: "maintainer",
  ...over
});

// —— input validation ——

test("throws on empty runs and on runs spanning different corpus hashes", () => {
  assert.throws(
    () => buildDiagnosticReport({ subject: "m", runs: [], mustHoldCaseIds: new Set() }),
    /report requires at least one run/
  );
  const inputs = mkInputs();
  const mixed: ReportInputs = {
    ...inputs,
    runs: [inputs.runs[0]!, mkRun([mkVerdict({ runId: "r2" })], { runId: "r2", corpusHash: "x".repeat(12) })]
  };
  assert.throws(() => buildDiagnosticReport(mixed), /report runs span different corpus hashes/);
});

// —— structure ——

test("banner is verbatim under the H1 and the §5 sections appear in order", () => {
  const md = buildDiagnosticReport(mkInputs());
  const landmarks = [
    "# CompanionCourt Diagnostic Report — model-x",
    BANNER,
    "## Respondent identity",
    "## Aggregate",
    "## Per-case verdicts",
    "### DISPUTED docket",
    "## Transcripts appendix",
    "corpus corpus-v1 (hash cccccccccccc)"
  ];
  let prev = -1;
  for (const mark of landmarks) {
    const at = md.indexOf(mark);
    assert.ok(at > prev, `${mark} missing or out of order`);
    prev = at;
  }
});

test("defendant identity groups identical configs into one row (runIds joined)", () => {
  const md = buildDiagnosticReport(mkInputs());
  assert.ok(md.includes("| r1, r2 |"), "both runs share one identity row");
  assert.ok(md.includes("model-x (t=0.7)"));
  assert.ok(md.includes("j1 (t=0) / j2 (t=0)"));
  assert.ok(md.includes("openai-chat-v1"));
  assert.ok(md.includes("unprobed"));
  assert.ok(md.includes("unavailable"), "no providerObserved captured");
});

test("a config difference splits identity rows; providerVersionField and providerObserved render", () => {
  const inputs = mkInputs();
  const runs = [
    inputs.runs[0]!,
    mkRun([mkVerdict({ runId: "r2" })], {
      runId: "r2",
      sut: { model: "model-x", temperature: 0.7, providerVersionField: "2026-06-01" },
      providerObserved: { sut: { responseModel: "model-x-0601", systemFingerprint: "fp_9" } }
    })
  ];
  const md = buildDiagnosticReport({ ...inputs, runs });
  assert.ok(!md.includes("| r1, r2 |"), "differing configs must not share a row");
  assert.ok(md.includes("model-x (t=0.7, pv=2026-06-01)"));
  assert.ok(md.includes("sut:model-x-0601/fp_9"));
});

// Contract event 0.2.0 fix 2: providerObserved went per-actor — every live actor's first-response
// provider snapshot, not just the SUT's. Rendering is compact, in canonical actor order.
test("per-actor providerObserved renders each observed actor compactly in canonical order", () => {
  const inputs = mkInputs();
  const runs = [
    mkRun([mkVerdict()], {
      providerObserved: {
        judgeB: { responseModel: "gpt-5.4" },
        sut: { responseModel: "claude-sonnet-4-6", systemFingerprint: "fp_9" },
        personaActor: {}
      }
    })
  ];
  const md = buildDiagnosticReport({ ...inputs, runs });
  assert.ok(
    md.includes("sut:claude-sonnet-4-6/fp_9 · judgeB:gpt-5.4"),
    "sut before judgeB regardless of key order; empty observations contribute nothing"
  );
});

// MIGRATION honesty: runs persisted before 0.2.0 carry the FLAT providerObserved shape
// ({responseModel?, systemFingerprint?}) — which was by construction the SUT's first response. The
// report must still load them, reading the flat shape as a sut-only observation.
test("an old flat-shape providerObserved fixture still loads and reads as a SUT observation", () => {
  const oldShapeFixture = { responseModel: "qwen-max", systemFingerprint: "fp_old" }; // pre-0.2.0 run file shape
  const inputs = mkInputs();
  const runs = [
    mkRun([mkVerdict()], { runId: "r1", providerObserved: oldShapeFixture }),
    mkRun([mkVerdict({ runId: "r2" })], {
      runId: "r2",
      providerObserved: { sut: { responseModel: "qwen-max", systemFingerprint: "fp_old" } }
    })
  ];
  const md = buildDiagnosticReport({ ...inputs, runs });
  assert.ok(md.includes("sut:qwen-max/fp_old"), "old flat shape renders as the sut observation");
  assert.ok(
    md.includes("| r1, r2 |"),
    "an old-shape run and its new-shape equivalent are the SAME config — one identity row"
  );
});

// Contract event 0.2.0 fix 1: a pin carrying effectiveAdjustments (what the adapter had to change for
// the provider to accept the request) must show them in the identity table — and the difference must
// split identity rows, because "ran without temperature" IS a config drift worth seeing.
test("a pin's effectiveAdjustments render as adj=[...] and split identity rows", () => {
  const inputs = mkInputs();
  const runs = [
    inputs.runs[0]!,
    mkRun([mkVerdict({ runId: "r2" })], {
      runId: "r2",
      personaActor: { model: "p1", temperature: 0.9, effectiveAdjustments: ["temperature-dropped"] }
    })
  ];
  const md = buildDiagnosticReport({ ...inputs, runs });
  assert.ok(md.includes("p1 (t=0.9, adj=[temperature-dropped])"));
  assert.ok(md.includes("p1 (t=0.9)"), "the unadjusted run still renders the bare pin");
  assert.ok(!md.includes("| r1, r2 |"), "adjusted vs unadjusted runs must not share an identity row");
});

test("providerVersionField and effectiveAdjustments compose in one pin cell", () => {
  const inputs = mkInputs();
  const runs = [
    mkRun([mkVerdict()], {
      sut: {
        model: "model-x",
        temperature: 0.7,
        providerVersionField: "2026-06-01",
        effectiveAdjustments: ["temperature-dropped"]
      }
    })
  ];
  const md = buildDiagnosticReport({ ...inputs, runs });
  assert.ok(md.includes("model-x (t=0.7, pv=2026-06-01, adj=[temperature-dropped])"));
});

test("normalizeProviderObserved maps the old flat shape to sut and passes the new shape through", () => {
  assert.deepEqual(normalizeProviderObserved({ responseModel: "qwen-max" }), {
    sut: { responseModel: "qwen-max" }
  });
  assert.deepEqual(normalizeProviderObserved({ systemFingerprint: "fp_1" }), {
    sut: { systemFingerprint: "fp_1" }
  });
  const perActor = { sut: { responseModel: "m" }, judgeA: { systemFingerprint: "fp" } };
  assert.equal(normalizeProviderObserved(perActor), perActor, "new shape passes through unchanged");
  assert.equal(normalizeProviderObserved(undefined), undefined);
});

// —— aggregate ——

test("aggregate shows dim win-rate with Wilson CI, rates, caving median, and Integrity Gate RED with offenders", () => {
  const md = buildDiagnosticReport(mkInputs());
  assert.ok(md.includes("| presence | 66.7% (2/3) |"), "2 sut wins vs 1 anchor win");
  assert.ok(/\| presence \| 66\.7% \(2\/3\) \| \d+\.\d%–\d+\.\d% \|/u.test(md), "Wilson CI rendered");
  assert.ok(md.includes("Disputed rate: 25.0%"));
  assert.ok(md.includes("Inconclusive: 1"));
  assert.ok(md.includes("Caving turn (median): 3"));
  assert.ok(md.includes("Integrity Gate: RED"));
  assert.ok(md.includes("mh-01 (caving_signature)"), "the offending must-hold case + veto is named");
});

test("Integrity Gate reads ok when no must-hold veto fired; caving median dashes out when absent", () => {
  const inputs = mkInputs();
  const md = buildDiagnosticReport({ ...inputs, mustHoldCaseIds: new Set<string>() });
  assert.ok(md.includes("Integrity Gate: ok"));
  assert.ok(!md.includes("Integrity Gate: RED"));

  const noCaving = buildDiagnosticReport({
    subject: "model-x",
    runs: [mkRun([mkVerdict()])],
    mustHoldCaseIds: new Set<string>()
  });
  assert.ok(noCaving.includes("Caving turn (median): —"));
});

// —— per-case verdicts ——

test("per-case rows sort by caseKey then runId (codepoint) and render dims/vetoes/dashes", () => {
  const md = buildDiagnosticReport(mkInputs());
  const rows = [
    "| r1 | cb-01 | dyad | scored | presence:sut | - | - | 3 | no |",
    "| r2 | cb-01 | dyad | scored | presence:sut | - | - | 3 | no |",
    "| r1 | dp-01 | dyad | scored | presence:disputed | - | - | 3 | yes |",
    "| r1 | inc-01 | dyad | inconclusive | - | - | - | - | no |",
    "| r1 | mh-01 | dyad | scored | presence:anchor | caving_signature | 3 | 3 | no |"
  ];
  let prev = -1;
  for (const row of rows) {
    const at = md.indexOf(row);
    assert.ok(at > prev, `row missing or out of order: ${row}`);
    prev = at;
  }
});

test("long runIds render shortened to their trailing hash segment", () => {
  const md = buildDiagnosticReport({
    subject: "model-x",
    runs: [
      mkRun([mkVerdict({ runId: "20260708-abcdefabcdef" })], { runId: "20260708-abcdefabcdef" })
    ],
    mustHoldCaseIds: new Set<string>()
  });
  assert.ok(md.includes("| abcdefabcdef | cb-01 |"));
  assert.ok(md.includes("<summary>cb-01 (abcdefabcdef)</summary>"));
});

// —— DISPUTED docket ——

test("disputed docket lists disputed cases with the disagreeing dims; unresolved without rulings", () => {
  const md = buildDiagnosticReport(mkInputs());
  assert.ok(md.includes("1 disputed verdict(s); no rulings supplied."));
  assert.ok(md.includes("| dp-01 | r1 | dims: presence | unresolved |"));
});

test("with rulings + clsByCaseId the docket reports resolved-by-ruling and before/after counts", () => {
  const md = buildDiagnosticReport({
    ...mkInputs(),
    rulings: [caseRuling()],
    clsByCaseId: new Map([["dp-01", "hold-line"]])
  });
  assert.ok(md.includes("1 disputed verdict(s) before rulings; 0 after (1 resolved)."));
  assert.ok(md.includes("| dp-01 | r1 | dims: presence | resolved by ruling R-001 |"));
});

test("a non-matching ruling leaves the case unresolved (registry narrowing respected)", () => {
  const md = buildDiagnosticReport({
    ...mkInputs(),
    rulings: [caseRuling({ id: "R-002", matches: { caseKey: "other-case", kind: "dim", dim: "presence" } })],
    clsByCaseId: new Map([["dp-01", "hold-line"]])
  });
  assert.ok(md.includes("1 disputed verdict(s) before rulings; 1 after (0 resolved)."));
  assert.ok(md.includes("| dp-01 | r1 | dims: presence | unresolved |"));
});

// —— transcripts appendix ——

test("scored cases get a details block with the SUT transcript; anchor nested; inconclusive skipped", () => {
  const md = buildDiagnosticReport(mkInputs());
  assert.ok(md.includes("<details><summary>cb-01 (r1)</summary>"));
  assert.ok(md.includes("**user:** u"));
  assert.ok(md.includes("**companion:** s"));
  assert.ok(md.includes("#### anchor transcript"));
  assert.ok(md.includes("**companion:** anchor-said"));
  assert.ok(md.includes("</details>"));
  assert.ok(!md.includes("<summary>inc-01"), "inconclusive cases carry no scored transcript entry");
});

// —— emission discipline ——

test("refuses to emit output matching REDACTION_PATTERN", () => {
  const inputs = mkInputs();
  const poisoned: ReportInputs = {
    ...inputs,
    runs: [
      mkRun([
        mkVerdict({
          transcripts: { sut: [{ who: "companion", text: `my key is sk-${"a".repeat(24)}` }] }
        })
      ])
    ]
  };
  assert.throws(() => buildDiagnosticReport(poisoned), /refusing to emit: content matches REDACTION_PATTERN/);
});

test("rendering is deterministic — double render is byte-identical", () => {
  assert.equal(buildDiagnosticReport(mkInputs()), buildDiagnosticReport(mkInputs()));
});

test("footer pins corpus version+hash and bench version with the determinism note", () => {
  const md = buildDiagnosticReport(mkInputs());
  assert.ok(md.includes("corpus corpus-v1 (hash cccccccccccc)"));
  assert.ok(md.includes("bench v0.1.0"));
  assert.ok(md.includes("deterministic"));
});
