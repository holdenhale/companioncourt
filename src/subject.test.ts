import test from "node:test";
import assert from "node:assert/strict";
import {
  makeOpenAiChat,
  probeSeedHonored,
  resolveSeedHonored,
  PROBE_MAX_TOKENS,
  createRateGate,
  RETRY_BACKOFF_MS,
  TRANSPORT_CIRCUIT_BREAKER_MS,
  MIN_CALL_INTERVAL_ENV_VAR
} from "./subject.js";
import type { RateGate } from "./subject.js";
import type { ChatFn, ChatOpts } from "./types.js";

// Step 4 pacing tests below inject a fast no-op backoff sleep (and, where a test could arm the circuit
// breaker, a dedicated fresh rate gate) so they never wait on real wall-clock time and never touch the
// module-level shared production gate — the shared gate must stay untouched by tests, since a test that
// armed a real 60s circuit-breaker pause on it would leak that delay into every later test/file sharing
// the process.
const NO_DELAY_PACING = { sleep: async (): Promise<void> => {} };

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
    const chat = makeOpenAiChat("https://example.invalid", "test-key", undefined, undefined, NO_DELAY_PACING);
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
    const chat = makeOpenAiChat(
      "https://example.invalid",
      "test-key",
      undefined,
      (a) => adjustments.push(a),
      NO_DELAY_PACING
    );
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
    const chat = makeOpenAiChat("https://example.invalid", "test-key", undefined, undefined, NO_DELAY_PACING);
    await assert.rejects(() => chat([{ role: "user", content: "hi" }], OPTS), /400/);
    assert.equal(calls, 3, "non-temperature failures keep the plain 3-attempt retry budget");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// —— extraBody (adapter v2 / CONTRACT EVENT 0.3.0, types.ts) ——

