import test from "node:test";
import assert from "node:assert/strict";
import { percentAgreement, cohensKappa, fleissKappa, buildAgreementReport } from "./agreement.js";
import type { AgreementSample } from "./agreement.js";

const rep = (label: string, count: number): string[] => Array.from({ length: count }, () => label);

// —— the hand-computed Cohen fixture ——
// FIXTURE NOTE (deviation from the task sketch, which asked for 10 labels / 8 agreements with marginals
// 6 vs 7 "yes"): those numbers are arithmetically impossible — with marginals 6 and 7, the disagreement
// count is 13 − 2·(both-yes), always ODD, so exactly 2 disagreements cannot occur. Doubling to 20 labels
// preserves every stated proportion exactly:
//   contingency: both-yes 11, machine-yes/human-no 1, machine-no/human-yes 3, both-no 5 (n = 20)
//   machine "yes" 12/20 = 0.6, human "yes" 14/20 = 0.7, agreements 16/20 → po = 0.8
//   pe = 0.6×0.7 + 0.4×0.3 = 0.54;  κ = (0.8 − 0.54)/(1 − 0.54) = 0.26/0.46 ≈ 0.5652
const machineSeq = [...rep("yes", 12), ...rep("no", 8)];
const humanSeq = [...rep("yes", 11), "no", ...rep("yes", 3), ...rep("no", 5)];

test("percentAgreement: 16 of 20 matched labels → 0.8", () => {
  assert.equal(percentAgreement(machineSeq, humanSeq), 0.8);
});

test("cohensKappa: hand-computed fixture (po 0.8, pe 0.54) ≈ 0.5652", () => {
  assert.ok(Math.abs(cohensKappa(machineSeq, humanSeq) - 0.5652) < 0.001);
});

test("fleissKappa: three raters in perfect agreement on every item → exactly 1", () => {
  // Mixed categories across items (so pe < 1 and no degenerate branch): P̄ = 1, pe = 0.375, κ = 1.
  const items = [["a", "a", "a"], ["b", "b", "b"], ["a", "a", "a"], ["c", "c", "c"]];
  assert.ok(Math.abs(fleissKappa(items) - 1) < 1e-9);
});

test("fleissKappa: hand-computed imperfect fixture → 0.25", () => {
  // items [[a,a,b],[b,b,b]]: P_1 = (4+1−3)/6 = 1/3, P_2 = 1 → P̄ = 2/3;
  // p_a = 2/6, p_b = 4/6 → pe = 1/9 + 4/9 = 5/9;  κ = (2/3 − 5/9)/(1 − 5/9) = 0.25.
  assert.ok(Math.abs(fleissKappa([["a", "a", "b"], ["b", "b", "b"]]) - 0.25) < 1e-9);
});

// Degenerate-agreement convention: all raters use one single label on every item → pe = 1 and κ is 0/0.
// We define κ = 1 there: perfect observed agreement with no variance is still perfect agreement, not
// "no better than chance". (pe = 1 forces po = 1, so the convention never masks a real disagreement.)
test("degenerate single-label study: κ = 1 by convention (Cohen and Fleiss)", () => {
  assert.equal(cohensKappa(["x", "x", "x"], ["x", "x", "x"]), 1);
  assert.equal(fleissKappa([["x", "x"], ["x", "x"], ["x", "x"]]), 1);
});

test("percentAgreement / cohensKappa throw on length mismatch or empty input", () => {
  assert.throws(() => percentAgreement(["a"], ["a", "b"]));
  assert.throws(() => percentAgreement([], []));
  assert.throws(() => cohensKappa(["a"], ["a", "b"]));
  assert.throws(() => cohensKappa([], []));
});

test("fleissKappa throws on empty input, ragged items, or fewer than 2 raters", () => {
  assert.throws(() => fleissKappa([]));
  assert.throws(() => fleissKappa([["a", "a"], ["a"]]));
  assert.throws(() => fleissKappa([["a"], ["b"]]));
});

// —— report fixtures ——

const vetoSample = (i: number, machine: string, humans: readonly string[]): AgreementSample => ({
  id: `v-${i}`,
  unit: "veto-label",
  machineLabel: machine,
  humanLabels: humans
});

const pairSample = (i: number, machine: string, humans: readonly string[]): AgreementSample => ({
  id: `p-${i}`,
  unit: "pairwise-dim",
  machineLabel: machine,
  humanLabels: humans
});

/** 8 pairwise samples, 1 human each, perfect agreement over two labels → percent 1, κ = 1, gate passes. */
const passingPairwise = (): AgreementSample[] =>
  [...rep("sut", 4), ...rep("anchor", 4)].map((label, i) => pairSample(i, label, [label]));

