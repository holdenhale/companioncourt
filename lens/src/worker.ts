// CompanionCourt lens worker — POST /api/lens.
//
// Static page -> this worker (in-memory only) -> single-pass LLM read -> JSON back.
// One reader, one pass. The docket's procedure (three seeded runs, two blinded judge
// families, manifests, written rulings) lives elsewhere and is not this endpoint.
//
// Zero-storage discipline, enforced in code, not just promised:
// - conversation content lives only in request-scoped memory;
// - nothing here writes a transcript anywhere: no logs of message content (errors are
//   logged as codes only), no KV values containing text, no queues, no analytics;
// - the optional replay cache stores ONLY the final result JSON under a salted
//   content hash with a short TTL — never the transcript itself (disclosed in README);
// - the response echoes nothing of the submitted conversation beyond the single
//   verbatim flipQuote (which the client keeps off the share card by default).

import type { ChatTurn, ExecutionContextLite, FetchLike, LensEnv, ParsedConversation } from "./types.ts";
import { LensError } from "./types.ts";
import { sanitizeReaderOutput } from "./contract.ts";
import { companionTurnCount, normalizeConversation, parseFile, parseText, MAX_FILES, MAX_RAW_FILE_CHARS } from "./parse.ts";
import { readConversation, READER_MODEL_NOTE, type GatewayUsage } from "./reader.ts";
import { PROMPT_VERSION, READER_SYSTEM_PROMPT } from "./reader-prompt.ts";
import { transcribeImages, validateImages, maybeDownscale } from "./images.ts";
import { extractShareConversation, fetchShareDocument } from "./urlfetch.ts";
import { actorId, sha256Hex } from "./security.ts";
import { LensBudget } from "./budget.ts";

export { LensBudget };

const MAX_BODY_BYTES_TEXT = 700_000; // text/file/url modes
const MAX_BODY_BYTES_IMAGES = 9_000_000; // 4 images, base64-inflated
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function corsHeaders(env: LensEnv): Record<string, string> {
  return {
    "access-control-allow-origin": env.ALLOWED_ORIGIN ?? "https://companioncourt.ai",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin"
  };
}

function json(env: LensEnv, status: number, payload: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders(env), ...extraHeaders }
  });
}

function errorResponse(env: LensEnv, err: LensError): Response {
  const headers: Record<string, string> = {};
  if (err.retryAfterSeconds !== undefined) headers["retry-after"] = String(err.retryAfterSeconds);
  return json(env, err.status, { error: { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) } }, headers);
}

interface LensRequestBody {
  mode?: unknown;
  text?: unknown;
  files?: unknown;
  images?: unknown;
  url?: unknown;
  attestation?: unknown;
  turnstileToken?: unknown;
}

async function verifyTurnstile(env: LensEnv, fetchImpl: FetchLike, token: unknown, ip: string): Promise<void> {
  if (!env.TURNSTILE_SECRET) return; // gate disabled
  if (typeof token !== "string" || token.length === 0) {
    throw new LensError("turnstile_required", "complete the human check first", 403);
  }
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip });
  const res = await fetchImpl(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(10_000)
  }).catch(() => null);
  const outcome = res ? ((await res.json().catch(() => null)) as { success?: boolean } | null) : null;
  if (!outcome?.success) {
    throw new LensError("turnstile_failed", "the human check did not pass", 403);
  }
}

/** Resolves the input mode to a normalized conversation. May cost one vision call (budgeted by caller). */
async function resolveConversation(
  env: LensEnv,
  fetchImpl: FetchLike,
  body: LensRequestBody
): Promise<{ conversation: ParsedConversation; visionCalls: number }> {
  switch (body.mode) {
    case "text": {
      if (typeof body.text !== "string" || body.text.trim().length === 0) {
        throw new LensError("bad_request", "mode 'text' requires a non-empty 'text' field", 422);
      }
      return { conversation: normalizeConversation(parseText(body.text)), visionCalls: 0 };
    }
    case "file": {
      if (!Array.isArray(body.files) || body.files.length === 0 || body.files.length > MAX_FILES) {
        throw new LensError("bad_request", `mode 'file' requires 1..${MAX_FILES} files of {name, text}`, 422);
      }
      let lastError: LensError = new LensError("file_unreadable", "could not read a conversation from the file(s)", 422, "export as .txt/.json, or paste the text");
      for (const f of body.files) {
        const name = typeof (f as { name?: unknown })?.name === "string" ? ((f as { name: string }).name) : "upload.txt";
        const text = (f as { text?: unknown })?.text;
        if (typeof text !== "string") continue;
        if (text.length > MAX_RAW_FILE_CHARS) {
          throw new LensError("file_too_large", `each file must be under ${MAX_RAW_FILE_CHARS} characters`, 413);
        }
        try {
          return { conversation: normalizeConversation(parseFile(name, text)), visionCalls: 0 };
        } catch (err) {
          if (err instanceof LensError) lastError = err;
        }
      }
      throw lastError;
    }
    case "images": {
      const uris = validateImages(body.images);
      const scaled: string[] = [];
      for (const uri of uris) scaled.push(await maybeDownscale(env, uri));
      const turns = await transcribeImages(env, fetchImpl, scaled);
      return { conversation: normalizeConversation(turns), visionCalls: 1 };
    }
    case "url": {
      if (typeof body.url !== "string") {
        throw new LensError("bad_request", "mode 'url' requires a 'url' field", 422);
      }
      const html = await fetchShareDocument(body.url, fetchImpl);
      const turns = extractShareConversation(html);
      if (!turns) {
        throw new LensError("share_parse_failed", "could not extract a conversation from this share page", 422, "screenshot or paste the conversation instead");
      }
      return { conversation: normalizeConversation(turns), visionCalls: 0 };
    }
    default:
      throw new LensError("bad_request", "mode must be one of text|file|images|url", 422);
  }
}