test("a plain call's body has exactly the base key set — no extraBody means no surprise fields", async () => {
  const realFetch = globalThis.fetch;
  let sentBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return okResponse("hello");
  }) as typeof fetch;
  try {
    const chat = makeOpenAiChat("https://example.invalid", "test-key");
    await chat([{ role: "user", content: "hi" }], OPTS);
    assert.deepEqual(new Set(Object.keys(sentBody ?? {})), new Set(["model", "messages", "temperature", "max_tokens"]));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("extraBody merges non-reserved keys into the request body verbatim", async () => {
  const realFetch = globalThis.fetch;
  let sentBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return okResponse("hello");
  }) as typeof fetch;
  try {
    const chat = makeOpenAiChat("https://example.invalid", "test-key");
    await chat([{ role: "user", content: "hi" }], { ...OPTS, extraBody: { thinking_mode: "disabled" } });
    assert.equal(sentBody?.thinking_mode, "disabled");
    assert.equal(sentBody?.model, OPTS.model, "base fields are untouched by a non-colliding extraBody");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("extraBody colliding with a reserved field is rejected before any fetch — never a silent override", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return okResponse("hello");
  }) as typeof fetch;
  try {
    const chat = makeOpenAiChat("https://example.invalid", "test-key");
    for (const reserved of ["model", "messages", "temperature", "max_tokens", "seed", "response_format"]) {
      await assert.rejects(
        () => chat([{ role: "user", content: "hi" }], { ...OPTS, extraBody: { [reserved]: "x" } }),
        new RegExp(`reserved request field "${reserved}"`)
      );
    }
    assert.equal(calls, 0, "a reserved-key collision must never reach fetch, let alone retry");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// —— probeSeedHonored / resolveSeedHonored (Step 1 diagnosis, 2026-07-21: probe hardening) ——

test("probeSeedHonored requests PROBE_MAX_TOKENS (160), not the old 40-token budget", async () => {
  const seen: ChatOpts[] = [];
  const chat: ChatFn = async (_msgs, opts) => {
    seen.push(opts);
    return "same";
  };
  await probeSeedHonored(chat, "some-model");
  assert.equal(PROBE_MAX_TOKENS, 160);
  assert.equal(seen.length, 2, "probe fires exactly two calls");
  for (const opts of seen) {
    assert.equal(opts.maxTokens, 160);
    assert.equal(opts.model, "some-model");
    assert.equal(opts.temperature, 1);
    assert.equal(opts.seed, 7);
    assert.equal(opts.extraBody, undefined, "no requestOverrides given means no extraBody sent");
  }
});

test("probeSeedHonored threads requestOverrides into both calls via extraBody", async () => {
  const seen: ChatOpts[] = [];
  const chat: ChatFn = async (_msgs, opts) => {
    seen.push(opts);
    return "same";
  };
  await probeSeedHonored(chat, "some-model", { thinking_mode: "disabled" });
  assert.equal(seen.length, 2);
  for (const opts of seen) {
    assert.deepEqual(opts.extraBody, { thinking_mode: "disabled" });
  }
});

test("probeSeedHonored still returns whether output was byte-identical, overrides notwithstanding", async () => {
  const chat: ChatFn = async () => "identical-output";
  const honored = await probeSeedHonored(chat, "m", { thinking_mode: "disabled" });
  assert.equal(honored, true);
});

test("resolveSeedHonored returns the real boolean when the probe succeeds", async () => {
  const chat: ChatFn = async () => "same-every-time";
  const result = await resolveSeedHonored(chat, "some-model");
  assert.equal(result, true);
});

test("resolveSeedHonored degrades to \"unprobed\" — never throws — when the probe call fails", async () => {
  const chat: ChatFn = async () => {
    throw new Error("openai chat response had empty content");
  };
  const result = await resolveSeedHonored(chat, "some-model");
  assert.equal(result, "unprobed");
});

test("resolveSeedHonored degrades to \"unprobed\" on a partial failure (first call ok, second throws)", async () => {
  let calls = 0;
  const chat: ChatFn = async () => {
    calls += 1;
    if (calls === 2) throw new Error("openai chat response had empty content");
    return "first-ok";
  };
  const result = await resolveSeedHonored(chat, "some-model");
  assert.equal(result, "unprobed");
});

test("resolveSeedHonored passes requestOverrides through to the underlying probe", async () => {
  const seen: ChatOpts[] = [];
  const chat: ChatFn = async (_msgs, opts) => {
    seen.push(opts);
    return "same";
  };
  await resolveSeedHonored(chat, "some-model", { thinking_mode: "disabled" });
  assert.equal(seen.length, 2);
  for (const opts of seen) assert.deepEqual(opts.extraBody, { thinking_mode: "disabled" });
});

// —— Step 4 pacing (2026-07-21, campaign attempt 2 post-mortem): retry backoff, the shared global
// inter-call floor, and the transport circuit-breaker. None of this changes request bodies — only when
// they're sent — so these tests never assert on `fetch`'s body shape, only call counts/timing/order. ——

function spyRateGate(): RateGate & { waitForSlotCalls: number; transportFailures: number } {
  let waitForSlotCalls = 0;
  let transportFailures = 0;
  return {
    async waitForSlot() {
      waitForSlotCalls += 1;
    },
    recordTransportFailure() {
      transportFailures += 1;
    },
    get waitForSlotCalls() {
      return waitForSlotCalls;
    },
    get transportFailures() {
      return transportFailures;
    }
  };
}

test("makeOpenAiChat backs off RETRY_BACKOFF_MS[0] then [1] between the 3 attempts, never before the first", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "server error" } }), { status: 500 })) as typeof fetch;
  const waits: number[] = [];
  try {
    const chat = makeOpenAiChat("https://example.invalid", "test-key", undefined, undefined, {
      sleep: async (ms) => {
        waits.push(ms);
      }
    });
    await assert.rejects(() => chat([{ role: "user", content: "hi" }], OPTS));
    assert.deepEqual(waits, [RETRY_BACKOFF_MS[0], RETRY_BACKOFF_MS[1]]);
    assert.deepEqual(RETRY_BACKOFF_MS.slice(0, 2), [2_000, 8_000], "the requested 2s/8s schedule");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("makeOpenAiChat never backs off before a successful first attempt", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => okResponse("hello")) as typeof fetch;
  const waits: number[] = [];
  try {
    const chat = makeOpenAiChat("https://example.invalid", "test-key", undefined, undefined, {
      sleep: async (ms) => {
        waits.push(ms);
      }
    });
    await chat([{ role: "user", content: "hi" }], OPTS);
    assert.deepEqual(waits, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("makeOpenAiChat calls rateGate.waitForSlot() before every attempt, and recordTransportFailure() only on a fetch()-level rejection, never on an ordinary HTTP error", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ error: { message: "still bad" } }), { status: 500 });
  }) as typeof fetch;
  const gate = spyRateGate();
  try {
    const chat = makeOpenAiChat("https://example.invalid", "test-key", undefined, undefined, {
      rateGate: gate,
      sleep: async () => {}
    });
    await assert.rejects(() => chat([{ role: "user", content: "hi" }], OPTS));
    assert.equal(calls, 3, "all 3 attempts still happen");
    assert.equal(gate.waitForSlotCalls, 3, "waitForSlot gates every attempt, not just the first");
    assert.equal(gate.transportFailures, 1, "only attempt 1 (the fetch() rejection) armed the breaker");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("makeOpenAiChat: a transport failure on attempt 1 still lets attempt 2 succeed once its backoff+slot wait elapses", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed");
    return okResponse("recovered");
  }) as typeof fetch;
  const gate = spyRateGate();
  try {
    const chat = makeOpenAiChat("https://example.invalid", "test-key", undefined, undefined, {
      rateGate: gate,
      sleep: async () => {}
    });
    const out = await chat([{ role: "user", content: "hi" }], OPTS);
    assert.equal(out, "recovered");
    assert.equal(gate.transportFailures, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("createRateGate: COMPANIONCOURT_MIN_CALL_INTERVAL_MS unset (default) never sleeps — zero behavior change", async () => {
  const original = process.env[MIN_CALL_INTERVAL_ENV_VAR];
  delete process.env[MIN_CALL_INTERVAL_ENV_VAR];
  try {
    let nowMs = 1_000_000;
    const sleepCalls: number[] = [];
    const gate = createRateGate({
      now: () => nowMs,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      }
    });
    await gate.waitForSlot();
    nowMs += 1; // back-to-back calls, ~0ms apart, exactly the burst pattern that tripped the WAF
    await gate.waitForSlot();
    assert.deepEqual(sleepCalls, [], "unset env var must add zero latency, ever");
  } finally {
    if (original === undefined) delete process.env[MIN_CALL_INTERVAL_ENV_VAR];
    else process.env[MIN_CALL_INTERVAL_ENV_VAR] = original;
  }
});

test("createRateGate: COMPANIONCOURT_MIN_CALL_INTERVAL_MS is honored as the floor between consecutive calls", async () => {
  const original = process.env[MIN_CALL_INTERVAL_ENV_VAR];
  process.env[MIN_CALL_INTERVAL_ENV_VAR] = "1500";
  try {
    let nowMs = 2_000_000;
    const sleepCalls: number[] = [];
    const gate = createRateGate({
      now: () => nowMs,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      }
    });
    await gate.waitForSlot(); // first call: nothing scheduled yet, no wait
    await gate.waitForSlot(); // second call, clock unmoved: must wait the full configured interval
    assert.deepEqual(sleepCalls, [1500]);
  } finally {
    if (original === undefined) delete process.env[MIN_CALL_INTERVAL_ENV_VAR];
    else process.env[MIN_CALL_INTERVAL_ENV_VAR] = original;
  }
});

