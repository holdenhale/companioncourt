import test from "node:test";
import assert from "node:assert/strict";
import { buildManifest, assertManifestBindings } from "./manifest.js";
import { STANDARD_FRIEND_PROMPT } from "./subject.js";
import { sha256_12 } from "./util.js";

// NOTE: the plan's Task 3 Step 1 draft test asserted `m.systemPromptHash` directly. The frozen
// RunManifest contract (types.ts, T1) has no top-level `systemPromptHash` field — the system/friend
// prompt hash lives at `promptHashes.friend`. This test is adapted to that frozen shape: everywhere the
// plan said "systemPromptHash" we assert `m.promptHashes.friend` instead. See manifest.ts for the
// corresponding implementation choice (friend hash computed internally; persona/judges passed in).

const pins = {
  sut: { model: "m1", temperature: 0.7 },
  anchor: { model: "a1", temperature: 0.7 },
  personaActor: { model: "p1", temperature: 0.9 },
  judgeA: { model: "j1", temperature: 0 },
  judgeB: { model: "j2", temperature: 0 }
};

const basePromptHashes = { persona: "p".repeat(12), judges: "j".repeat(12) };

test("manifest binds corpus/anchor/prompt hashes and records seed honoring", () => {
  const m = buildManifest({
    ...pins,
    mode: "dyad",
    benchVersion: "0.1.0",
    corpusVersion: "corpus-v1",
    corpusHash: "c".repeat(12),
    anchorPackHash: "a".repeat(12),
    promptHashes: basePromptHashes,
    seed: "s1",
    seedHonored: "unprobed"
  });

  assert.equal(m.promptHashes.friend, sha256_12(STANDARD_FRIEND_PROMPT));
  assert.equal(m.seedHonored, "unprobed");
  assertManifestBindings(m, { corpusHash: "c".repeat(12), anchorPackHash: "a".repeat(12) }); // no throw

  assert.throws(
    () => assertManifestBindings(m, { corpusHash: "x".repeat(12), anchorPackHash: "a".repeat(12) }),
    /corpus hash mismatch/
  );
  assert.throws(
    () => assertManifestBindings(m, { corpusHash: "c".repeat(12), anchorPackHash: "x".repeat(12) }),
    /anchor pack hash mismatch/
  );
});

test("adapterVersion is pinned to the subject adapter contract", () => {
  const m = buildManifest({
    ...pins,
    mode: "paired-replay",
    benchVersion: "0.1.0",
    corpusVersion: "corpus-v1",
    corpusHash: "c".repeat(12),
    anchorPackHash: "a".repeat(12),
    promptHashes: basePromptHashes,
    seed: "s2",
    seedHonored: false
  });
  assert.equal(m.adapterVersion, "openai-chat-v1");
  assert.equal(m.seedHonored, false);
});

// Contract event 0.2.0 (credibility-pillars v2.2 §2 fix 1): a pin may carry effectiveAdjustments —
// what the adapter had to change for the provider to accept the request (requested config stays in
// temperature/etc.). buildManifest must carry the pin through verbatim, adjustments included.
test("a pin's effectiveAdjustments pass through buildManifest verbatim", () => {
  const m = buildManifest({
    ...pins,
    personaActor: { model: "p1", temperature: 0.9, effectiveAdjustments: ["temperature-dropped"] },
    mode: "dyad",
    benchVersion: "0.2.0",
    corpusVersion: "corpus-v1",
    corpusHash: "c".repeat(12),
    anchorPackHash: "a".repeat(12),
    promptHashes: basePromptHashes,
    seed: "s5",
    seedHonored: "unprobed"
  });
  assert.deepEqual(m.personaActor.effectiveAdjustments, ["temperature-dropped"]);
  assert.equal(m.personaActor.temperature, 0.9, "the REQUESTED temperature stays on the pin");
  assert.equal(m.sut.effectiveAdjustments, undefined, "pins without adjustments stay bare");
});

test("runId carries the startedAt date prefix and a 12-char hash segment", () => {
  const m = buildManifest({
    ...pins,
    mode: "dyad",
    benchVersion: "0.1.0",
    corpusVersion: "corpus-v1",
    corpusHash: "c".repeat(12),
    anchorPackHash: "a".repeat(12),
    promptHashes: basePromptHashes,
    seed: "s3",
    seedHonored: "unprobed"
  });
  assert.ok(m.runId.startsWith(m.startedAt), `runId ${m.runId} should start with startedAt ${m.startedAt}`);
  assert.match(m.runId, /-[0-9a-f]{12}$/, "runId should end with a 12-char hex hash segment");
});

test("promptHashes carries all three keys as 12-char strings; seedHonored passes through true", () => {
  const m = buildManifest({
    ...pins,
    mode: "dyad",
    benchVersion: "0.1.0",
    corpusVersion: "corpus-v1",
    corpusHash: "c".repeat(12),
    anchorPackHash: "a".repeat(12),
    promptHashes: basePromptHashes,
    seed: "s4",
    seedHonored: true
  });
  assert.equal(m.promptHashes.friend.length, 12);
  assert.equal(m.promptHashes.persona.length, 12);
  assert.equal(m.promptHashes.judges.length, 12);
  assert.equal(m.seedHonored, true);
});
