#!/usr/bin/env node
// CompanionCourt CLI (Task 11) — thin wiring only: flag parsing (node:util parseArgs, zero deps) around
// the package's modules. Five subcommands: `smoke` (deterministic all-fake pipeline pass), `anchor`
// (generate + freeze the anchor pack), `run` (probe seed honoring, run the bench, patch the manifest
// with the live probe + provider observations, persist), `docket` (roll run files into the docket
// page; `leaderboard` is kept as an undocumented alias so existing scripts keep working), `report`
// (per-defendant diagnostic report per institution §5). House discipline: the --key
// VALUE is never echoed anywhere — usage shows placeholders only, error output is scrubbed — and every
// file written is redaction-checked first.

import { parseArgs } from "node:util";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSmoke } from "../smoke.js";
import { makeOpenAiChat, resolveSeedHonored } from "../subject.js";
import { generateAnchorPack, anchorPackHash, saveAnchorPack, loadAnchorPack } from "../anchor.js";
import { runBench } from "../runner.js";
import { CORPUS_V1, CORPUS_VERSION, corpusHash } from "../corpus.js";
import { aggregateRuns } from "../scoring.js";
import { buildLeaderboard, renderHtml } from "../leaderboard.js";
import { buildDiagnosticReport } from "../report.js";
import { validateRuling, type Ruling } from "../registry.js";
import { REDACTION_PATTERN } from "../util.js";
import type { ModelPin, ObservedActor, ProviderObservation, RunManifest, RunResult } from "../types.js";

// benchVersion is the package's own version — read from companioncourt/package.json, two levels above
// the compiled dist/bin/cli.js.
const BENCH_VERSION = ((): string => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version?: unknown;
  };
  return typeof pkg.version === "string" ? pkg.version : "0.0.0";
})();

const USAGE = `CompanionCourt — a public docket for pressure-testing AI companions

Usage:
  companioncourt smoke
  companioncourt anchor --endpoint <url> [--key <api-key>] --anchor-model <m> --persona-model <m>
                     [--lang en|zh] [--seed <s>] [--out <path>]
                     [--anchor-provider-version-field <v>] [--persona-provider-version-field <v>]
  companioncourt run --endpoint <url> [--key <api-key>] --model <sut> --anchor-pack <path>
                     [--lang en|zh] [--mode dyad|paired-replay] [--seed <s>] [--out <dir>]
                     [--persona-model <m>] [--judge-a <m>] [--judge-b <m>]
                     [--sut-provider-version-field <v>] [--persona-provider-version-field <v>]
                     [--judge-a-provider-version-field <v>] [--judge-b-provider-version-field <v>]
                     [--sut-request-overrides <json>]
  companioncourt docket --runs <dir> --out <dir>
  companioncourt report --runs <dir> --out <dir> [--subject <model>] [--rulings <file.json>]

Provider-version-field flags record what is honestly known about each actor's provider snapshot in the
manifest's ModelPins (e.g. "unavailable" when the gateway strips the model echo). --lang restricts the
corpus to one language so anchor packs and runs can pair per-language anchors.

--key may be omitted if COMPANIONCOURT_API_KEY is set in the environment instead (preferred — an
env-only key never appears in argv/process listings the way a --key flag value does). --key still wins
if both are given. --sut-request-overrides is a JSON object merged into the SUT's own request body only
(e.g. a provider-specific thinking-mode toggle some respondent needs to fit inside its token budget); it
may not set model/messages/temperature/max_tokens/seed/response_format, and it is recorded on the run
manifest (manifest.sut.requestOverrides) so a reader can see the SUT wasn't called with a vanilla config.
`;

/** Validates and applies the optional --lang restriction to the corpus. */
function casesForLang(lang: string | undefined) {
  if (lang === undefined) return CORPUS_V1;
  if (lang !== "en" && lang !== "zh") throw new UsageError(`--lang must be en or zh, got ${lang}`);
  return CORPUS_V1.filter((c) => c.lang === lang);
}

/** ModelPin with providerVersionField attached only when the flag was actually given. */
function pin(model: string, temperature: number, providerVersionField: string | undefined): ModelPin {
  return { model, temperature, ...(providerVersionField !== undefined ? { providerVersionField } : {}) };
}

// Secrets seen while parsing (the --key value) — scrubbed out of anything this process prints on failure.
const secrets: string[] = [];

function scrub(text: string): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join("[redacted]");
  }
  return out.replace(new RegExp(REDACTION_PATTERN.source, "gu"), "[redacted]");
}

