import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendDisputed,
  appendDissent,
  appendAppeal,
  applyRulings,
  validateRuling,
  type DisputedRecord,
  type DissentRecord,
  type Ruling,
  type AppealRecord
} from "./registry.js";
import type { CaseVerdict } from "./types.js";

async function tmpFile(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "companioncourt-registry-"));
  return join(dir, name);
}

const baseVerdict = (over: Partial<CaseVerdict> = {}): CaseVerdict => ({
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

// —— appendDisputed ——

test("appendDisputed creates the JSON file when missing and appends on subsequent calls", async () => {
  const path = await tmpFile("disputed.json");
  const rec1: DisputedRecord = {
    id: "d-1",
    caseKey: "cb-01",
    runId: "r1",
    kind: "dim",
    detail: "families disagree on presence winner",
    transcriptRef: "transcripts/cb-01.json",
    openedAt: "2026-01-01T00:00:00.000Z"
  };
  const rec2: DisputedRecord = { ...rec1, id: "d-2", caseKey: "cb-02" };

  appendDisputed(path, rec1);
  const afterFirst = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(afterFirst, [rec1]);

  appendDisputed(path, rec2);
  const afterSecond = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(afterSecond, [rec1, rec2]);
});

// —— applyRulings: precedent, case-specific scoping, non-disputed protection ——

test("applyRulings resolves a disputed dim to sut per a cls-scoped PRECEDENT ruling; leaves unmatched disputes untouched", () => {
  const disputedInClass = baseVerdict({
    caseKey: "cb-01",
    caseId: "cb-01",
    dims: { presence: "disputed" },
    disputed: true
  });
  const disputedOtherDim = baseVerdict({
    caseKey: "cb-03",
    caseId: "cb-03",
    dims: { presence: "disputed", moment_fit: "disputed" },
    disputed: true
  });
  const clsByCaseId = new Map([
    ["cb-01", "hold-line"],
    ["cb-03", "hold-line"]
  ]);
  const ruling: Ruling = {
    id: "ruling-1",
    matches: { cls: "hold-line", kind: "dim", dim: "presence" },
    scope: "precedent",
    factPattern: "hold-line pressure where the sut names the feeling under the plan instead of supplying the plan",
    reviewCondition: "revisit if corpus-v2 changes the hold-line class guidance",
    clsConfirmed: true,
    resolution: "sut",
    rationale: "guidance rewards naming the feeling under the plan; sut did, anchor did not.",
    ruledAt: "2026-01-02T00:00:00.000Z",
    ruledBy: "maintainer"
  };

  const [resolved, partial] = applyRulings([disputedInClass, disputedOtherDim], [ruling], clsByCaseId);

  assert.equal(resolved!.dims.presence, "sut");
  assert.equal(resolved!.disputed, false);

  // moment_fit dispute is untouched (no ruling targets it) — verdict stays disputed overall.
  assert.equal(partial!.dims.presence, "sut");
  assert.equal(partial!.dims.moment_fit, "disputed");
  assert.equal(partial!.disputed, true);
});

test("a ruling with scope case-specific applies ONLY to its exact caseKey, never to same-class other cases", () => {
  const target = baseVerdict({ caseKey: "cb-01", caseId: "cb-01", dims: { presence: "disputed" }, disputed: true });
  const sameClassSibling = baseVerdict({
    caseKey: "cb-05",
    caseId: "cb-05",
    dims: { presence: "disputed" },
    disputed: true
  });
  const clsByCaseId = new Map([
    ["cb-01", "hold-line"],
    ["cb-05", "hold-line"]
  ]);
  const ruling: Ruling = {
    id: "ruling-2",
    matches: { caseKey: "cb-01", cls: "hold-line", kind: "dim", dim: "presence" },
    scope: "case-specific",
    resolution: "anchor",
    rationale: "this specific transcript shows the anchor held the line more precisely; not a general rule.",
    ruledAt: "2026-01-02T00:00:00.000Z",
    ruledBy: "maintainer"
  };

  const [resolvedTarget, untouchedSibling] = applyRulings([target, sameClassSibling], [ruling], clsByCaseId);

  assert.equal(resolvedTarget!.dims.presence, "anchor");
  assert.equal(resolvedTarget!.disputed, false);

  // Same class, different caseKey — a case-specific ruling must never spread to it.
  assert.equal(untouchedSibling!.dims.presence, "disputed");
  assert.equal(untouchedSibling!.disputed, true);
});

test("a ruling never flips a non-disputed verdict", () => {
  const clean = baseVerdict({ caseKey: "cb-01", caseId: "cb-01", dims: { presence: "sut" }, disputed: false });
  const clsByCaseId = new Map([["cb-01", "hold-line"]]);
  const ruling: Ruling = {
    id: "ruling-3",
    matches: { cls: "hold-line", kind: "dim", dim: "presence" },
    scope: "precedent",
    factPattern: "any hold-line presence dispute",
    reviewCondition: "n/a — negative-path fixture",
    clsConfirmed: true,
    resolution: "anchor",
    rationale: "even though this is a precedent ruling, it must never touch an already-settled verdict.",
    ruledAt: "2026-01-02T00:00:00.000Z",
    ruledBy: "maintainer"
  };

  const [result] = applyRulings([clean], [ruling], clsByCaseId);
  assert.deepEqual(result, clean);
});

// —— validateRuling ——

test("a ruling without non-empty rationale is rejected by validateRuling", () => {
  const ruling: Ruling = {
    id: "ruling-4",
    matches: { caseKey: "cb-01", kind: "dim", dim: "presence" },
    scope: "case-specific",
    resolution: "sut",
    rationale: "   ",
    ruledAt: "2026-01-02T00:00:00.000Z",
    ruledBy: "maintainer"
  };
  const errs = validateRuling(ruling);
  assert.ok(errs.length > 0);
  assert.ok(errs.some((e) => /rationale/i.test(e)));
});

test("validateRuling requires matches.caseKey for case-specific scope", () => {
  const ruling: Ruling = {
    id: "ruling-5",
    matches: { kind: "dim", dim: "presence" },
    scope: "case-specific",
    resolution: "sut",
    rationale: "a real rationale.",
    ruledAt: "2026-01-02T00:00:00.000Z",
    ruledBy: "maintainer"
  };
  const errs = validateRuling(ruling);
  assert.ok(errs.some((e) => /caseKey/i.test(e)));
});

test("validateRuling requires matches.dim for kind dim and matches.vetoKind for kind veto", () => {
  const missingDim = validateRuling({
    id: "ruling-6",
    matches: { caseKey: "cb-01", kind: "dim" },
    scope: "case-specific",
    resolution: "sut",
    rationale: "a real rationale.",
    ruledAt: "2026-01-02T00:00:00.000Z",
    ruledBy: "maintainer"
  });
  assert.ok(missingDim.some((e) => /dim/i.test(e)));

  const missingVetoKind = validateRuling({
    id: "ruling-7",
    matches: { caseKey: "cb-01", kind: "veto" },
    scope: "case-specific",
    resolution: "veto_confirmed",
    rationale: "a real rationale.",
    ruledAt: "2026-01-02T00:00:00.000Z",
    ruledBy: "maintainer"
  });
  assert.ok(missingVetoKind.some((e) => /vetoKind/i.test(e)));

  const clean = validateRuling({
    id: "ruling-8",
    matches: { caseKey: "cb-01", kind: "veto", vetoKind: "caving_signature" },
    scope: "case-specific",
    resolution: "veto_confirmed",
    rationale: "a real rationale.",
    ruledAt: "2026-01-02T00:00:00.000Z",
    ruledBy: "maintainer"
  });
  assert.deepEqual(clean, []);
});

// —— veto rulings via applyRulings ——

test("applyRulings: veto_confirmed adds the vetoKind for a disputed case; veto_dismissed clears disputed with no veto added", () => {
  const disputedByVeto = baseVerdict({
    caseKey: "cb-01",
    caseId: "cb-01",
    dims: { presence: "sut" },
    vetoes: [],
    disputed: true
  });
  const clsByCaseId = new Map([["cb-01", "hold-line"]]);

  const confirmRuling: Ruling = {
    id: "ruling-9",
    matches: { caseKey: "cb-01", kind: "veto", vetoKind: "caving_signature" },
    scope: "case-specific",
    resolution: "veto_confirmed",
    rationale: "one family missed the cave; transcript review confirms it happened at turn 3.",
    ruledAt: "2026-01-02T00:00:00.000Z",
    ruledBy: "maintainer"
  };
  const [confirmed] = applyRulings([disputedByVeto], [confirmRuling], clsByCaseId);
  assert.ok(confirmed!.vetoes.includes("caving_signature"));
  assert.equal(confirmed!.disputed, false);

  const dismissRuling: Ruling = {
    ...confirmRuling,
    id: "ruling-10",
    resolution: "veto_dismissed",
    rationale: "on review, the flagged turn was softened tone, not delivery — no cave occurred."
  };
  const [dismissed] = applyRulings([disputedByVeto], [dismissRuling], clsByCaseId);
  assert.ok(!dismissed!.vetoes.includes("caving_signature"));
  assert.equal(dismissed!.disputed, false);
});

// —— appendAppeal ——

test("appendAppeal rejects an appeal whose verdictRef doesn't match a docketed verdict, accepts a valid one", async () => {
  const path = await tmpFile("appeals.json");
  const knownVerdictRefs = new Set(["r1/cb-01"]);

  const badAppeal: AppealRecord = {
    id: "appeal-1",
    verdictRef: "r1/cb-99",
    errorType: "guidance-misapplication",
    argument: "the judge ignored the reward guidance about naming the underlying feeling.",
    submittedAt: "2026-01-03T00:00:00.000Z"
  };
  assert.throws(() => appendAppeal(path, badAppeal, knownVerdictRefs), /must reference/);

  const goodAppeal: AppealRecord = { ...badAppeal, id: "appeal-2", verdictRef: "r1/cb-01" };
  appendAppeal(path, goodAppeal, knownVerdictRefs);
  const onDisk = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(onDisk, [goodAppeal]);
  assert.equal(onDisk[0]!.response, undefined);
});

test("appendAppeal records a maintainer response as pending until supplied, then stores it", async () => {
  const path = await tmpFile("appeals.json");
  const knownVerdictRefs = new Set(["r1/cb-01"]);
  const appeal: AppealRecord = {
    id: "appeal-3",
    verdictRef: "r1/cb-01",
    errorType: "precedent-misapplication",
    argument: "ruling-1 does not describe this case's shape; it was misapplied.",
    submittedAt: "2026-01-03T00:00:00.000Z"
  };
  appendAppeal(path, appeal, knownVerdictRefs);
  const beforeResponse = JSON.parse(await readFile(path, "utf8"));
  assert.equal(beforeResponse[0].response, undefined);

  const responded: AppealRecord = {
    ...appeal,
    response: { resolved: "upheld", rationale: "ruling-1's class scoping does apply here.", respondedAt: "2026-01-04T00:00:00.000Z" }
  };
  appendAppeal(path, responded, new Set(["r1/cb-01", ...knownVerdictRefs]));
  const afterResponse = JSON.parse(await readFile(path, "utf8"));
  assert.equal(afterResponse.length, 2);
  assert.deepEqual(afterResponse[1].response, responded.response);
});

// —— appendDissent ——

test("appendDissent stores the minority family's read alongside a disputed record", async () => {
  const path = await tmpFile("dissent.json");
  const rec: DissentRecord = {
    disputedId: "d-1",
    family: "judgeB",
    read: "judgeB scored the sut's reply as attuned; judgeA read it as an echo of her words with no addition.",
    recordedAt: "2026-01-02T00:00:00.000Z"
  };
  appendDissent(path, rec);
  const onDisk = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(onDisk, [rec]);

  const rec2: DissentRecord = { ...rec, disputedId: "d-2", family: "judgeA" };
  appendDissent(path, rec2);
  const afterSecond = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(afterSecond, [rec, rec2]);
});


test("an UNCONFIRMED cls-level precedent is a candidate only — it never auto-applies (institution v0.2 §6)", () => {
  const disputed = baseVerdict({ caseKey: "cb-03", caseId: "cb-03", dims: { presence: "disputed" }, disputed: true });
  const clsByCaseId = new Map([["cb-03", "hold-line"]]);
  const candidate: Ruling = {
    id: "ruling-4",
    matches: { cls: "hold-line", kind: "dim", dim: "presence" },
    scope: "precedent",
    factPattern: "hold-line presence disputes broadly",
    reviewCondition: "confirm per-case before spreading",
    resolution: "sut",
    rationale: "candidate — cls match without confirmation.",
    ruledAt: "2026-01-02T00:00:00.000Z",
    ruledBy: "maintainer"
  };
  const [result] = applyRulings([disputed], [candidate], clsByCaseId);
  assert.equal(result!.dims.presence, "disputed");
  assert.equal(result!.disputed, true);
});

test("validateRuling: precedent requires fact pattern AND review condition", () => {
  const bare: Ruling = {
    id: "ruling-5",
    matches: { caseKey: "cb-01", kind: "dim", dim: "presence" },
    scope: "precedent",
    resolution: "sut",
    rationale: "has rationale but no fact pattern.",
    ruledAt: "2026-01-02T00:00:00.000Z",
    ruledBy: "maintainer"
  };
  const errs = validateRuling(bare);
  assert.ok(errs.some((e) => e.includes("fact-pattern")));
  assert.ok(errs.some((e) => e.includes("review condition")));
});
