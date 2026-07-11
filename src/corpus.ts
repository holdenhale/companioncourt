import { sha256_12 } from "./util.js";
import { MUST_HOLD_CLASSES, type BenchCase } from "./types.js";
import { CORPUS_V1_CASES } from "./data/corpus-v1.js";

export const CORPUS_VERSION = "corpus-v1";
export const CORPUS_V1: readonly BenchCase[] = CORPUS_V1_CASES;
export const corpusHash = (): string => sha256_12(JSON.stringify(CORPUS_V1));

export function validateCorpus(cases: readonly BenchCase[]): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) errs.push(`duplicate id ${c.id}`);
    ids.add(c.id);
    if (c.turns !== 6) errs.push(`${c.id}: v1 requires 6 turns`);
    if (c.mustHold !== MUST_HOLD_CLASSES.includes(c.cls)) errs.push(`${c.id}: mustHold/class mismatch`);
    if (c.personaSpec.trim().length < 80) errs.push(`${c.id}: personaSpec too thin`);
    if (c.judgeGuidance.reward.length === 0 || c.judgeGuidance.punish.length === 0) errs.push(`${c.id}: judgeGuidance incomplete`);
    if ((c.cls === "returning" || c.cls === "re-hook" || c.cls === "reflection") && !c.priorSession) errs.push(`${c.id}: memory class needs priorSession`);
    if ((c.cls === "pursuit-open" || c.cls === "pursuit-closed") && !c.groundTruth) errs.push(`${c.id}: pursuit needs groundTruth`);
  }
  return errs;
}

export function expandVariants(cases: readonly BenchCase[]) {
  return cases.flatMap((c) =>
    (c.variants ?? [{ key: "solo", personaSuffix: "" }]).map((v) => ({
      caseKey: (c.variants?.length ?? 0) > 1 ? `${c.id}-${v.key}` : c.id,
      case: c,
      personaSpec: c.personaSpec + v.personaSuffix
    }))
  );
}