export class UsageError extends Error {}

function requireFlag(values: Record<string, string | undefined>, flag: string): string {
  const v = values[flag];
  if (v === undefined || v === "") throw new UsageError(`missing required flag --${flag}`);
  return v;
}

// The env var name is already the documented convention in README.md's Quickstart (it showed
// `--key "$COMPANIONCOURT_API_KEY"` before this fallback existed — this makes the env var alone
// sufficient, so the key no longer has to touch argv at all for the common case). Exported so it can be
// unit-tested (cli.test.ts) without exercising the rest of the CLI's process.argv-driven dispatch.
export const API_KEY_ENV_VAR = "COMPANIONCOURT_API_KEY";

/**
 * Resolves the provider API key: an explicit --key wins when given (backward compatible with existing
 * scripts); otherwise falls back to the COMPANIONCOURT_API_KEY environment variable. Never logged either
 * way — the caller still pushes the resolved value into `secrets` for scrub() coverage.
 */
export function requireKey(values: Record<string, string | undefined>): string {
  const fromFlag = values.key;
  const key = fromFlag !== undefined && fromFlag !== "" ? fromFlag : process.env[API_KEY_ENV_VAR];
  if (key === undefined || key === "") {
    throw new UsageError(`missing required flag --key (or set ${API_KEY_ENV_VAR})`);
  }
  return key;
}

/** Parses --sut-request-overrides: a JSON object, or undefined when the flag was not given. */
function parseSutRequestOverrides(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UsageError("--sut-request-overrides must be valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError("--sut-request-overrides must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** Redaction-checked file write: refuses (throws) rather than persist a tracked secret/endpoint shape. */
function writeChecked(path: string, content: string): void {
  if (REDACTION_PATTERN.test(content)) {
    throw new Error(`refusing to write ${path}: content matches REDACTION_PATTERN`);
  }
  writeFileSync(path, content, "utf8");
}

// —— smoke ——

async function cmdSmoke(): Promise<number> {
  const result = await runSmoke();
  for (const c of result.checks) {
    console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log(result.ok ? "SMOKE: OK" : "SMOKE: FAIL");
  return result.ok ? 0 : 1;
}

// —— anchor ——

async function cmdAnchor(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      endpoint: { type: "string" },
      key: { type: "string" },
      "anchor-model": { type: "string" },
      "persona-model": { type: "string" },
      lang: { type: "string" },
      seed: { type: "string" },
      out: { type: "string" },
      "anchor-provider-version-field": { type: "string" },
      "persona-provider-version-field": { type: "string" }
    }
  });
  const v = values as Record<string, string | undefined>;
  const endpoint = requireFlag(v, "endpoint");
  const key = requireKey(v);
  secrets.push(key);
  const anchorModel = requireFlag(v, "anchor-model");
  const personaModel = requireFlag(v, "persona-model");
  const seed = v.seed ?? "0";
  const outPath = v.out ?? "anchor-pack.json";

  // effectiveAdjustments (contract event 0.2.0): the anchor adapter reports what it had to change for
  // the provider to accept the request; the pack's anchor pin is patched BEFORE saving so the frozen
  // pack attests what was actually sent. (The persona adapter's adjustments have no home here — the
  // pack persists only the anchor pin.)
  const anchorAdjustments: string[] = [];
  const pack = await generateAnchorPack({
    personaChat: makeOpenAiChat(endpoint, key),
    anchorChat: makeOpenAiChat(endpoint, key, undefined, (a) => anchorAdjustments.push(a)),
    personaPin: pin(personaModel, 0.9, v["persona-provider-version-field"]),
    anchorPin: pin(anchorModel, 0.7, v["anchor-provider-version-field"]),
    cases: casesForLang(v.lang),
    corpusVersion: CORPUS_VERSION,
    corpusHashValue: corpusHash(),
    seed,
    nowIso: new Date().toISOString()
  });
  const packToSave =
    anchorAdjustments.length > 0
      ? { ...pack, anchor: { ...pack.anchor, effectiveAdjustments: anchorAdjustments } }
      : pack;
  saveAnchorPack(outPath, packToSave); // saveAnchorPack redaction-checks before writing
  console.log(`anchor pack written to ${outPath}`);
  console.log(`anchor pack hash: ${anchorPackHash(packToSave)}`);
  return 0;
}

// —— run ——

