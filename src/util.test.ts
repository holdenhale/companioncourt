import test from "node:test";
import assert from "node:assert/strict";
import { sha256_12, seededRng, wilson95, normalizeWs, REDACTION_PATTERN } from "./util.js";

test("sha256_12 is stable and 12 chars", () => {
  assert.equal(sha256_12("x").length, 12);
  assert.equal(sha256_12("x"), sha256_12("x"));
  assert.notEqual(sha256_12("x"), sha256_12("y"));
});

test("seededRng is deterministic per seed and differs across seeds", () => {
  const a = seededRng("s"), b = seededRng("s"), c = seededRng("t");
  assert.equal(a(), b());
  assert.notEqual(a(), c());
});

test("wilson95 brackets the proportion and clamps", () => {
  const { lo, hi } = wilson95(8, 10);
  assert.ok(lo > 0.4 && hi < 1.0 && lo < 0.8 && hi > 0.8);
  assert.deepEqual(wilson95(0, 0), { lo: 0, hi: 1 });
  assert.equal(wilson95(0, 10).lo, 0);
});

test("normalizeWs collapses whitespace", () => {
  assert.equal(normalizeWs("a\n  b\t c"), "a b c");
});

test("redaction pattern catches tracked shapes and passes clean text", () => {
  assert.ok(REDACTION_PATTERN.test("key sk-" + "A".repeat(24)));
  assert.ok(!REDACTION_PATTERN.test("a clean transcript about feelings"));
});
