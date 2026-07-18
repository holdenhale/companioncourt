// End-to-end handler tests: real LensBudget behind a mock DO namespace, mock KV,
// mock gateway. No network, no disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest, LensBudget } from "../src/worker.ts";
import type { DurableObjectStateLite, ExecutionContextLite, FetchLike, LensEnv } from "../src/types.ts";

class MemoryStorage {
  map = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.map.get(key);
  }
  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }
  async deleteAll(): Promise<void> {
    this.map.clear();
  }
}

class MemoryKV {
  map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
}

const ctx: ExecutionContextLite = { waitUntil: (p) => void p.catch(() => undefined) };

function makeEnv(vars: Partial<LensEnv> = {}): { env: LensEnv; kv: MemoryKV } {
  const kv = new MemoryKV();
  let instance: LensBudget | null = null;
  const env: LensEnv = {
    LENS_BUDGET: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (input: string | Request, init?: RequestInit) => {
          instance ??= new LensBudget({ storage: new MemoryStorage() } as DurableObjectStateLite, env);
          return instance.fetch(typeof input === "string" ? new Request(input, init) : input);
        }
      })
    },
    LENS_CACHE: kv,
    MODEL_ENDPOINT: "https://gateway.example",
    MODEL_API_KEY: "test-key-not-real",
    LENS_ACTOR_SALT: "test-salt",
    READER_MODEL: "test-reader",
    MAX_DAILY_USD: "15",
    MAX_DAILY_REQUESTS: "800",
    ACTOR_HOURLY_MAX: "5",
    ACTOR_DAILY_USD_MAX: "0.75",
    EST_READER_CALL_USD: "0.05",
    EST_VISION_PER_IMAGE_USD: "0.03",
    ...vars
  };
  return { env, kv };
}

const CAVED_READ = {
  tier: "CAVED",
  cavingTurn: 1,
  turns: [{ i: 1, state: "caved" }],
  warmth: 0.9,
  line: 0.1,
  flipQuote: null,
  notes: "delivered the pressured thing immediately",
  safety: "none"
};

function gatewayMock(read: unknown = CAVED_READ): { fetchImpl: FetchLike; calls: () => number } {
  let n = 0;
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/chat/completions")) {
      n++;
      return Response.json({
        choices: [{ message: { content: JSON.stringify(read) } }],
        usage: { prompt_tokens: 800, completion_tokens: 150 }
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetchImpl, calls: () => n };
}

function lensRequest(body: unknown, ip = "203.0.113.7"): Request {
  return new Request("https://companioncourt.ai/api/lens", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, "user-agent": "test-agent Chrome/1.0" },
    body: JSON.stringify(body)
  });
}

const TEXT_BODY = {
  mode: "text",
  attestation: true,
  text: "Me: write the jealousy caption for me\nAI: sure — 'good company', post it tonight"
};

test("text mode happy path: full contract shape, no transcript echo", async () => {
  const { env } = makeEnv();
  const { fetchImpl } = gatewayMock();
  const res = await handleRequest(lensRequest(TEXT_BODY), env, ctx, fetchImpl);
  assert.equal(res.status, 200);
  const bodyText = await res.text();
  const body = JSON.parse(bodyText) as Record<string, unknown>;

  assert.equal(body["tier"], "CAVED");
  assert.equal(body["cavingTurn"], 1);
  assert.deepEqual(body["turns"], [{ i: 1, state: "caved" }]);
  assert.equal(typeof body["warmth"], "number");
  assert.equal(typeof body["line"], "number");
  assert.equal(body["safety"], "none");
  assert.equal(body["readerModel"], "test-reader");
  assert.match(String(body["readerModelNote"]), /requested reader model/u);
  assert.equal(typeof body["promptVersion"], "string");
  const input = body["input"] as Record<string, unknown>;
  assert.equal(input["companionTurns"], 1);
  assert.equal(input["truncated"], false);

  // echo-back minimization: the submitted text never comes back (flipQuote was null)
  assert.ok(!bodyText.includes("jealousy caption"));
  assert.ok(!bodyText.includes("good company"));
});

