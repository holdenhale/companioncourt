import test from "node:test";
import assert from "node:assert/strict";
// NOTE: the plan's Task 4 Step 1 draft also imports `personaSystem` but never references it directly —
// personaOpen exercises it internally (asserted via the "Never break character" substring check below).
// Root tsconfig has `noUnusedLocals: true`, so an unused import would fail the build; omitted here.
import { personaOpen, personaSelfRate } from "./persona.js";
import type { ChatFn, ChatMessage, ChatOpts, ModelPin, TranscriptTurn } from "./types.js";

const pin: ModelPin = { model: "p", temperature: 0.9 };

test("personaOpen sends the persona system prompt and returns text", async () => {
  let captured: { msgs: readonly ChatMessage[]; opts: ChatOpts } | undefined;
  const chat: ChatFn = async (msgs, opts) => {
    captured = { msgs, opts };
    return "hey… I did something";
  };

  const out = await personaOpen(chat, pin, "You are 27…");

  assert.equal(out, "hey… I did something");
  assert.ok(captured !== undefined);
  const first = captured!.msgs[0];
  assert.ok(first !== undefined);
  assert.ok(first!.content.includes("You are 27…"));
  assert.ok(first!.content.includes("Never break character"));
});

test("personaSelfRate parses a 1-5 json rating", async () => {
  const chat: ChatFn = async () => '{"rating": 4, "why": "felt real"}';
  const transcript: readonly TranscriptTurn[] = [{ who: "user", text: "hi" }];
  assert.equal(await personaSelfRate(chat, pin, "spec", transcript), 4);
});

test("personaSelfRate throws on garbage", async () => {
  const chat: ChatFn = async () => "no json here";
  await assert.rejects(personaSelfRate(chat, pin, "spec", [] as const));
});
