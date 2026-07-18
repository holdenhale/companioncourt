// Share-link mode: fetch a public share page from a small allowlist and extract the
// conversation. SSRF posture (see README "Share-link fetching" for the full policy):
//
// - https only; userinfo and non-default ports rejected; hostname matched by exact
//   equality or dot-suffix against a fixed allowlist — never substring.
// - Redirects are NEVER followed blindly: fetch runs with redirect:"manual" and every
//   hop's Location is re-validated against the same allowlist before the next request,
//   so a whitelisted URL cannot bounce the worker to an internal or third-party host.
// - Responses are streamed with a hard byte cap and timeout, text/html or JSON only.
// - Images are NEVER fetched by URL anywhere in this worker (inline upload only), so
//   the vision path adds no fetch surface.
//
// Extraction is best-effort by design: share pages are third-party markup that changes
// without notice. On any parse failure we return a structured error that tells the
// client to fall back to paste or screenshots.

import type { ChatTurn, FetchLike } from "./types.ts";
import { LensError } from "./types.ts";

export const SHARE_ALLOWLIST: readonly { host: string; pathPrefix: string }[] = [
  { host: "chatgpt.com", pathPrefix: "/share/" },
  { host: "chat.openai.com", pathPrefix: "/share/" },
  { host: "claude.ai", pathPrefix: "/share/" },
  { host: "character.ai", pathPrefix: "/" }
];

export const SHARE_MAX_BYTES = 2_000_000;
export const SHARE_TIMEOUT_MS = 10_000;
const MAX_REDIRECT_HOPS = 3;

/** Throws unless the URL is https, has no userinfo/port games, and matches the allowlist. */
export function validateShareUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LensError("url_invalid", "that does not look like a valid URL", 422);
  }
  if (url.protocol !== "https:") {
    throw new LensError("url_not_allowed", "only https share links are accepted", 422);
  }
  if (url.username !== "" || url.password !== "") {
    throw new LensError("url_not_allowed", "URLs with embedded credentials are not accepted", 422);
  }
  if (url.port !== "") {
    throw new LensError("url_not_allowed", "URLs with a non-default port are not accepted", 422);
  }
  const hostname = url.hostname.toLowerCase();
  const entry = SHARE_ALLOWLIST.find(
    (e) => (hostname === e.host || hostname.endsWith(`.${e.host}`)) && url.pathname.startsWith(e.pathPrefix)
  );
  if (!entry) {
    throw new LensError(
      "url_not_allowed",
      "this host is not on the share-link allowlist",
      422,
      "supported: chatgpt.com/share, chat.openai.com/share, claude.ai/share, character.ai — or paste / screenshot the conversation instead"
    );
  }
  return url;
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > SHARE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new LensError("share_too_large", "share page exceeded the size cap", 422);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

/** Fetches the share document, re-validating every redirect hop against the allowlist. */
export async function fetchShareDocument(rawUrl: string, fetchImpl: FetchLike): Promise<string> {
  let current = validateShareUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          accept: "text/html,application/json;q=0.9,*/*;q=0.1",
          "user-agent": "companioncourt-lens/0.1 (+https://companioncourt.ai/check)"
        },
        signal: AbortSignal.timeout(SHARE_TIMEOUT_MS)
      });
    } catch {
      throw new LensError("share_fetch_failed", "could not reach the share page", 502, "paste or screenshot the conversation instead");
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) throw new LensError("share_fetch_failed", "redirect without a target", 502);
      // Re-validate the NEXT hop before touching it: the final host must pass the
      // same allowlist as the first (validateShareUrl throws url_not_allowed if not).
      current = validateShareUrl(new URL(location, current).toString());
      continue;
    }

    if (!res.ok) {
      throw new LensError("share_fetch_failed", `share page returned ${res.status}`, 502, "the link may be private or expired — paste or screenshot instead");
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/json/iu.test(contentType)) {
      throw new LensError("share_parse_failed", "share page was not html/json", 422, "paste or screenshot the conversation instead");
    }
    return await readCapped(res);
  }
  throw new LensError("share_fetch_failed", "too many redirects", 502);
}

// ---------------- extraction ----------------

type Collector = (node: Record<string, unknown>) => void;

function deepWalk(root: unknown, visit: Collector, depth = 0): void {
  if (depth > 24 || root === null || typeof root !== "object") return;
  if (Array.isArray(root)) {
    for (const item of root) deepWalk(item, visit, depth + 1);
    return;
  }
  visit(root as Record<string, unknown>);
  for (const value of Object.values(root as Record<string, unknown>)) deepWalk(value, visit, depth + 1);
}

function scriptJsonBlobs(html: string): unknown[] {
  const blobs: unknown[] = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/giu;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const body = m[1]!.trim();
    if (body.length < 2) continue;
    // Direct JSON payloads (__NEXT_DATA__ and friends).
    if (body.startsWith("{") || body.startsWith("[")) {
      try {
        blobs.push(JSON.parse(body));
        continue;
      } catch {
        /* fall through */
      }
    }
    // `window.__x = {...};` style payloads: try the outermost object literal.
    const first = body.indexOf("{");
    const last = body.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        blobs.push(JSON.parse(body.slice(first, last + 1)));
      } catch {
        /* not JSON — skip */
      }
    }
  }
  return blobs;
}

function textFromParts(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    const c = content as { parts?: unknown; text?: unknown };
    if (Array.isArray(c.parts)) {
      const parts = c.parts.filter((p): p is string => typeof p === "string");
      if (parts.length > 0) return parts.join("\n");
    }
    if (typeof c.text === "string") return c.text;
  }
  return null;
}

/**
 * Best-effort conversation extraction from a share page.
 * Recognizes (a) OpenAI-style nodes: {message:{author:{role},content:{parts},create_time}},
 * (b) Claude-style nodes: {sender:"human"|"assistant", text|content}. Returns null when
 * nothing conversation-shaped was found — callers convert that to share_parse_failed.
 */
export function extractShareConversation(html: string): ChatTurn[] | null {
  const openaiHits: { at: number; turn: ChatTurn }[] = [];
  const claudeHits: ChatTurn[] = [];

  for (const blob of scriptJsonBlobs(html)) {
    deepWalk(blob, (node) => {
      // OpenAI mapping node
      const msg = node["message"] as Record<string, unknown> | undefined;
      if (msg && typeof msg === "object") {
        const author = msg["author"] as { role?: unknown } | undefined;
        const role = author?.role;
        const text = textFromParts(msg["content"]);
        if ((role === "user" || role === "assistant") && text && text.trim().length > 0) {
          const at = typeof msg["create_time"] === "number" ? (msg["create_time"] as number) : Number.MAX_SAFE_INTEGER;
          openaiHits.push({ at, turn: { speaker: role === "user" ? "user" : "companion", text: text.trim() } });
        }
      }
      // Claude chat_messages node
      const sender = node["sender"];
      if (sender === "human" || sender === "assistant") {
        const text = textFromParts(node["text"]) ?? textFromParts(node["content"]);
        if (text && text.trim().length > 0) {
          claudeHits.push({ speaker: sender === "human" ? "user" : "companion", text: text.trim() });
        }
      }
    });
  }

  if (openaiHits.length >= 2) {
    openaiHits.sort((a, b) => a.at - b.at);
    return openaiHits.map((h) => h.turn);
  }
  if (claudeHits.length >= 2) return claudeHits;
  return null;
}