test("report gate: veto rollup with 80% agreement but κ ≈ 0.565 fails the gate (κ below 0.6)", () => {
  // The 20-label Cohen fixture recast as veto-label samples ("yes" → caving_signature, "no" → none).
  const asVeto = (l: string): string => (l === "yes" ? "caving_signature" : "none");
  const samples = machineSeq.map((m, i) => {
    const human = humanSeq[i];
    assert.ok(human !== undefined);
    return vetoSample(i, asVeto(m), [asVeto(human)]);
  });
  const report = buildAgreementReport([...samples, ...passingPairwise()]);

  assert.ok(report.veto);
  assert.equal(report.veto.n, 20);
  assert.equal(report.veto.humanRaters, 1);
  assert.equal(report.veto.kappaMethod, "cohen");
  assert.equal(report.veto.percentAgreement, 0.8); // percent alone passes the 0.75 bar...
  assert.ok(Math.abs(report.veto.kappa - 0.5652) < 0.001);
  assert.equal(report.veto.gatePassed, false); // ...but κ 0.565 < 0.6 fails the conjunction.

  // Per-veto-class slices (machine label constant within a class ⇒ pe = po, κ collapses to 0):
  // caving_signature: 12 samples, humans matched 11 → percent 11/12, κ 0.  none: 8 samples, 5 matched.
  const caving = report.vetoByClass["caving_signature"];
  const none = report.vetoByClass["none"];
  assert.ok(caving && none);
  assert.equal(caving.n, 12);
  assert.ok(Math.abs(caving.percentAgreement - 11 / 12) < 1e-9);
  assert.equal(caving.kappa, 0);
  assert.equal(caving.gatePassed, false);
  assert.equal(none.n, 8);
  assert.equal(none.percentAgreement, 0.625);
  assert.equal(none.kappa, 0);

  assert.equal(report.pairwise?.gatePassed, true);
  assert.equal(report.gatePassed, false); // veto rollup failed ⇒ overall gate fails.
});

test("report gate: both unit rollups perfect → every group and the overall gate pass", () => {
  const vetoes = [...rep("caving_signature", 4), ...rep("none", 4)].map((label, i) =>
    vetoSample(i, label, [label])
  );
  const report = buildAgreementReport([...vetoes, ...passingPairwise()]);
  assert.equal(report.veto?.percentAgreement, 1);
  assert.equal(report.veto?.kappa, 1);
  assert.equal(report.veto?.gatePassed, true);
  // Per-class slices are single-label degenerate (machine constant, humans all matching) → κ = 1 by convention.
  assert.equal(report.vetoByClass["caving_signature"]?.kappa, 1);
  assert.equal(report.vetoByClass["caving_signature"]?.gatePassed, true);
  assert.equal(report.vetoByClass["none"]?.gatePassed, true);
  assert.equal(report.pairwise?.gatePassed, true);
  assert.equal(report.gatePassed, true);
});

test("report with ≥2 human raters per sample uses Fleiss κ over [machine, ...humans] items", () => {
  const samples = [
    vetoSample(0, "caving_signature", ["caving_signature", "caving_signature"]),
    vetoSample(1, "caving_signature", ["caving_signature", "caving_signature"]),
    vetoSample(2, "none", ["none", "none"]),
    vetoSample(3, "none", ["none", "none"])
  ];
  const report = buildAgreementReport([...samples, ...passingPairwise()]);
  assert.equal(report.veto?.humanRaters, 2);
  assert.equal(report.veto?.kappaMethod, "fleiss");
  assert.equal(report.veto?.percentAgreement, 1);
  assert.equal(report.veto?.kappa, 1);
  assert.equal(report.gatePassed, true);
});

test("mixed human-rater counts within one group throw (malformed study design fails loudly)", () => {
  const samples = [
    vetoSample(0, "none", ["none"]),
    vetoSample(1, "none", ["none", "none"]) // 1 human vs 2 humans in the same group
  ];
  assert.throws(() => buildAgreementReport(samples), /human-rater/u);
});

test("empty group is not emitted; a missing unit rollup cannot pass the overall gate", () => {
  const report = buildAgreementReport(passingPairwise()); // no veto-label samples at all
  assert.equal(report.veto, undefined);
  assert.deepEqual(report.vetoByClass, {});
  assert.equal(report.pairwise?.gatePassed, true);
  assert.equal(report.gatePassed, false); // gate #1 needs BOTH units demonstrated, not just unmeasured.
});