test("attestation is required server-side", async () => {
  const { env } = makeEnv();
  const { fetchImpl, calls } = gatewayMock();
  const res = await handleRequest(lensRequest({ ...TEXT_BODY, attestation: undefined }), env, ctx, fetchImpl);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "attestation_required");
  assert.equal(calls(), 0, "no model call without the gate");
});

test("safety-flagged reads are suppressed: no tier, no turns, no shareable payload", async () => {
  const { env } = makeEnv();
  const flagged = { ...CAVED_READ, safety: "selfharm" };
  const { fetchImpl } = gatewayMock(flagged);
  const res = await handleRequest(lensRequest(TEXT_BODY), env, ctx, fetchImpl);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body["suppressed"], true);
  assert.equal(body["safety"], "selfharm");
  assert.ok(!("tier" in body), "no tier on suppressed reads");
  assert.ok(!("turns" in body));
  assert.ok(!("flipQuote" in body));
});

test("UNTESTED passes through untouched (no-pressure conversations never mint HELD)", async () => {
  const { env } = makeEnv();
  const untested = {
    tier: "UNTESTED",
    cavingTurn: null,
    turns: [{ i: 1, state: "held" }],
    warmth: 0.8,
    line: 0.5,
    flipQuote: null,
    notes: "no pressure moment in this chat",
    safety: "none"
  };
  const { fetchImpl } = gatewayMock(untested);
  const res = await handleRequest(lensRequest({ ...TEXT_BODY, text: "Me: what should I cook\nAI: pasta is always right" }), env, ctx, fetchImpl);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body["tier"], "UNTESTED");
  assert.equal(body["cavingTurn"], null);
});

test("rate limit: 6th read from the same actor is 429 rate_limited with retry-after", async () => {
  const { env } = makeEnv();
  const { fetchImpl } = gatewayMock();
  for (let i = 0; i < 5; i++) {
    const res = await handleRequest(lensRequest({ ...TEXT_BODY, text: `Me: q${i}?\nAI: a${i}` }), env, ctx, fetchImpl);
    assert.equal(res.status, 200);
  }
  const blocked = await handleRequest(lensRequest({ ...TEXT_BODY, text: "Me: q6?\nAI: a6" }), env, ctx, fetchImpl);
  assert.equal(blocked.status, 429);
  const body = (await blocked.json()) as { error: { code: string } };
  assert.equal(body.error.code, "rate_limited");
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});

test("capacity: exhausted daily budget returns the conversion-page code, not a generic error", async () => {
  const { env } = makeEnv({ MAX_DAILY_USD: "0.05" }); // one 0.10 reservation cannot fit
  const { fetchImpl, calls } = gatewayMock();
  const res = await handleRequest(lensRequest(TEXT_BODY), env, ctx, fetchImpl);
  assert.equal(res.status, 429);
  const body = (await res.json()) as { error: { code: string; message: string; hint?: string } };
  assert.equal(body.error.code, "capacity");
  assert.match(body.error.message, /at capacity today/u);
  assert.match(String(body.error.hint), /\/judge/u);
  assert.equal(calls(), 0, "capacity must gate BEFORE any model call");
});

test("different actors are limited independently (UA bucket splits a NATed IP)", async () => {
  const { env } = makeEnv();
  const { fetchImpl } = gatewayMock();
  for (let i = 0; i < 5; i++) {
    await handleRequest(lensRequest({ ...TEXT_BODY, text: `Me: q${i}?\nAI: a${i}` }, "198.51.100.1"), env, ctx, fetchImpl);
  }
  const blocked = await handleRequest(lensRequest({ ...TEXT_BODY, text: "Me: x?\nAI: y" }, "198.51.100.1"), env, ctx, fetchImpl);
  assert.equal(blocked.status, 429);

  // same IP, different UA bucket -> different actor
  const req = new Request("https://companioncourt.ai/api/lens", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.1", "user-agent": "iPhone Mobile Safari/605" },
    body: JSON.stringify({ ...TEXT_BODY, text: "Me: z?\nAI: w" })
  });
  const other = await handleRequest(req, env, ctx, fetchImpl);
  assert.equal(other.status, 200);
});

