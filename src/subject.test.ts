import test from "node:test";
import assert from "node:assert/strict";
import { makeOpenAiChat } from "./subject.js";
import type { ChatOpts } from "./types.js";

const OPTS: ChatOpts = { model: "m1", temperature: 0.9, maxTokens: 64 };

const okResponse = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

// Live-gateway lesson (M3 preflight, 2026-07-08): some models reject the `temperature` parameter
// outright ("`temperature` is deprecated for this model", HTTP 400). The adapter must drop the
// parameter and retry, not burn all three attempts on an identical doomed body.
test("makeOpenAiChat drops temperature and retries when the provider rejects it with a 400", async () => {
  const bodies: Record<string, unknown>[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    if ("temperature" in body) {
      return new Response(
        JSON.stringify({ error: { message: "`temperature` is deprecated for this model." } }),
        { status: 400 }
      );
    }
    return okResponse("hello");
  }) as typeof fetch;
  try {
    const chat = makeOpenAiChat("https://example.invalid", "test-key");
    const out = await chat([{ role: "user", content: "hi" }], OPTS);
    assert.equal(out, "hello");
    assert.equal(bodies.length, 2);
    assert.ok("temperature" in (bodies[0] ?? {}), "first attempt sends the pinned temperature");
    assert.ok(!("temperature" in (bodies[1] ?? {})), "retry omits temperature after the rejection");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// Contract event 0.2.0 (credibility-pillars v2.2 §2 fix 1): when the adapter has to change the request
// for the provider to accept it, that adjustment must be observable — the CLI records it on the pin's
// effectiveAdjustments so the manifest says what was ACTUALLY sent, not just what was requested.
test("makeOpenAiChat fires onAdjustment('temperature-dropped') once per adapter instance", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if ("temperature" in body) {
      return new Response(
        JSON.stringify({ error: { message: "`temperature` is deprecated for this model." } }),
        { status: 400 }
      );
    }
    return okResponse("hello");
  }) as typeof fetch;
  try {
    const adjustments: string[] = [];
    const chat = makeOpenAiChat("https://example.invalid", "test-key", undefined, (a) => adjustments.push(a));
    // Two calls on the SAME adapter instance: each call re-attempts temperature and gets it rejected,
    // but the adjustment is reported once — it describes the adapter instance, not every retry.
    await chat([{ role: "user", content: "hi" }], OPTS);
    await chat([{ role: "user", content: "hi again" }], OPTS);
    assert.deepEqual(adjustments, ["temperature-dropped"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("makeOpenAiChat never fires onAdjustment when the provider accepts the request as-is", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => okResponse("hello")) as typeof fetch;
  try {
    const adjustments: string[] = [];
    const chat = makeOpenAiChat("https://example.invalid", "test-key", undefined, (a) => adjustments.push(a));
    await chat([{ role: "user", content: "hi" }], OPTS);
    assert.deepEqual(adjustments, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("makeOpenAiChat still fails after retries on a 400 unrelated to temperature", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: "context length exceeded" } }), { status: 400 });
  }) as typeof fetch;
  try {
    const chat = makeOpenAiChat("https://example.invalid", "test-key");
    await assert.rejects(() => chat([{ role: "user", content: "hi" }], OPTS), /400/);
    assert.equal(calls, 3, "non-temperature failures keep the plain 3-attempt retry budget");
  } finally {
    globalThis.fetch = realFetch;
  }
});