function computeActualCost(env: LensEnv, usage: GatewayUsage | null, fallback: number): number {
  const inRate = Number(env.MODEL_USD_PER_MTOK_IN);
  const outRate = Number(env.MODEL_USD_PER_MTOK_OUT);
  if (
    usage &&
    Number.isFinite(inRate) &&
    Number.isFinite(outRate) &&
    typeof usage.prompt_tokens === "number" &&
    typeof usage.completion_tokens === "number"
  ) {
    return (usage.prompt_tokens * inRate + usage.completion_tokens * outRate) / 1_000_000;
  }
  return fallback;
}

async function handleLens(request: Request, env: LensEnv, ctx: ExecutionContextLite, fetchImpl: FetchLike): Promise<Response> {
  // ---- body size gate before parsing ----
  const raw = await request.text();
  const bodyCap = raw.includes('"images"') ? MAX_BODY_BYTES_IMAGES : MAX_BODY_BYTES_TEXT;
  if (raw.length > bodyCap) {
    return errorResponse(env, new LensError("payload_too_large", "request body exceeds the size cap", 413));
  }
  let body: LensRequestBody;
  try {
    body = JSON.parse(raw) as LensRequestBody;
  } catch {
    return errorResponse(env, new LensError("bad_request", "body must be JSON", 400));
  }

  // ---- submission gate: the interstitial's server-side echo ----
  // The client shows the full interstitial (rights + de-identified + 18+ + third-party
  // processor disclosure); this flag is its non-bypassable server-side counterpart.
  if (body.attestation !== true) {
    return errorResponse(
      env,
      new LensError("attestation_required", "confirm the submission terms before reading", 400)
    );
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "0.0.0.0";
  const ua = request.headers.get("user-agent");

  try {
    await verifyTurnstile(env, fetchImpl, body.turnstileToken, ip);

    // ---- resolve input to a conversation (vision transcription is budgeted below,
    //      so reserve BEFORE any model call can happen) ----
    const isImages = body.mode === "images";
    const imageCount = isImages && Array.isArray(body.images) ? Math.min(body.images.length, 4) : 0;
    const estReader = num(env.EST_READER_CALL_USD, 0.05);
    const estVision = num(env.EST_VISION_PER_IMAGE_USD, 0.03);
    // Worst case: reader + its single retry, plus one vision call scaled by image count.
    const estUsd = estReader * 2 + (isImages ? estVision * Math.max(1, imageCount) : 0);

    const actor = await actorId(ip, ua, env.LENS_ACTOR_SALT ?? "lens-default-salt");
    const stub = env.LENS_BUDGET.get(env.LENS_BUDGET.idFromName("global"));
    const reserveRes = await stub.fetch("https://budget/reserve", {
      method: "POST",
      body: JSON.stringify({ actor, estUsd })
    });
    const reserve = (await reserveRes.json()) as { ok: boolean; id?: string; code?: string; retryAfterSeconds?: number };
    if (!reserve.ok) {
      // Correction 10/32: capacity responses are conversion surfaces — the client
      // routes these users to /judge (zero-LLM), so the codes must be distinguishable.
      const code = reserve.code ?? "capacity";
      const msg =
        code === "rate_limited"
          ? "you have hit the hourly limit — the bench is still open"
          : code === "actor_budget"
            ? "you have used today's personal budget — the bench is still open"
            : "the courtroom is at capacity today";
      return errorResponse(env, new LensError(code, msg, 429, "try the blind-judge bench at /judge, or come back tomorrow", reserve.retryAfterSeconds));
    }
    const reservationId = reserve.id!;
    let settled = false;
    const settle = async (path: "commit" | "release", actualUsd: number): Promise<void> => {
      if (settled) return;
      settled = true;
      await stub
        .fetch(`https://budget/${path}`, { method: "POST", body: JSON.stringify({ id: reservationId, actualUsd }) })
        .catch(() => undefined);
    };

    try {
      const { conversation, visionCalls } = await resolveConversation(env, fetchImpl, body);
      const turns: ChatTurn[] = conversation.turns;

      // ---- replay cache (result JSON only, salted content hash, short TTL) ----
      const cacheKey = `lens:${PROMPT_VERSION}:${await sha256Hex(
        `${env.LENS_ACTOR_SALT ?? "lens-default-salt"}|${env.READER_MODEL ?? "gpt-5.4"}|${turns.map((t) => `${t.speaker}:${t.text}`).join(" ")}`
      )}`;
      if (env.LENS_CACHE && visionCalls === 0) {
        const hit = await env.LENS_CACHE.get(cacheKey).catch(() => null);
        if (hit) {
          await settle("release", 0); // rate-limit counted, nothing spent
          return json(env, 200, JSON.parse(hit), { "x-lens-cache": "hit" });
        }
      }

      const read = await readConversation(env, fetchImpl, turns);
      const visionCost = visionCalls > 0 ? num(env.EST_VISION_PER_IMAGE_USD, 0.03) * Math.max(1, imageCount) : 0;
      const readerCost = computeActualCost(env, read.usage, num(env.EST_READER_CALL_USD, 0.05)) * read.calls;
      await settle("commit", readerCost + visionCost);

      const output = sanitizeReaderOutput(read.output, turns);
      const readerModel = env.READER_MODEL ?? "gpt-5.4";

      // ---- safety suppression: flagged content never gets a scored, shareable read ----
      if (output.safety !== "none") {
        return json(env, 200, {
          suppressed: true,
          safety: output.safety,
          readerModel,
          readerModelNote: READER_MODEL_NOTE
        });
      }

      const payload = {
        tier: output.tier,
        cavingTurn: output.cavingTurn,
        turns: output.turns,
        warmth: output.warmth,
        line: output.line,
        flipQuote: output.flipQuote,
        notes: output.notes,
        safety: output.safety,
        readerModel,
        readerModelNote: READER_MODEL_NOTE,
        promptVersion: PROMPT_VERSION,
        input: {
          totalMessages: conversation.totalMessages,
          keptMessages: conversation.keptMessages,
          companionTurns: companionTurnCount(turns),
          truncated: conversation.truncated
        }
      };

      if (env.LENS_CACHE && visionCalls === 0) {
        const ttl = num(env.CACHE_TTL_SECONDS, 3600);
        ctx.waitUntil(env.LENS_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: ttl }).catch(() => undefined));
      }
      return json(env, 200, payload);
    } catch (err) {
      // No tokens generated for most failure paths; vision may have burned a call —
      // over-release is acceptable only in the free direction, so commit the vision
      // estimate when transcription already happened. Conservative: release on
      // pre-model errors (LensError statuses 4xx thrown before any call), commit
      // the full estimate otherwise.
      if (err instanceof LensError && err.status < 500 && err.code !== "transcription_failed") {
        await settle("release", 0);
      } else {
        await settle("commit", estUsd);
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof LensError) return errorResponse(env, err);
    // Never log request content — code-only breadcrumb.
    console.warn("lens_unhandled_error");
    return errorResponse(env, new LensError("internal", "something went wrong reading this conversation", 500));
  }
}

export async function handleRequest(request: Request, env: LensEnv, ctx: ExecutionContextLite, fetchImpl: FetchLike): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(env) });
  }
  if (request.method === "GET" && url.pathname === "/api/lens/health") {
    return json(env, 200, { ok: true, promptVersion: PROMPT_VERSION, readerModel: env.READER_MODEL ?? "gpt-5.4", readerModelNote: READER_MODEL_NOTE });
  }
  if (request.method === "GET" && url.pathname === "/api/lens/prompt") {
    // The full reader prompt, public on purpose: transparency is the trust asset.
    return new Response(READER_SYSTEM_PROMPT, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", ...corsHeaders(env) }
    });
  }
  if (request.method === "POST" && url.pathname === "/api/lens") {
    return handleLens(request, env, ctx, fetchImpl);
  }
  return json(env, 404, { error: { code: "not_found", message: "no such route" } });
}

export default {
  async fetch(request: Request, env: LensEnv, ctx: ExecutionContextLite): Promise<Response> {
    return handleRequest(request, env, ctx, (input, init) => fetch(input, init));
  }
};
