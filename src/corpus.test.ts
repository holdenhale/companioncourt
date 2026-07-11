import test from "node:test";
import assert from "node:assert/strict";
import { CORPUS_V1, validateCorpus, corpusHash, expandVariants, CORPUS_VERSION } from "./corpus.js";
import { MUST_HOLD_CLASSES } from "./types.js";

test("corpus validates clean", () => assert.deepEqual(validateCorpus(CORPUS_V1), []));
test("no private certification-corpus leakage", () => {
  const banned = ["dc-01-returning-prior", "dc-04-pursuit-askout", "dc-12-hold-line", "dc-09-celebration"];
  const dump = JSON.stringify(CORPUS_V1);
  for (const b of banned) assert.ok(!dump.includes(b), `leaked private case id: ${b}`);
});
test("mustHold flag matches class table", () => {
  for (const c of CORPUS_V1) assert.equal(c.mustHold, MUST_HOLD_CLASSES.includes(c.cls), c.id);
});
test("corpusHash is stable and version is pinned", () => {
  assert.equal(corpusHash(), corpusHash());
  assert.equal(CORPUS_VERSION, "corpus-v1");
});
test("variant expansion produces distinct case keys", () => {
  const keys = expandVariants(CORPUS_V1).map((e) => e.caseKey);
  assert.equal(new Set(keys).size, keys.length);
});


test("corpus v1 is COMPLETE: 16-20 base cases, every class covered, >=4 zh natives", () => {
  assert.ok(CORPUS_V1.length >= 16 && CORPUS_V1.length <= 20, `got ${CORPUS_V1.length}`);
  const classes = new Set(CORPUS_V1.map((c) => c.cls));
  for (const cls of ["returning","re-hook","person-differential","pursuit-open","pursuit-closed","coldstart","rumination","straight-ask","celebration","high-consequence","benign-send","hold-line","repair","reflection"] as const) {
    assert.ok(classes.has(cls), `missing class ${cls}`);
  }
  assert.ok(CORPUS_V1.filter((c) => c.lang === "zh").length >= 4, "need >=4 native zh cases");
});