function formatVerdictLine(v: RunResult["verdicts"][number], keyWidth: number): string {
  const dims = Object.entries(v.dims)
    .map(([d, verdict]) => `${d}:${verdict}`)
    .join(" ");
  const vetoes = v.vetoes.length > 0 ? v.vetoes.join(",") : "-";
  return `  ${v.caseKey.padEnd(keyWidth)}  ${v.status.padEnd(12)}  ${(dims || "-").padEnd(44)}  ${vetoes}`;
}

async function cmdRun(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      endpoint: { type: "string" },
      key: { type: "string" },
      model: { type: "string" },
      "anchor-pack": { type: "string" },
      lang: { type: "string" },
      mode: { type: "string" },
      seed: { type: "string" },
      out: { type: "string" },
      "persona-model": { type: "string" },
      "judge-a": { type: "string" },
      "judge-b": { type: "string" },
      "sut-provider-version-field": { type: "string" },
      "persona-provider-version-field": { type: "string" },
      "judge-a-provider-version-field": { type: "string" },
      "judge-b-provider-version-field": { type: "string" },
      "sut-request-overrides": { type: "string" }
    }
  });
  const v = values as Record<string, string | undefined>;
  const endpoint = requireFlag(v, "endpoint");
  const key = requireKey(v);
  secrets.push(key);
  const sutModel = requireFlag(v, "model");
  const anchorPackPath = requireFlag(v, "anchor-pack");
  const mode = v.mode ?? "dyad";
  if (mode !== "dyad" && mode !== "paired-replay") {
    throw new UsageError(`--mode must be dyad or paired-replay, got ${mode}`);
  }
  const seed = v.seed ?? "0";
  const outDir = v.out ?? "runs";
  const sutRequestOverrides = parseSutRequestOverrides(v["sut-request-overrides"]);

  // loadAnchorPack binds the pack to the CURRENT corpus hash — a stale pack refuses here, up front.
  const pack = loadAnchorPack(anchorPackPath, corpusHash());

  // Actor pins: persona/judges default to the pack's anchor model when not pinned explicitly. The
  // anchor pin comes from the FROZEN pack verbatim (including any providerVersionField recorded at
  // generation time) — the run must not rewrite what the pack attests about itself.
  // sut.requestOverrides (contract event 0.3.0) is set HERE, before runBench ever starts — see
  // runner.ts's SUT call sites and manifest.ts's verbatim pin passthrough for why that ordering is what
  // makes this field double as honest manifest disclosure of what was actually sent.
  const pins: { sut: ModelPin; anchor: ModelPin; personaActor: ModelPin; judgeA: ModelPin; judgeB: ModelPin } = {
    sut: {
      ...pin(sutModel, 0.7, v["sut-provider-version-field"]),
      ...(sutRequestOverrides !== undefined ? { requestOverrides: sutRequestOverrides } : {})
    },
    anchor: pack.anchor,
    personaActor: pin(v["persona-model"] ?? pack.anchor.model, 0.9, v["persona-provider-version-field"]),
    judgeA: pin(v["judge-a"] ?? pack.anchor.model, 0, v["judge-a-provider-version-field"]),
    judgeB: pin(v["judge-b"] ?? pack.anchor.model, 0, v["judge-b-provider-version-field"])
  };

  // Live seed probe (subject.ts) on its own chat — runBench itself always records "unprobed". The
  // probe adapter is deliberately unobserved: providerObserved records BENCH-RUN responses only.
  // resolveSeedHonored degrades to "unprobed" on any probe failure (Step 1 diagnosis, 2026-07-21: a
  // provider empty-content failure here must never crash the whole apply the way an unguarded
  // probeSeedHonored call once did) and threads the SUT's own requestOverrides into the probe's calls,
  // so a verified thinking-mode toggle covers the probe too, not just the dyad turns below.
  const seedHonored = await resolveSeedHonored(makeOpenAiChat(endpoint, key), sutModel, sutRequestOverrides);

  // providerObserved (contract event 0.2.0): FIRST bench-run response per live actor (model +
  // system_fingerprint), via per-actor onResponse closures. The anchor never speaks during a run
  // (its conversations are frozen in the pack), so it has no live observation here.
  const providerObserved: Partial<Record<ObservedActor, ProviderObservation>> = {};
  const observeFirst =
    (actor: ObservedActor) =>
    (raw: unknown): void => {
      if (providerObserved[actor]) return;
      const r = raw as { model?: unknown; system_fingerprint?: unknown } | null;
      providerObserved[actor] = {
        ...(typeof r?.model === "string" ? { responseModel: r.model } : {}),
        ...(typeof r?.system_fingerprint === "string" ? { systemFingerprint: r.system_fingerprint } : {})
      };
    };

  // effectiveAdjustments (contract event 0.2.0): per-actor onAdjustment collectors record what each
  // adapter had to change for the provider to accept the request (e.g. "temperature-dropped").
  // runBench keeps recording the pins verbatim; the CLI patches post-run — same pattern as
  // providerObserved, so the persisted manifest says what was ACTUALLY sent.
  const adjustments: Partial<Record<ObservedActor, string[]>> = {};
  const collectAdjustments =
    (actor: ObservedActor) =>
    (adjustment: string): void => {
      (adjustments[actor] ??= []).push(adjustment);
    };
  const withAdjustments = (pinIn: ModelPin, actor: ObservedActor): ModelPin => {
    const adj = adjustments[actor];
    return adj !== undefined && adj.length > 0 ? { ...pinIn, effectiveAdjustments: adj } : pinIn;
  };

  const result = await runBench({
    chats: {
      sut: makeOpenAiChat(endpoint, key, observeFirst("sut"), collectAdjustments("sut")),
      persona: makeOpenAiChat(endpoint, key, observeFirst("personaActor"), collectAdjustments("personaActor")),
      judgeA: makeOpenAiChat(endpoint, key, observeFirst("judgeA"), collectAdjustments("judgeA")),
      judgeB: makeOpenAiChat(endpoint, key, observeFirst("judgeB"), collectAdjustments("judgeB"))
    },
    pins,
    cases: casesForLang(v.lang),
    corpusVersion: CORPUS_VERSION,
    corpusHashValue: corpusHash(),
    anchorPack: pack,
    mode,
    seed,
    nowIso: new Date().toISOString(),
    benchVersion: BENCH_VERSION
    // no outDir: the CLI persists the PATCHED result below, never the unprobed intermediate
  });

  // Post-run manifest patch: the real probe result, the per-actor provider observations, and each
  // live actor's effective request adjustments. The anchor pin stays exactly as the pack froze it.
  const manifest: RunManifest = {
    ...result.manifest,
    seedHonored,
    sut: withAdjustments(result.manifest.sut, "sut"),
    personaActor: withAdjustments(result.manifest.personaActor, "personaActor"),
    judgeA: withAdjustments(result.manifest.judgeA, "judgeA"),
    judgeB: withAdjustments(result.manifest.judgeB, "judgeB"),
    ...(Object.keys(providerObserved).length > 0 ? { providerObserved } : {})
  };
  const patched: RunResult = { manifest, verdicts: result.verdicts };

  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${manifest.runId.replaceAll(":", "-")}.json`);
  writeChecked(outFile, JSON.stringify(patched, null, 2));

  // Small summary table: per-case line, then the aggregate line.
  const keyWidth = Math.max(...patched.verdicts.map((c) => c.caseKey.length), 8);
  console.log(`run ${manifest.runId} (${mode}) — sut ${sutModel} vs anchor ${pack.anchor.model}`);
  console.log(`  ${"case".padEnd(keyWidth)}  ${"status".padEnd(12)}  ${"dims".padEnd(44)}  vetoes`);
  for (const verdict of patched.verdicts) console.log(formatVerdictLine(verdict, keyWidth));
  const mustHoldIds = new Set(CORPUS_V1.filter((c) => c.mustHold).map((c) => c.id));
  const agg = aggregateRuns([patched], mustHoldIds);
  const presence = agg.dimWinRates.presence;
  const presenceText = presence && presence.n > 0 ? `${presence.wins}/${presence.n} anchored wins` : "n/a";
  console.log(
    `aggregate: presence ${presenceText} · integrity ${agg.integrityRed ? "RED" : "ok"} · ` +
      `disputed ${(100 * agg.disputedRate).toFixed(1)}% · inconclusive ${agg.inconclusiveCount} · ` +
      `seedHonored ${seedHonored}`
  );
  console.log(`result written to ${outFile}`);
  return 0;
}

// —— docket ——

async function cmdDocket(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { runs: { type: "string" }, out: { type: "string" } }
  });
  const v = values as Record<string, string | undefined>;
  const runsDir = requireFlag(v, "runs");
  const outDir = requireFlag(v, "out");

  const files = readdirSync(runsDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) throw new Error(`no *.json run results found in ${runsDir}`);

  const bySubject = new Map<string, RunResult[]>();
  for (const file of files.sort()) {
    const parsed = JSON.parse(readFileSync(join(runsDir, file), "utf8")) as RunResult;
    const subject = parsed?.manifest?.sut?.model;
    if (typeof subject !== "string" || !Array.isArray(parsed.verdicts)) {
      throw new Error(`${file} is not a RunResult (missing manifest.sut.model / verdicts)`);
    }
    const list = bySubject.get(subject) ?? [];
    list.push(parsed);
    bySubject.set(subject, list);
  }

  const mustHoldIds = new Set(CORPUS_V1.filter((c) => c.mustHold).map((c) => c.id));
  const board = buildLeaderboard(bySubject, mustHoldIds);

  mkdirSync(outDir, { recursive: true });
  writeChecked(join(outDir, "leaderboard.json"), JSON.stringify(board, null, 2));
  writeChecked(join(outDir, "leaderboard.html"), renderHtml(board));
  console.log(`docket page over ${files.length} run(s), ${board.rows.length} subject row(s)`);
  console.log(`written to ${join(outDir, "leaderboard.json")} and ${join(outDir, "leaderboard.html")}`);
  return 0;
}

// —— report ——

async function cmdReport(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      runs: { type: "string" },
      out: { type: "string" },
      subject: { type: "string" },
      rulings: { type: "string" }
    }
  });
  const v = values as Record<string, string | undefined>;
  const runsDir = requireFlag(v, "runs");
  const outDir = requireFlag(v, "out");

  const files = readdirSync(runsDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) throw new Error(`no *.json run results found in ${runsDir}`);

  const bySubject = new Map<string, RunResult[]>();
  for (const file of files.sort()) {
    const parsed = JSON.parse(readFileSync(join(runsDir, file), "utf8")) as RunResult;
    const subject = parsed?.manifest?.sut?.model;
    if (typeof subject !== "string" || !Array.isArray(parsed.verdicts)) {
      throw new Error(`${file} is not a RunResult (missing manifest.sut.model / verdicts)`);
    }
    const list = bySubject.get(subject) ?? [];
    list.push(parsed);
    bySubject.set(subject, list);
  }

  // --rulings is a JSON array of Ruling objects; ANY invalid ruling aborts, with every error listed.
  let rulings: readonly Ruling[] | undefined;
  if (v.rulings !== undefined) {
    const parsed = JSON.parse(readFileSync(v.rulings, "utf8")) as Ruling[];
    if (!Array.isArray(parsed)) throw new Error(`${v.rulings} is not a JSON array of rulings`);
    const errs = parsed.flatMap((r) => validateRuling(r));
    if (errs.length > 0) throw new Error(`invalid rulings in ${v.rulings}:\n  ${errs.join("\n  ")}`);
    rulings = parsed;
  }

  if (v.subject !== undefined && !bySubject.has(v.subject)) {
    throw new Error(`subject ${v.subject} not found in ${runsDir}`);
  }
  const subjects = v.subject !== undefined ? [v.subject] : [...bySubject.keys()].sort();

  const mustHoldCaseIds = new Set(CORPUS_V1.filter((c) => c.mustHold).map((c) => c.id));
  const clsByCaseId = new Map<string, string>(CORPUS_V1.map((c) => [c.id, c.cls]));

  mkdirSync(outDir, { recursive: true });
  for (const subject of subjects) {
    const md = buildDiagnosticReport({
      subject,
      runs: bySubject.get(subject) ?? [],
      mustHoldCaseIds,
      clsByCaseId,
      ...(rulings !== undefined ? { rulings } : {})
    });
    const outFile = join(outDir, `report-${subject.replace(/[^A-Za-z0-9._-]/gu, "-")}.md`);
    writeChecked(outFile, md);
    console.log(`report for ${subject} written to ${outFile}`);
  }
  return 0;
}

// —— dispatch ——

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "smoke":
      return cmdSmoke();
    case "anchor":
      return cmdAnchor(rest);
    case "run":
      return cmdRun(rest);
    case "docket":
    case "leaderboard": // undocumented alias for the pre-rename subcommand name — external scripts keep working
      return cmdDocket(rest);
    case "report":
      return cmdReport(rest);
    default:
      process.stderr.write(USAGE);
      return 1;
  }
}

// Only run the CLI when this file is the process entry point — never on import. Without this guard,
// cli.test.ts (added alongside requireKey/UsageError becoming exported for unit testing) would trigger
// a full argv-driven dispatch as a side effect of merely importing the module.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${scrub(message)}\n`);
      if (err instanceof UsageError) process.stderr.write(USAGE);
      process.exitCode = 1;
    });
}
