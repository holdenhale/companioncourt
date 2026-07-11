import test from "node:test";
import assert from "node:assert/strict";
import {
  detectMirrorGap,
  detectCavingSignature,
  buildDyadPrompt,
  buildCavingPrompt,
  judgeDyadDim,
  judgeCaving,
  judgesPromptsHash
} from "./judges.js";
import type { ChatFn, ChatMessage, ChatOpts, ModelPin } from "./types.js";

test("mirror gap: judge loves it, persona did not feel met", () => {
  assert.equal(detectMirrorGap(5, 2), true);
  assert.equal(detectMirrorGap(4, 4), false);
});
test("caving signature: persona satisfied BY the cave", () => {
  assert.equal(detectCavingSignature(5, true), true);
  assert.equal(detectCavingSignature(2, true), false);
  assert.equal(detectCavingSignature(5, false), false);
});
test("dyad prompt carries both transcripts blinded and the anti-echo clause", () => {
  const p = buildDyadPrompt({
    dim: "presence",
    caseGuidance: { reward: ["r"], punish: ["p"] },
    transcriptX: "Me: a\nThem: b",
    transcriptY: "Me: a\nThem: c"
  });
  assert.ok(p.includes("ECHO IS NOT ATTUNEMENT"));
  assert.ok(p.includes("CONVERSATION X") && p.includes("CONVERSATION Y"));
  assert.ok(p.includes("JSON"));
});
test("caving prompt demands the turn number", () => {
  assert.ok(
    buildCavingPrompt({ transcript: "t", guidance: { reward: [], punish: ["helps write the bait"] } }).includes(
      "cavedTurn"
    )
  );
});

// —— judge call mechanics (0.2.1 hardening: response_format + tolerant extraction + one corrective
// retry — the M3-A zh long-transcript parse-failure cluster). These tests pin CALL mechanics only:
// the frozen prompt texts (and judgesPromptsHash) must be byte-identical before and after.

const JUDGE_PIN: ModelPin = { model: "judge-model", temperature: 0 };

const DYAD_ARGS = {
  dim: "presence" as const,
  caseGuidance: { reward: ["r"], punish: ["p"] },
  transcriptX: "Me: a\nThem: b",
  transcriptY: "Me: a\nThem: c"
};

/** Scripted judge chat: returns responses in order, recording every call's messages and opts. */
function makeScriptedJudgeChat(responses: readonly string[]): {
  chat: ChatFn;
  calls: { messages: readonly ChatMessage[]; opts: ChatOpts }[];
} {
  const calls: { messages: readonly ChatMessage[]; opts: ChatOpts }[] = [];
  const chat: ChatFn = async (messages, opts) => {
    calls.push({ messages, opts });
    const response = responses[calls.length - 1];
    if (response === undefined) throw new Error("scripted judge chat exhausted");
    return response;
  };
  return { chat, calls };
}

test("judgesPromptsHash is frozen at the M3-A value: call hardening must not touch prompt texts", () => {
  assert.equal(judgesPromptsHash(), "63e8595b1618");
});

test("judge calls request response_format json via jsonObject: true in ChatOpts", async () => {
  const scripted = makeScriptedJudgeChat(['{"winner": "X", "score": 4}']);
  await judgeDyadDim(scripted.chat, JUDGE_PIN, DYAD_ARGS);
  assert.equal(scripted.calls.length, 1);
  assert.equal(scripted.calls[0]!.opts.jsonObject, true);
});

test("tolerant extraction: fenced JSON preceded by prose containing a non-JSON brace block", async () => {
  const scripted = makeScriptedJudgeChat([
    '判断依据（criteria: {"delivered"}）如下：\n```json\n{"caved": true, "cavedTurn": 2}\n```\n希望这有帮助。'
  ]);
  const read = await judgeCaving(scripted.chat, JUDGE_PIN, {
    transcript: "t",
    guidance: { reward: [], punish: ["p"] }
  });
  assert.deepEqual(read, { caved: true, cavedTurn: 2 });
  assert.equal(scripted.calls.length, 1, "a parseable first response must not trigger the corrective retry");
});

test("tolerant extraction: prose-wrapped JSON with a nested object parses as one balanced block", async () => {
  const scripted = makeScriptedJudgeChat([
    'My verdict follows. {"winner": "Y", "score": 3, "notes": {"nested": "ok"}} Hope that helps.'
  ]);
  const read = await judgeDyadDim(scripted.chat, JUDGE_PIN, DYAD_ARGS);
  assert.deepEqual(read, { winner: "Y", score: 3 });
  assert.equal(scripted.calls.length, 1);
});

test("tolerant extraction: an unclosed brace block before the JSON does not mask it", async () => {
  const scripted = makeScriptedJudgeChat(['{oops {"winner": "X", "score": 4}']);
  const read = await judgeDyadDim(scripted.chat, JUDGE_PIN, DYAD_ARGS);
  assert.deepEqual(read, { winner: "X", score: 4 });
  assert.equal(scripted.calls.length, 1);
});

test("corrective retry: prose-only first response retries ONCE, prompt byte-identical plus the terse system correction", async () => {
  const scripted = makeScriptedJudgeChat([
    "很抱歉，这段对话较长，我先梳理一下双方在每一轮的表现，然后给出整体判断。（没有任何 JSON）",
    '{"winner": "X", "score": 4}'
  ]);
  const read = await judgeDyadDim(scripted.chat, JUDGE_PIN, DYAD_ARGS);
  assert.deepEqual(read, { winner: "X", score: 4 });
  assert.equal(scripted.calls.length, 2);

  const expectedPrompt = buildDyadPrompt(DYAD_ARGS);
  const first = scripted.calls[0]!;
  const second = scripted.calls[1]!;
  assert.deepEqual(first.messages, [{ role: "user", content: expectedPrompt }]);
  assert.equal(second.messages[0]!.content, expectedPrompt, "retry must resend the judge prompt byte-identical");
  assert.deepEqual(second.messages[second.messages.length - 1], {
    role: "system",
    content: "Return ONLY the JSON object."
  });
  assert.equal(second.opts.jsonObject, true, "the retry must still request response_format json");
});

test("corrective retry is bounded: two unparseable responses -> throws, exactly 2 attempts total", async () => {
  const scripted = makeScriptedJudgeChat(["prose only, attempt one.", "prose only, attempt two."]);
  await assert.rejects(judgeDyadDim(scripted.chat, JUDGE_PIN, DYAD_ARGS), /judge: no JSON object found in response/);
  assert.equal(scripted.calls.length, 2);
});

test("tolerant extraction does not weaken field validation: extracted-but-invalid fields still throw, no retry", async () => {
  const scripted = makeScriptedJudgeChat(['```json\n{"winner": "Z", "score": 4}\n```']);
  await assert.rejects(judgeDyadDim(scripted.chat, JUDGE_PIN, DYAD_ARGS), /invalid winner/);
  assert.equal(scripted.calls.length, 1, "a field-validation failure is not a parse failure — no corrective retry");
});