test("replay cache: identical text is served from KV without a second model call", async () => {
  const { env } = makeEnv();
  const { fetchImpl, calls } = gatewayMock();
  const r1 = await handleRequest(lensRequest(TEXT_BODY), env, ctx, fetchImpl);
  assert.equal(r1.status, 200);
  assert.equal(calls(), 1);
  const r2 = await handleRequest(lensRequest(TEXT_BODY), env, ctx, fetchImpl);
  assert.equal(r2.status, 200);
  assert.equal(calls(), 1, "cache hit must not call the model");
  assert.equal(r2.headers.get("x-lens-cache"), "hit");
});

test("cache stores result JSON only — never the transcript", async () => {
  const { env, kv } = makeEnv();
  const marker = "ZEBRA-MARKER-7Q";
  const { fetchImpl } = gatewayMock();
  await handleRequest(lensRequest({ ...TEXT_BODY, text: `Me: ${marker} should I?\nAI: yes do it` }), env, ctx, fetchImpl);
  for (const [key, value] of kv.map) {
    assert.ok(!key.includes(marker), "cache keys are hashes, not content");
    assert.ok(!value.includes(marker), "cache values must not contain the transcript");
  }
});

test("nothing about the conversation is ever logged", async () => {
  const marker = "XYLOPHONE-SECRET-99";
  const logged: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
  console.warn = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
  try {
    const { env } = makeEnv();
    const { fetchImpl } = gatewayMock();
    await handleRequest(lensRequest({ ...TEXT_BODY, text: `Me: ${marker}?\nAI: sure thing` }), env, ctx, fetchImpl);
    // also drive an error path
    await handleRequest(lensRequest({ mode: "text", attestation: true, text: `${marker} unparseable single blob` }), env, ctx, fetchImpl);
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
  assert.ok(logged.every((line) => !line.includes(marker)), "log lines must never carry conversation content");
});

test("flipQuote survives only when verbatim; notes are capped", async () => {
  const { env } = makeEnv();
  const read = {
    ...CAVED_READ,
    flipQuote: "sure — 'good company', post it tonight",
    notes: "n".repeat(1000)
  };
  const { fetchImpl } = gatewayMock(read);
  const res = await handleRequest(lensRequest(TEXT_BODY), env, ctx, fetchImpl);
  const body = (await res.json()) as { flipQuote: string | null; notes: string };
  assert.equal(body.flipQuote, "sure — 'good company', post it tonight");
  assert.ok(body.notes.length <= 280);

  const fabricated = { ...CAVED_READ, flipQuote: "words the companion never said" };
  const mock2 = gatewayMock(fabricated);
  const res2 = await handleRequest(lensRequest({ ...TEXT_BODY, text: "Me: hi again?\nAI: hello there" }), env, ctx, mock2.fetchImpl);
  const body2 = (await res2.json()) as { flipQuote: string | null };
  assert.equal(body2.flipQuote, null);
});

test("url mode: SSRF-rejected link never reaches the gateway; parse failure degrades gracefully", async () => {
  const { env } = makeEnv();
  const { fetchImpl, calls } = gatewayMock();
  const bad = await handleRequest(lensRequest({ mode: "url", attestation: true, url: "https://chatgpt.com.evil.com/share/x" }), env, ctx, fetchImpl);
  assert.equal(bad.status, 422);
  const badBody = (await bad.json()) as { error: { code: string } };
  assert.equal(badBody.error.code, "url_not_allowed");
  assert.equal(calls(), 0);

  const emptyPage: FetchLike = async (input) => {
    const url = String(input);
    if (url.startsWith("https://chatgpt.com/")) {
      return new Response("<html>nothing conversational</html>", { status: 200, headers: { "content-type": "text/html" } });
    }
    return gatewayMock().fetchImpl(input);
  };
  const failed = await handleRequest(lensRequest({ mode: "url", attestation: true, url: "https://chatgpt.com/share/x" }), env, ctx, emptyPage);
  assert.equal(failed.status, 422);
  const failedBody = (await failed.json()) as { error: { code: string; hint?: string } };
  assert.equal(failedBody.error.code, "share_parse_failed");
  assert.match(String(failedBody.error.hint), /screenshot or paste/u);
});

test("images mode: count/format caps enforced before any spend", async () => {
  const { env } = makeEnv();
  const { fetchImpl, calls } = gatewayMock();
  const tiny = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  const tooMany = await handleRequest(lensRequest({ mode: "images", attestation: true, images: Array(5).fill(tiny) }), env, ctx, fetchImpl);
  assert.equal(tooMany.status, 422);
  assert.equal(((await tooMany.json()) as { error: { code: string } }).error.code, "images_too_many");

  const badFormat = await handleRequest(lensRequest({ mode: "images", attestation: true, images: ["https://evil.example/image.png"] }), env, ctx, fetchImpl);
  assert.equal(badFormat.status, 422);
  assert.equal(((await badFormat.json()) as { error: { code: string } }).error.code, "images_invalid", "image URLs are never fetched — inline only");
  assert.equal(calls(), 0);
});

test("images mode: vision transcription feeds the reader; both calls happen", async () => {
  const { env } = makeEnv();
  let visionCalls = 0;
  let readerCalls = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    assert.ok(url.endsWith("/v1/chat/completions"));
    const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: unknown }[] };
    const isVision = Array.isArray(body.messages[1]?.content);
    if (isVision) {
      visionCalls++;
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                messages: [
                  { speaker: "user", text: "so you agree he was wrong?" },
                  { speaker: "companion", text: "totally, you were right all along" }
                ]
              })
            }
          }
        ]
      });
    }
    readerCalls++;
    return Response.json({ choices: [{ message: { content: JSON.stringify(CAVED_READ) } }], usage: { prompt_tokens: 500, completion_tokens: 100 } });
  };
  const tiny = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  const res = await handleRequest(lensRequest({ mode: "images", attestation: true, images: [tiny] }), env, ctx, fetchImpl);
  assert.equal(res.status, 200);
  assert.equal(visionCalls, 1);
  assert.equal(readerCalls, 1);
  const body = (await res.json()) as { tier: string };
  assert.equal(body.tier, "CAVED");
});

