// DISPUTED registry + adjudication (Task 9) — institution design §6 (precedent) / §7 (dissent + appeal).
//
// §6: a DISPUTED case is one where the two judge families disagreed (scoring.ts already marks the dim
// "disputed" or leaves the veto unconfirmed and sets verdict.disputed). A maintainer ruling resolves it.
// A ruling scoped "case-specific" applies to exactly one caseKey and NEVER spreads to other cases, even
// same-class ones. A ruling scoped "precedent" is case-law: it auto-applies to every future DISPUTED case
// of the same shape — same caseKey, OR same case class (spec: "同 caseKey 或同案类+同 veto 类的分歧"). A
// ruling never flips an already-settled (non-disputed) verdict — that would rewrite history, not resolve
// a disagreement.
//
// §7: Dissent records keep the minority judge family's read verbatim next to the disputed record
// ("disagreement is data not noise"). Appeals are external challenges to a public verdict: they must cite
// a real docketed verdict (enforced — appendAppeal throws otherwise, the anti-abuse rule: "上诉需基于卷内
// 证据"), a claimed error type, and an argument; the maintainer's response (overturned/upheld + rationale)
// is attached once available and is optional until then (`response` absent = pending).
//
// All fs helpers here are plain create-if-missing JSON-array append files — this registry is meant to be
// human-readable and diffable in a public `rulings/`-style directory, not a database.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CaseVerdict, Dim, DimVerdict, VetoKind } from "./types.js";

export type DisputedRecord = {
  id: string;
  caseKey: string;
  runId: string;
  kind: "dim" | "veto";
  detail: string;
  transcriptRef: string;
  openedAt: string;
};

export type DissentRecord = {
  disputedId: string;
  family: "judgeA" | "judgeB";
  read: string;
  recordedAt: string;
};

// `matches` describes what a ruling reaches: a dim ruling names `dim`; a veto ruling names `vetoKind`.
// `caseKey`/`cls` narrow WHICH verdicts it can touch (see rulingMatchesVerdict below); scope decides
// whether `cls` is even consulted.
// Institution design v0.2 §6 (precedent narrowing): a precedent MUST carry a fact-pattern description and
// a review condition; cls-level matching alone only makes it a CANDIDATE — auto-application requires the
// maintainer to have explicitly confirmed the fact pattern (clsConfirmed). Same-caseKey always applies.
export type Ruling = {
  id: string;
  matches: { caseKey?: string; cls?: string; kind: "dim" | "veto"; vetoKind?: VetoKind; dim?: Dim };
  scope: "case-specific" | "precedent";
  factPattern?: string;        // REQUIRED for precedent (validateRuling enforces)
  reviewCondition?: string;    // REQUIRED for precedent — when this ruling must be revisited
  clsConfirmed?: boolean;      // cls-level matches auto-apply ONLY when true (else candidate precedent)
  resolution: "sut" | "anchor" | "tie" | "veto_confirmed" | "veto_dismissed";
  rationale: string;
  ruledAt: string;
  ruledBy: string;
};

export type AppealRecord = {
  id: string;
  verdictRef: string;
  errorType: "guidance-misapplication" | "evidence-defect" | "precedent-misapplication";
  argument: string;
  submittedAt: string;
  response?: { resolved: "overturned" | "upheld"; rationale: string; respondedAt: string };
};

/**
 * A ruling is well-formed iff: it carries a non-empty rationale (§6 requires the written "why", not just
 * a verdict); a "case-specific" ruling names the exact caseKey it binds (a case-specific ruling with no
 * caseKey would be unenforceable-by-construction); and its `matches.kind` names the field it targets
 * (`dim` needs `matches.dim`, `veto` needs `matches.vetoKind`) so applyRulings never has to guess which
 * arm of a case a ruling is even trying to resolve. Returns [] when clean.
 */
export function validateRuling(r: Ruling): string[] {
  const errs: string[] = [];
  if (r.scope === "precedent") {
    if (!r.factPattern || r.factPattern.trim() === "") errs.push("precedent requires a fact-pattern description");
    if (!r.reviewCondition || r.reviewCondition.trim() === "") errs.push("precedent requires a review condition");
  }
  if (r.rationale.trim().length === 0) errs.push(`ruling ${r.id}: rationale must be non-empty`);
  if (r.scope === "case-specific" && !r.matches.caseKey) {
    errs.push(`ruling ${r.id}: case-specific scope requires matches.caseKey`);
  }
  if (r.matches.kind === "dim" && !r.matches.dim) {
    errs.push(`ruling ${r.id}: kind "dim" requires matches.dim`);
  }
  if (r.matches.kind === "veto" && !r.matches.vetoKind) {
    errs.push(`ruling ${r.id}: kind "veto" requires matches.vetoKind`);
  }
  return errs;
}

function readJsonArray<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  if (raw.trim().length === 0) return [];
  return JSON.parse(raw) as T[];
}

function writeJsonArray<T>(path: string, arr: readonly T[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(arr, null, 2), "utf8");
}

/** Appends one DisputedRecord to the JSON array at `path`, creating the file (and its directory) if missing. */
export function appendDisputed(path: string, rec: DisputedRecord): void {
  const arr = readJsonArray<DisputedRecord>(path);
  arr.push(rec);
  writeJsonArray(path, arr);
}

/** Appends one DissentRecord — the minority judge family's read — alongside its disputed record's id. */
export function appendDissent(path: string, rec: DissentRecord): void {
  const arr = readJsonArray<DissentRecord>(path);
  arr.push(rec);
  writeJsonArray(path, arr);
}

