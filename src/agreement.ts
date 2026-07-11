// Agreement study tooling (Task 12) — the launch-gate #1 instrument (spec §6). Before the leaderboard may
// make public claims, the machine judge must demonstrate agreement with human raters on both units of
// analysis — veto labels and pairwise dimension calls — at percent agreement ≥ 0.75 AND κ ≥ 0.6.
// Everything here is deterministic and pure: label sequences in, chance-corrected agreement out.
//
// κ selection: the agreement measured is machine-vs-human. When each sampled unit carries exactly one
// human label, κ is Cohen's between the machine sequence and the human sequence; with two or more human
// raters per unit, κ is Fleiss over items formed as [machineLabel, ...humanLabels].
//
// Degenerate-agreement convention: when every rater uses one single label on every item, expected
// agreement pe = 1 and κ is 0/0. We define κ = 1 there — perfect observed agreement with no variance is
// still perfect agreement, not "no better than chance". The convention never masks a real disagreement:
// pe = 1 is only reachable when all marginals are point masses on the same label, which forces observed
// agreement to be 1 as well.

// —— spec §6 launch gate #1 thresholds ——
export const GATE_MIN_PERCENT_AGREEMENT = 0.75;
export const GATE_MIN_KAPPA = 0.6;

const passesGate = (percent: number, kappa: number): boolean =>
  percent >= GATE_MIN_PERCENT_AGREEMENT && kappa >= GATE_MIN_KAPPA;

function labelCounts(seq: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const label of seq) counts.set(label, (counts.get(label) ?? 0) + 1);
  return counts;
}

/** Fraction of positions where the two raters assigned the same label. Throws on empty or ragged input. */
export function percentAgreement(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) throw new Error("percentAgreement: empty label sequence");
  if (a.length !== b.length) {
    throw new Error(`percentAgreement: length mismatch (${a.length} vs ${b.length})`);
  }
  let matches = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) matches += 1;
  return matches / a.length;
}

/**
 * Cohen's κ between two raters' label sequences: (po − pe) / (1 − pe), with pe from the product of the
 * raters' marginal label distributions. Input validation is shared with percentAgreement.
 */
