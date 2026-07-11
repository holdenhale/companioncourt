// Diagnostic report (判决书) — institution design §5: every defendant (model) gets a REPORT, not a rank.
// Section order is the spec's: defendant identity (manifest summary) → aggregate (with the Integrity
// Gate displayed independently of averages) → per-case verdicts → DISPUTED docket (with any rulings
// applied via the registry's own narrowing semantics) → the full transcripts as an appendix. The banner
// under the H1 is a constant: M3-A outputs may circulate internally with it, and REMOVING it is a
// deliberate post-launch-gates code change, never a formatting cleanup.
//
// Determinism discipline: the render is a pure function of its inputs — no timestamps (no Date.now()/
// new Date()), all orderings codepoint-wise (never localeCompare — T10 house rule: output must not vary
// with the regenerating machine's locale). Emission discipline: the assembled Markdown is redaction-
// checked HERE, not just at the CLI write — a poisoned transcript refuses to render at all.

import { aggregateRuns } from "./scoring.js";
import { applyRulings, type Ruling } from "./registry.js";
import { REDACTION_PATTERN } from "./util.js";
import type { CaseVerdict, ModelPin, ObservedActor, ProviderObservation, RunManifest, RunResult } from "./types.js";

export type ReportInputs = {
  subject: string;                            // model name (the defendant)
  runs: readonly RunResult[];                 // all runs for this subject (≥1, one corpus)
  rulings?: readonly Ruling[];                // optional public rulings to apply/report
  clsByCaseId?: ReadonlyMap<string, string>;  // caseId -> BenchCaseClass, for ruling matching
  mustHoldCaseIds: ReadonlySet<string>;
};

export const REPORT_BANNER =
  "> INTERNAL / PRE-PUBLICATION — not a public ranking claim. Verdicts are publicly contestable once published, never validated: the adversarial survival record (with exposure denominators) begins at zero at publication, and construct-level consequence evidence is pending.";

const byCodepoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

// Real runIds are `${startedAt}-${sha256_12(...)}` — the trailing hash segment is the readable pin.
const shortRunId = (runId: string): string => (runId.length > 12 ? runId.slice(-12) : runId);

/** One pin, one cell: `model (t=temperature[, pv=providerVersionField][, adj=[effectiveAdjustments]])`. */
function pinText(p: ModelPin): string {
  const pv = p.providerVersionField !== undefined ? `, pv=${p.providerVersionField}` : "";
  const adj =
    p.effectiveAdjustments !== undefined && p.effectiveAdjustments.length > 0
      ? `, adj=[${p.effectiveAdjustments.join(",")}]`
      : "";
  return `${p.model} (t=${p.temperature}${pv}${adj})`;
}

// Canonical actor order for rendering — fixed here (not object-key order) so the render never varies
// with the key order a JSON file happened to persist.
const OBSERVED_ACTORS: readonly ObservedActor[] = ["sut", "anchor", "personaActor", "judgeA", "judgeB"];

/**
 * MIGRATION shim (contract event 0.2.0): run files persisted before 0.2.0 carry providerObserved in
 * the FLAT shape ({responseModel?, systemFingerprint?}) — which was by construction the SUT's first
 * response. Readers accept both shapes; the flat one normalizes to a sut-only per-actor record. The
 * two shapes are distinguishable by their keys (observation fields vs actor names — disjoint sets).
 */
export function normalizeProviderObserved(
  observed: RunManifest["providerObserved"] | ProviderObservation | undefined
): RunManifest["providerObserved"] {
  if (observed === undefined) return undefined;
  if ("responseModel" in observed || "systemFingerprint" in observed) {
    return { sut: observed as ProviderObservation };
  }
  return observed as RunManifest["providerObserved"];
}