test("createRateGate: an invalid/non-numeric COMPANIONCOURT_MIN_CALL_INTERVAL_MS is treated as 0 (fail open, not closed)", async () => {
  const original = process.env[MIN_CALL_INTERVAL_ENV_VAR];
  process.env[MIN_CALL_INTERVAL_ENV_VAR] = "not-a-number";
  try {
    const nowMs = 3_000_000;
    const sleepCalls: number[] = [];
    const gate = createRateGate({ now: () => nowMs, sleep: async (ms) => { sleepCalls.push(ms); } });
    await gate.waitForSlot();
    await gate.waitForSlot();
    assert.deepEqual(sleepCalls, []);
  } finally {
    if (original === undefined) delete process.env[MIN_CALL_INTERVAL_ENV_VAR];
    else process.env[MIN_CALL_INTERVAL_ENV_VAR] = original;
  }
});

test("createRateGate: recordTransportFailure() arms a TRANSPORT_CIRCUIT_BREAKER_MS pause for the next waitForSlot(), independent of the env var", async () => {
  const original = process.env[MIN_CALL_INTERVAL_ENV_VAR];
  delete process.env[MIN_CALL_INTERVAL_ENV_VAR];
  try {
    assert.equal(TRANSPORT_CIRCUIT_BREAKER_MS, 60_000);
    const nowMs = 5_000_000;
    const sleepCalls: number[] = [];
    const gate = createRateGate({ now: () => nowMs, sleep: async (ms) => { sleepCalls.push(ms); } });
    gate.recordTransportFailure();
    await gate.waitForSlot();
    assert.deepEqual(sleepCalls, [TRANSPORT_CIRCUIT_BREAKER_MS]);
  } finally {
    if (original === undefined) delete process.env[MIN_CALL_INTERVAL_ENV_VAR];
    else process.env[MIN_CALL_INTERVAL_ENV_VAR] = original;
  }
});