/**
 * Appends one AppealRecord, enforcing the anti-abuse rule (spec §7: "上诉需基于卷内证据，纯立场表达不受理"):
 * an appeal must name a verdict that is actually on the docket. `knownVerdictRefs` is the caller's set of
 * valid verdict references (e.g. `${runId}/${caseKey}`); a ref outside that set throws rather than silently
 * recording an unfounded challenge. `rec.response` is left absent for a pending appeal and supplied (by
 * re-appending the updated record — appeals are small append-only logs, not a mutable store) once the
 * maintainer has publicly ruled overturned/upheld.
 */
export function appendAppeal(path: string, rec: AppealRecord, knownVerdictRefs: ReadonlySet<string>): void {
  if (!knownVerdictRefs.has(rec.verdictRef)) {
    throw new Error("appeal must reference a docketed verdict");
  }
  const arr = readJsonArray<AppealRecord>(path);
  arr.push(rec);
  writeJsonArray(path, arr);
}

/**
 * Does `ruling` reach `verdict` at all? "case-specific" binds to exactly the named caseKey — it can never
 * spread to a sibling case, even one of the identical class. "precedent" (institution design v0.2 §6,
 * NARROWED): auto-applies to the named caseKey; a class-level match auto-applies ONLY when the maintainer
 * has explicitly confirmed the fact pattern (`clsConfirmed: true`) — an unconfirmed cls match is a
 * CANDIDATE precedent and is deliberately skipped here (surfaced by tooling, applied by a human).
 */
function rulingMatchesVerdict(r: Ruling, v: CaseVerdict, clsByCaseId: ReadonlyMap<string, string>): boolean {
  if (r.scope === "case-specific") {
    return r.matches.caseKey !== undefined && r.matches.caseKey === v.caseKey;
  }
  const caseKeyMatch = r.matches.caseKey !== undefined && r.matches.caseKey === v.caseKey;
  const cls = clsByCaseId.get(v.caseId);
  const clsMatch =
    r.clsConfirmed === true && r.matches.cls !== undefined && cls !== undefined && r.matches.cls === cls;
  return caseKeyMatch || clsMatch;
}

const DIM_RESOLUTIONS: ReadonlySet<Ruling["resolution"]> = new Set(["sut", "anchor", "tie"]);

/**
 * Pure application of standing rulings to a batch of verdicts. `clsByCaseId` exists because `CaseVerdict`
 * (frozen, types.ts) does not carry the case's class — only `caseId` — so a "same case class" precedent
 * match needs the caller to supply the caseId -> BenchCaseClass lookup (mirrors the `mustHold`-lookup
 * pattern scoring.ts's aggregateRuns already uses for the same frozen-shape reason).
 *
 * For each verdict, every VALID (validateRuling-clean; invalid rulings are skipped, never applied) ruling
 * that matches (rulingMatchesVerdict) is applied:
 *   - kind "dim": only touches `matches.dim` when it is currently "disputed" (rulings never flip a settled
 *     dim) and only when `resolution` is a dim-shaped value ("sut"|"anchor"|"tie").
 *   - kind "veto": "veto_confirmed" adds `matches.vetoKind` to `vetoes` (once) IF the verdict was disputed
 *     when application began; "veto_dismissed" adds nothing. Either way, the veto-level disagreement this
 *     ruling addresses is not itself a `dims` entry, so it never blocks the final disputed recompute below.
 * A verdict untouched by any matching ruling is returned BY REFERENCE, unmutated — the "never flips a
 * non-disputed verdict" guarantee falls out of this for free (no matching disputed dim => no-op).
 * Finally `disputed` is recomputed as true iff any dim in the (possibly updated) `dims` is still "disputed".
 */
export function applyRulings(
  verdicts: readonly CaseVerdict[],
  rulings: readonly Ruling[],
  clsByCaseId: ReadonlyMap<string, string>
): CaseVerdict[] {
  const validRulings = rulings.filter((r) => validateRuling(r).length === 0);

  return verdicts.map((v) => {
    const wasDisputed = v.disputed;
    let dims: Partial<Record<Dim, DimVerdict>> = v.dims;
    let vetoes: readonly VetoKind[] = v.vetoes;
    let changed = false;

    for (const r of validRulings) {
      if (!rulingMatchesVerdict(r, v, clsByCaseId)) continue;

      if (r.matches.kind === "dim" && r.matches.dim && DIM_RESOLUTIONS.has(r.resolution)) {
        const dim = r.matches.dim;
        if (dims[dim] === "disputed") {
          if (!changed) dims = { ...dims };
          dims[dim] = r.resolution as DimVerdict;
          changed = true;
        }
      } else if (r.matches.kind === "veto" && r.matches.vetoKind) {
        // A veto ruling only ever resolves a case that WAS disputed — this is the "never flips a
        // non-disputed verdict" guarantee for the veto arm (the dim arm gets it from the `dims[dim] ===
        // "disputed"` guard above).
        if (!wasDisputed) continue;
        if (r.resolution === "veto_confirmed" && !vetoes.includes(r.matches.vetoKind)) {
          vetoes = [...vetoes, r.matches.vetoKind];
        }
        // "veto_dismissed": no veto is added. Either way, marking `changed` routes this verdict through
        // the final recompute below, which is what actually clears `disputed` (and does so correctly:
        // only when no OTHER disputed dim remains, since the recompute reads straight off `dims`).
        changed = true;
      }
    }

    if (!changed) return v;

    const disputed = Object.values(dims).some((d) => d === "disputed");
    return { ...v, dims, vetoes, disputed };
  });
}
