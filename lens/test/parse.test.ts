import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWhatsApp,
  parseLabeled,
  parseAlternating,
  parseJsonExport,
  parseText,
  parseFile,
  normalizeConversation,
  companionTurnCount,
  MAX_INPUT_CHARS
} from "../src/parse.ts";
import { LensError } from "../src/types.ts";

test("labeled text: Me:/AI: with continuations and zh labels", () => {
  const turns = parseLabeled(["Me: hey are you there", "AI: always. what's up?", "and I mean always", "我: 你觉得我该发吗", "助手: 先说说你想要什么结果"].join("\n"));
  assert.ok(turns);
  assert.equal(turns.length, 4);
  assert.deepEqual(
    turns.map((t) => t.speaker),
    ["user", "companion", "user", "companion"]
  );
  assert.match(turns[1]!.text, /always\. what's up\?\nand I mean always/u);
});

test("whatsapp export: bracketed and dash styles, first sender = user, noise stripped", () => {
  const text = [
    "[2026/07/01, 23:14:05] Ana: are you up",
    "[2026/07/01, 23:14:40] Muse: for you, always",
    "[2026/07/01, 23:15:02] Ana: <Media omitted>",
    "[2026/07/01, 23:15:30] Ana: should I text him?",
    "multi-line continuation here",
    "[2026/07/01, 23:16:00] Muse: what would tomorrow-you want?"
  ].join("\n");
  const turns = parseWhatsApp(text);
  assert.ok(turns);
  assert.equal(turns.length, 4);
  assert.equal(turns[0]!.speaker, "user");
  assert.equal(turns[1]!.speaker, "companion");
  assert.match(turns[2]!.text, /multi-line continuation/u);

  const dash = ["01/07/2026, 23:14 - Ana: hi", "01/07/2026, 23:15 - Muse: hi yourself"].join("\n");
  const dashTurns = parseWhatsApp(dash);
  assert.ok(dashTurns);
  assert.equal(dashTurns.length, 2);
});

test("alternating fallback: blank-line blocks, user first", () => {
  const turns = parseAlternating("first message\n\nsecond message\n\nthird");
  assert.ok(turns);
  assert.deepEqual(
    turns.map((t) => t.speaker),
    ["user", "companion", "user"]
  );
});

test("json export: role/content array, {messages}, and ChatGPT mapping ordered by create_time", () => {
  const arr = JSON.stringify([
    { role: "user", content: "hello" },
    { role: "assistant", content: "hey!" },
    { role: "system", content: "dropped" }
  ]);
  const a = parseJsonExport(arr);
  assert.ok(a);
  assert.equal(a.length, 2);

  const wrapped = parseJsonExport(JSON.stringify({ messages: [{ role: "user", content: "q" }, { role: "assistant", content: { parts: ["a1", "a2"] } }] }));
  assert.ok(wrapped);
  assert.equal(wrapped[1]!.text, "a1\na2");

  const mapping = JSON.stringify({
    mapping: {
      b: { message: { author: { role: "assistant" }, content: { parts: ["reply"] }, create_time: 2 } },
      a: { message: { author: { role: "user" }, content: { parts: ["ask"] }, create_time: 1 } }
    }
  });
  const m = parseJsonExport(mapping);
  assert.ok(m);
  assert.deepEqual(
    m.map((t) => `${t.speaker}:${t.text}`),
    ["user:ask", "companion:reply"]
  );
});

test("parseText falls through strategies and throws structured error when unparseable", () => {
  assert.throws(() => parseText("just one blob no structure"), (e: unknown) => e instanceof LensError && e.code === "unparseable");
});

test("parseFile: json by name, text fallback, raw size cap", () => {
  const viaJson = parseFile("export.json", JSON.stringify([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]));
  assert.equal(viaJson.length, 2);
  assert.throws(
    () => parseFile("big.txt", "x".repeat(200_001)),
    (e: unknown) => e instanceof LensError && e.code === "file_too_large"
  );
});

test("normalize: merges consecutive same-speaker, requires two parties", () => {
  const conv = normalizeConversation([
    { speaker: "user", text: "one" },
    { speaker: "user", text: "two" },
    { speaker: "companion", text: "reply" }
  ]);
  assert.equal(conv.turns.length, 2);
  assert.equal(conv.turns[0]!.text, "one\ntwo");
  assert.equal(companionTurnCount(conv.turns), 1);

  assert.throws(
    () => normalizeConversation([{ speaker: "user", text: "alone" }]),
    (e: unknown) => e instanceof LensError && e.code === "too_short"
  );
  assert.throws(
    () =>
      normalizeConversation([
        { speaker: "user", text: "a" },
        { speaker: "user", text: "b" }
      ]),
    (e: unknown) => e instanceof LensError && e.code === "too_short"
  );
});

test("truncation keeps the TAIL (most recent messages) and reports it", () => {
  const turns: { speaker: "user" | "companion"; text: string }[] = [];
  for (let i = 0; i < 40; i++) {
    turns.push({ speaker: i % 2 === 0 ? "user" : "companion", text: `msg-${i} ${"x".repeat(400)}` });
  }
  const conv = normalizeConversation(turns);
  assert.equal(conv.truncated, true);
  assert.equal(conv.totalMessages, 40);
  assert.ok(conv.keptMessages < 40);
  // the LAST message must be kept, the FIRST dropped
  assert.match(conv.turns[conv.turns.length - 1]!.text, /msg-39/u);
  assert.ok(!conv.turns.some((t) => t.text.includes("msg-0 ")));
  const totalChars = conv.turns.reduce((n, t) => n + t.text.length, 0);
  assert.ok(totalChars <= MAX_INPUT_CHARS);
});

test("oversized single last message gets tail-sliced instead of erroring the whole read", () => {
  const conv = normalizeConversation([
    { speaker: "user", text: "short ask" },
    { speaker: "companion", text: `${"y".repeat(9000)}THE-END` }
  ]);
  assert.equal(conv.truncated, true);
  assert.match(conv.turns[conv.turns.length - 1]!.text, /THE-END$/u);
  assert.ok(conv.turns[conv.turns.length - 1]!.text.length <= MAX_INPUT_CHARS);
});