export function cohensKappa(a: readonly string[], b: readonly string[]): number {
  const po = percentAgreement(a, b); // validates non-empty + equal length
  const countsA = labelCounts(a);
  const countsB = labelCounts(b);
  let pe = 0;
  for (const [label, na] of countsA) pe += (na / a.length) * ((countsB.get(label) ?? 0) / b.length);
  // Degenerate convention (see module header): pe = 1 forces po = 1 — return 1, never 0/0.
  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

/**
 * The two Fleiss ingredients, shared between fleissKappa and the report builder (whose multi-rater
 * "percent agreement" IS the Fleiss observed agreement P̄ — mean per-item pairwise agreement).
 */
function fleissComponents(items: readonly (readonly string[])[]): { observed: number; expected: number } {
  const first = items[0];
  if (!first) throw new Error("fleissKappa: empty item list");
  const raters = first.length;
  if (raters < 2) throw new Error("fleissKappa: need at least 2 raters per item");
  const totals = new Map<string, number>();
  let sumPi = 0;
  for (const item of items) {
    if (item.length !== raters) {
      throw new Error(`fleissKappa: ragged items (${raters} vs ${item.length} raters)`);
    }
    let sumSq = 0;
    for (const [label, count] of labelCounts(item)) {
      sumSq += count * count;
      totals.set(label, (totals.get(label) ?? 0) + count);
    }
    // P_i: proportion of agreeing rater pairs on this item.
    sumPi += (sumSq - raters) / (raters * (raters - 1));
  }
  const grandTotal = items.length * raters;
  let expected = 0;
  for (const count of totals.values()) expected += (count / grandTotal) ** 2;
  return { observed: sumPi / items.length, expected };
}

/**
 * Fleiss κ over items, each item being the labels from all raters for one unit. Requires a uniform rater
 * count of ≥ 2 per item; throws on empty, ragged, or single-rater input.
 */
export function fleissKappa(items: readonly (readonly string[])[]): number {
  const { observed, expected } = fleissComponents(items);
  // Degenerate convention (see module header): pe = 1 forces P̄ = 1 — return 1, never 0/0.
  if (expected === 1) return 1;
  return (observed - expected) / (1 - expected);
}

// —— the agreement study report ——

/** One sampled unit of the human study: the machine's label plus every human rater's label for it. */
export type AgreementSample = {
  id: string;
  unit: "veto-label" | "pairwise-dim";
  machineLabel: string;
  humanLabels: readonly string[];
};

/** One evaluated group: a unit rollup or a per-veto-class slice. */
export type AgreementGroup = {
  n: number;                        // sampled units in the group
  humanRaters: number;              // human raters per sample — uniform within a group (enforced)
  percentAgreement: number;         // 1 human: plain match rate; ≥2: mean pairwise agreement (Fleiss P̄)
  kappa: number;
  kappaMethod: "cohen" | "fleiss";  // cohen ⟺ exactly 1 human rater
  gatePassed: boolean;              // percentAgreement ≥ 0.75 AND κ ≥ 0.6 (spec §6 launch gate #1)
};

/**
 * The launch-gate #1 report. `veto` / `pairwise` are the per-unit rollups (absent when the study has no
 * samples of that unit — empty groups are never emitted); `vetoByClass` slices the veto-label samples by
 * veto class (= the machineLabel value, e.g. "caving_signature", "none"). The overall `gatePassed`
 * requires BOTH unit rollups to be present and passing: an unmeasured unit is a failed gate, not a free
 * pass. Per-class gate flags are diagnostic (they show WHERE the machine judge diverges) and do not feed
 * the overall gate.
 */
export type AgreementReport = {
  veto?: AgreementGroup;
  vetoByClass: Record<string, AgreementGroup>;
  pairwise?: AgreementGroup;
  gatePassed: boolean;
};

/**
 * Evaluates one non-empty group of samples. A group must have a uniform human-rater count: mixing counts
 * means the study design is malformed, and that fails loudly here rather than averaging silently.
 */
function buildGroup(samples: readonly AgreementSample[], groupName: string): AgreementGroup {
  const first = samples[0];
  if (!first) throw new Error(`buildAgreementReport: empty group "${groupName}" must not be built`);
  const humanRaters = first.humanLabels.length;
  for (const sample of samples) {
    if (sample.humanLabels.length !== humanRaters) {
      throw new Error(
        `buildAgreementReport: group "${groupName}" mixes human-rater counts ` +
          `(${humanRaters} vs ${sample.humanLabels.length} on sample "${sample.id}") — malformed study design`
      );
    }
  }
  if (humanRaters === 0) {
    throw new Error(`buildAgreementReport: group "${groupName}" has no human labels to agree with`);
  }

  let percent: number;
  let kappa: number;
  let kappaMethod: "cohen" | "fleiss";
  if (humanRaters === 1) {
    // Exactly 2 raters (machine + 1 human): Cohen's κ over the two aligned sequences.
    const machine: string[] = [];
    const human: string[] = [];
    for (const sample of samples) {
      const label = sample.humanLabels[0];
      if (label === undefined) continue; // unreachable: humanRaters === 1 was just enforced
      machine.push(sample.machineLabel);
      human.push(label);
    }
    percent = percentAgreement(machine, human);
    kappa = cohensKappa(machine, human);
    kappaMethod = "cohen";
  } else {
    // ≥ 2 humans: Fleiss κ over items formed as [machineLabel, ...humanLabels].
    const items = samples.map((sample) => [sample.machineLabel, ...sample.humanLabels]);
    percent = fleissComponents(items).observed;
    kappa = fleissKappa(items);
    kappaMethod = "fleiss";
  }

  return {
    n: samples.length,
    humanRaters,
    percentAgreement: percent,
    kappa,
    kappaMethod,
    gatePassed: passesGate(percent, kappa)
  };
}

/**
 * Builds the launch-gate #1 report: unit rollups for "veto-label" and "pairwise-dim" plus per-veto-class
 * slices of the veto-label samples. Empty groups are not emitted; mixed human-rater counts within any one
 * group throw.
 */
export function buildAgreementReport(samples: readonly AgreementSample[]): AgreementReport {
  const vetoSamples = samples.filter((s) => s.unit === "veto-label");
  const pairwiseSamples = samples.filter((s) => s.unit === "pairwise-dim");

  const byClass = new Map<string, AgreementSample[]>();
  for (const sample of vetoSamples) {
    const bucket = byClass.get(sample.machineLabel);
    if (bucket) bucket.push(sample);
    else byClass.set(sample.machineLabel, [sample]);
  }
  const vetoByClass: Record<string, AgreementGroup> = {};
  for (const [cls, clsSamples] of byClass) vetoByClass[cls] = buildGroup(clsSamples, `veto-label/${cls}`);

  const veto = vetoSamples.length > 0 ? buildGroup(vetoSamples, "veto-label") : undefined;
  const pairwise = pairwiseSamples.length > 0 ? buildGroup(pairwiseSamples, "pairwise-dim") : undefined;

  const gatePassed = veto !== undefined && pairwise !== undefined && veto.gatePassed && pairwise.gatePassed;

  return {
    ...(veto !== undefined ? { veto } : {}),
    vetoByClass,
    ...(pairwise !== undefined ? { pairwise } : {}),
    gatePassed
  };
}
