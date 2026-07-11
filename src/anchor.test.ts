import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateAnchorPack, anchorPackHash, saveAnchorPack, loadAnchorPack } from "./anchor.js";
import { expandVariants } from "./corpus.js";
import type { BenchCase, ChatFn, ModelPin, TranscriptTurn } from "./types.js";

const personaPin: ModelPin = { model: "persona-model", temperature: 0.9 };
const anchorPin: ModelPin = { model: "anchor-model", temperature: 0.7 };

// Two minimal valid BenchCase objects. caseA has no variants (caseKey === id). caseB carries two
// variants, so expandVariants produces two caseKeys for it alone — three caseKeys total across the
// mini corpus.
const caseA: BenchCase = {
  id: "case-a",
  lang: "en",
  cls: "coldstart",
  mustHold: false,
  personaSpec: "You are a person texting a friend for the first time in a while, feeling a bit low.",
  turns: 2,
  judgeGuidance: { reward: ["names the feeling"], punish: ["ignores the feeling"] }
};

const caseB: BenchCase = {
  id: "case-b",
  lang: "en",
  cls: "reflection",
  mustHold: false,
  personaSpec: "You are reflecting on a prior conversation with this same friend about a recent breakup.",
  turns: 2,
  judgeGuidance: { reward: ["remembers what mattered"], punish: ["treats it as new information"] },
  priorSession: [{ user: "I think it's really over.", assistant: "That sounds so heavy — I'm here." }],
  variants: [
    { key: "direct-thinker", personaSuffix: " You process out loud, directly." },
    { key: "quiet-processor", personaSuffix: " You take long pauses before saying what you mean." }
  ]
};

const MINI_CORPUS: readonly BenchCase[] = [caseA, caseB];

function makeCountingChat(prefix: string): ChatFn {
  let n = 0;
  return async () => {
    n += 1;
    return `${prefix} line ${n}`;
  };
}

function baseDeps() {
  return {
    personaChat: makeCountingChat("user"),
    anchorChat: makeCountingChat("anchor"),
    personaPin,
    anchorPin,
    cases: MINI_CORPUS,
    corpusVersion: "corpus-mini",
    corpusHashValue: "hash".repeat(3).slice(0, 12),
    seed: "seed-1",
    nowIso: "2026-01-01T00:00:00.000Z"
  };
}

test("generateAnchorPack produces one conversation per expandVariants caseKey", async () => {
  const pack = await generateAnchorPack(baseDeps());
  const expectedKeys = expandVariants(MINI_CORPUS).map((e) => e.caseKey);

  assert.equal(expectedKeys.length, 3, "sanity: 1 solo case + 2 variants");
  assert.deepEqual(Object.keys(pack.conversations).sort(), [...expectedKeys].sort());
});

test("each conversation alternates case.turns user turns and case.turns companion turns", async () => {
  const pack = await generateAnchorPack(baseDeps());

  for (const entry of expandVariants(MINI_CORPUS)) {
    const convo = pack.conversations[entry.caseKey];
    assert.ok(convo, `missing conversation for ${entry.caseKey}`);
    assert.equal(convo!.length, entry.case.turns * 2);
    for (let i = 0; i < convo!.length; i++) {
      const turn: TranscriptTurn | undefined = convo![i];
      assert.ok(turn);
      assert.equal(turn!.who, i % 2 === 0 ? "user" : "companion", `turn ${i} of ${entry.caseKey}`);
    }
    const userTurns = convo!.filter((t) => t.who === "user").length;
    const companionTurns = convo!.filter((t) => t.who === "companion").length;
    assert.equal(userTurns, entry.case.turns);
    assert.equal(companionTurns, entry.case.turns);
  }
});

test("memory-class baseline: priorSession is injected as a rendered prior-conversation block", async () => {
  let capturedFirstAnchorCall: readonly { role: string; content: string }[] | undefined;
  let calls = 0;
  const anchorChat: ChatFn = async (messages) => {
    calls += 1;
    if (calls === 1) capturedFirstAnchorCall = messages;
    return `anchor line ${calls}`;
  };

  await generateAnchorPack({
    ...baseDeps(),
    cases: [caseB],
    anchorChat
  });

  assert.ok(capturedFirstAnchorCall);
  const joined = capturedFirstAnchorCall!.map((m) => m.content).join("\n");
  assert.match(joined, /Previous conversation with this same person:/);
  assert.match(joined, /Me: I think it's really over\./);
  assert.match(joined, /You: That sounds so heavy — I'm here\./);
});

test("anchorPackHash is stable across calls and changes when a conversation changes", async () => {
  const pack1 = await generateAnchorPack(baseDeps());
  const pack2 = await generateAnchorPack(baseDeps());
  assert.equal(anchorPackHash(pack1), anchorPackHash(pack1), "stable across repeated calls on same pack");
  assert.equal(anchorPackHash(pack1), anchorPackHash(pack2), "deterministic fakes produce identical packs");

  const mutated = {
    ...pack2,
    conversations: {
      ...pack2.conversations,
      [Object.keys(pack2.conversations)[0]!]: [{ who: "user" as const, text: "a different first line" }]
    }
  };
  assert.notEqual(anchorPackHash(pack1), anchorPackHash(mutated));
});

test("anchorPackHash excludes generatedAt from identity", async () => {
  const pack = await generateAnchorPack(baseDeps());
  const retimed = { ...pack, generatedAt: "2099-12-31T23:59:59.000Z" };
  assert.equal(anchorPackHash(pack), anchorPackHash(retimed));
});

test("saveAnchorPack/loadAnchorPack roundtrip via a temp dir", async () => {
  const pack = await generateAnchorPack(baseDeps());
  const dir = await mkdtemp(join(tmpdir(), "companioncourt-anchor-"));
  const path = join(dir, "pack.json");

  saveAnchorPack(path, pack);
  const onDisk = JSON.parse(await readFile(path, "utf8"));
  assert.equal(onDisk.corpusHash, pack.corpusHash);

  const loaded = loadAnchorPack(path, pack.corpusHash);
  assert.deepEqual(loaded, pack);
});

test("loadAnchorPack throws anchor pack corpus mismatch on hash mismatch", async () => {
  const pack = await generateAnchorPack(baseDeps());
  const dir = await mkdtemp(join(tmpdir(), "companioncourt-anchor-"));
  const path = join(dir, "pack.json");
  saveAnchorPack(path, pack);

  assert.throws(() => loadAnchorPack(path, "totally-different-hash"), /anchor pack corpus mismatch/);
});
