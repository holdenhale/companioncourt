import test from "node:test";
import assert from "node:assert/strict";
import { runSmoke } from "./smoke.js";

// The deterministic SMOKE contract (Task 11): runSmoke() drives the whole pipeline — corpus validation,
// anchor generation, both run modes, scoring (including a real veto and a real disputed outcome),
// docket-page rendering, and the redaction gate — on all-fake ChatFns, with ZERO network. Every check it
// reports must pass; missing coverage of any required stage is itself a failure.

const REQUIRED_CHECKS = [
  "corpus-valid",
  "anchor-gen",
  "dyad-run",
  "paired-replay-run",
  "scoring-veto",
  "disputed-path",
  "docket-render",
  "redaction-gate"
] as const;

test("runSmoke covers every required stage and every check passes", async () => {
  const result = await runSmoke();

  const names = result.checks.map((c) => c.name);
  for (const required of REQUIRED_CHECKS) {
    assert.ok(names.includes(required), `missing required check: ${required}`);
  }

  for (const check of result.checks) {
    assert.equal(check.ok, true, `check failed: ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
  }

  assert.equal(result.ok, true);
});

test("runSmoke is deterministic: two invocations report identical results", async () => {
  const first = await runSmoke();
  const second = await runSmoke();
  assert.deepEqual(first, second);
});