/** Per-actor compact render, e.g. `sut:claude-sonnet-4-6/fp_9 · judgeB:gpt-5.4`; "unavailable" when empty. */
function providerObservedText(m: RunManifest): string {
  const observed = normalizeProviderObserved(m.providerObserved);
  const parts: string[] = [];
  for (const actor of OBSERVED_ACTORS) {
    const o = observed?.[actor];
    if (!o) continue;
    const fields = [o.responseModel, o.systemFingerprint].filter((x): x is string => typeof x === "string");
    if (fields.length > 0) parts.push(`${actor}:${fields.join("/")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "unavailable";
}

// —— §5 block 1: respondent identity (naming discipline: "defendant" is internal-only vocabulary) ——

// One row per DISTINCT manifest configuration: runs that differ only in runId/seed/startedAt share a
// row (their runIds grouped in the first cell); any config drift — pins, mode, versions, seedHonored,
// providerObserved — splits rows so the drift is visible instead of averaged away.
function identitySection(runs: readonly RunResult[]): string[] {
  const groups = new Map<string, { cells: readonly string[]; runIds: string[] }>();
  for (const run of runs) {
    const m = run.manifest;
    const cells = [
      m.mode,
      pinText(m.sut),
      pinText(m.anchor),
      // The persona pin joined the table with contract event 0.2.0: the motivating incident for
      // effectiveAdjustments was a PERSONA pin whose temperature the gateway refused — an identity
      // table that never shows the persona pin would keep that drift invisible.
      pinText(m.personaActor),
      `${pinText(m.judgeA)} / ${pinText(m.judgeB)}`,
      `${m.corpusVersion} (${m.corpusHash})`,
      m.anchorPackHash,
      `f:${m.promptHashes.friend} p:${m.promptHashes.persona} j:${m.promptHashes.judges}`,
      m.benchVersion,
      m.adapterVersion,
      String(m.seedHonored),
      providerObservedText(m)
    ];
    const key = JSON.stringify(cells);
    const group = groups.get(key) ?? { cells, runIds: [] };
    group.runIds.push(shortRunId(m.runId));
    groups.set(key, group);
  }
  const rows = [...groups.entries()]
    .sort(([a], [b]) => byCodepoint(a, b))
    .map(
      ([, g]) => `| ${[...g.runIds].sort(byCodepoint).join(", ")} | ${g.cells.join(" | ")} |`
    );
  return [
    "## Respondent identity",
    "",
    "| Runs | Mode | SUT | Anchor | Persona | Judges | Corpus | Anchor pack | Prompt hashes | Bench | Adapter | Seed honored | Provider observed |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    ""
  ];
}

// —— §5 block 2: aggregate + Integrity Gate ——

function aggregateSection(
  runs: readonly RunResult[],
  verdicts: readonly CaseVerdict[],
  mustHoldCaseIds: ReadonlySet<string>
): string[] {
  const summary = aggregateRuns(runs, mustHoldCaseIds);

  const dimRows = Object.entries(summary.dimWinRates)
    .sort(([a], [b]) => byCodepoint(a, b))
    .map(([dim, rec]) => {
      const rate = rec.n > 0 ? `${pct(rec.wins / rec.n)} (${rec.wins}/${rec.n})` : "—";
      const ci = rec.n > 0 ? `${pct(rec.ci.lo)}–${pct(rec.ci.hi)}` : "—";
      return `| ${dim} | ${rate} | ${ci} |`;
    });

  // The gate names its offenders (caseKey + vetoes) — a RED is a specific accusation, not a flag.
  const offenders = verdicts
    .filter((v) => v.status === "scored" && v.vetoes.length > 0 && mustHoldCaseIds.has(v.caseId))
    .map((v) => `${v.caseKey} (${v.vetoes.join(",")})`);
  const gate = summary.integrityRed
    ? `- **Integrity Gate: RED** — must-hold veto: ${offenders.join("; ")}`
    : "- Integrity Gate: ok — no veto fired on a must-hold case";

  return [
    "## Aggregate",
    "",
    "| Dimension | Anchored win-rate | Wilson 95% CI |",
    "| --- | --- | --- |",
    ...dimRows,
    "",
    `- Disputed rate: ${pct(summary.disputedRate)} of scored verdicts`,
    `- Inconclusive: ${summary.inconclusiveCount}`,
    `- Caving turn (median): ${summary.cavingTurnMedian !== undefined ? summary.cavingTurnMedian : "—"}`,
    gate,
    ""
  ];
}

// —— §5 block 3: per-case verdicts ——

function dimsText(v: CaseVerdict): string {
  const entries = Object.entries(v.dims)
    .sort(([a], [b]) => byCodepoint(a, b))
    .map(([dim, verdict]) => `${dim}:${verdict}`);
  return entries.length > 0 ? entries.join(" ") : "-";
}

function perCaseSection(verdicts: readonly CaseVerdict[]): string[] {
  const rows = verdicts.map((v) =>
    `| ${shortRunId(v.runId)} | ${v.caseKey} | ${v.mode} | ${v.status} | ${dimsText(v)} | ` +
    `${v.vetoes.length > 0 ? v.vetoes.join(",") : "-"} | ${v.cavingTurn ?? "-"} | ` +
    `${v.personaSelfRate ?? "-"} | ${v.disputed ? "yes" : "no"} |`
  );
  return [
    "## Per-case verdicts",
    "",
    "| Run | Case | Mode | Status | Dims | Vetoes | Caving turn | Self-rate | Disputed |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    ""
  ];
}

// —— §5 block 4: DISPUTED docket + rulings applied ——

// Which disagreement is visible from the frozen verdict: dims valued "disputed" name themselves; a
// verdict disputed with NO disputed dim can only be a single-family judged-signal (veto-level)
// disagreement — the kind is not stored in CaseVerdict, so the docket says exactly that.
function disagreementText(v: CaseVerdict): string {
  const dims = Object.entries(v.dims)
    .filter(([, verdict]) => verdict === "disputed")
    .map(([dim]) => dim)
    .sort(byCodepoint);
  return dims.length > 0 ? `dims: ${dims.join(", ")}` : "veto-level (single family fired; kind not stored in verdict)";
}

function disputedSection(
  verdicts: readonly CaseVerdict[],
  rulings: readonly Ruling[] | undefined,
  clsByCaseId: ReadonlyMap<string, string> | undefined
): string[] {
  const disputed = verdicts.filter((v) => v.disputed);
  if (disputed.length === 0) return ["### DISPUTED docket", "", "No disputed verdicts.", ""];

  // applyRulings carries the registry's full narrowing semantics (case-specific never spreads,
  // unconfirmed cls precedents skipped). Re-applying each ruling ALONE identifies which id(s) actually
  // touched a verdict — reusing the registry matcher instead of duplicating it here.
  const canApply = rulings !== undefined && clsByCaseId !== undefined;
  const applied = canApply ? applyRulings(disputed, rulings, clsByCaseId) : disputed;
  const after = applied.filter((v) => v.disputed).length;

  const header = canApply
    ? `${disputed.length} disputed verdict(s) before rulings; ${after} after (${disputed.length - after} resolved).`
    : `${disputed.length} disputed verdict(s); no rulings supplied.`;

  const rows = disputed.map((v, i) => {
    let resolution = "unresolved";
    const out = applied[i];
    if (canApply && out !== undefined && !out.disputed) {
      const ids = rulings.filter((r) => applyRulings([v], [r], clsByCaseId)[0] !== v).map((r) => r.id);
      resolution = `resolved by ruling ${ids.join(", ")}`;
    }
    return `| ${v.caseKey} | ${shortRunId(v.runId)} | ${disagreementText(v)} | ${resolution} |`;
  });

  return [
    "### DISPUTED docket",
    "",
    header,
    "",
    "| Case | Run | Disagreement | Resolution |",
    "| --- | --- | --- | --- |",
    ...rows,
    ""
  ];
}

// —— §5 appendix: transcripts ——

// Blinding note: these are the SUT's own transcripts — the report belongs to the defendant. X/Y
// blinding lives in the judge prompts, not here.
function transcriptsSection(verdicts: readonly CaseVerdict[]): string[] {
  const lines: string[] = ["## Transcripts appendix", ""];
  for (const v of verdicts) {
    if (v.status !== "scored") continue;
    lines.push(`<details><summary>${v.caseKey} (${shortRunId(v.runId)})</summary>`, "");
    for (const turn of v.transcripts.sut) lines.push(`**${turn.who}:** ${turn.text}`, "");
    if (v.transcripts.anchor) {
      lines.push("#### anchor transcript", "");
      for (const turn of v.transcripts.anchor) lines.push(`**${turn.who}:** ${turn.text}`, "");
    }
    lines.push("</details>", "");
  }
  return lines;
}

/**
 * Renders one defendant's full diagnostic report as Markdown. Throws on empty runs, on runs spanning
 * different corpus hashes (a report over incomparable dockets is not a report), and on any assembled
 * output matching REDACTION_PATTERN.
 */
export function buildDiagnosticReport(inputs: ReportInputs): string {
  const { subject, runs, rulings, clsByCaseId, mustHoldCaseIds } = inputs;

  const first = runs[0];
  if (!first) throw new Error("report requires at least one run");
  for (const run of runs) {
    if (run.manifest.corpusHash !== first.manifest.corpusHash) {
      throw new Error("report runs span different corpus hashes");
    }
  }

  // One canonical verdict order for every per-case block: caseKey, then runId, codepoint-wise.
  const verdicts = runs
    .flatMap((r) => r.verdicts)
    .sort((a, b) => byCodepoint(a.caseKey, b.caseKey) || byCodepoint(a.runId, b.runId));

  const md = [
    `# CompanionCourt Diagnostic Report — ${subject}`,
    "",
    REPORT_BANNER,
    "",
    ...identitySection(runs),
    ...aggregateSection(runs, verdicts, mustHoldCaseIds),
    ...perCaseSection(verdicts),
    ...disputedSection(verdicts, rulings, clsByCaseId),
    ...transcriptsSection(verdicts),
    "---",
    "",
    `corpus ${first.manifest.corpusVersion} (hash ${first.manifest.corpusHash}) · ` +
      `bench v${first.manifest.benchVersion} · deterministic render — regenerating from the same run ` +
      "files is byte-identical (no timestamps).",
    ""
  ].join("\n");

  if (REDACTION_PATTERN.test(md)) {
    throw new Error("refusing to emit: content matches REDACTION_PATTERN");
  }
  return md;
}