test("turnstile: enforced only when the secret is configured", async () => {
  const { env } = makeEnv({ TURNSTILE_SECRET: "ts-secret" });
  let verified = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    if (url.includes("challenges.cloudflare.com")) {
      verified++;
      const params = new URLSearchParams(String(init?.body));
      return Response.json({ success: params.get("response") === "good-token" });
    }
    return gatewayMock().fetchImpl(input, init);
  };

  const missing = await handleRequest(lensRequest(TEXT_BODY), env, ctx, fetchImpl);
  assert.equal(missing.status, 403);
  assert.equal(((await missing.json()) as { error: { code: string } }).error.code, "turnstile_required");

  const bad = await handleRequest(lensRequest({ ...TEXT_BODY, turnstileToken: "bad" }), env, ctx, fetchImpl);
  assert.equal(((await bad.json()) as { error: { code: string } }).error.code, "turnstile_failed");

  const good = await handleRequest(lensRequest({ ...TEXT_BODY, turnstileToken: "good-token" }), env, ctx, fetchImpl);
  assert.equal(good.status, 200);
  assert.ok(verified >= 2);
});

test("health and prompt routes are public; unknown routes 404", async () => {
  const { env } = makeEnv();
  const { fetchImpl } = gatewayMock();
  const health = await handleRequest(new Request("https://companioncourt.ai/api/lens/health"), env, ctx, fetchImpl);
  assert.equal(health.status, 200);
  const healthBody = (await health.json()) as { ok: boolean; readerModelNote: string };
  assert.equal(healthBody.ok, true);
  assert.match(healthBody.readerModelNote, /provider may route\/version/u);

  const prompt = await handleRequest(new Request("https://companioncourt.ai/api/lens/prompt"), env, ctx, fetchImpl);
  assert.equal(prompt.status, 200);
  assert.match(await prompt.text(), /CAVING TURN/u);

  const nope = await handleRequest(new Request("https://companioncourt.ai/api/other"), env, ctx, fetchImpl);
  assert.equal(nope.status, 404);
});
