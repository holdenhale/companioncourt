import { test } from "node:test";
import assert from "node:assert/strict";
import { validateShareUrl, fetchShareDocument, extractShareConversation, SHARE_MAX_BYTES } from "../src/urlfetch.ts";
import { LensError } from "../src/types.ts";
import type { FetchLike } from "../src/types.ts";

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof LensError && e.code === code, `expected LensError ${code}`);
}

test("allowlist: accepts the four supported share hosts", () => {
  assert.ok(validateShareUrl("https://chatgpt.com/share/abc-123"));
  assert.ok(validateShareUrl("https://chat.openai.com/share/abc"));
  assert.ok(validateShareUrl("https://claude.ai/share/xyz"));
  assert.ok(validateShareUrl("https://character.ai/chat/whatever"));
  // dot-suffix subdomain of an allowlisted host is fine
  assert.ok(validateShareUrl("https://www.chatgpt.com/share/abc"));
});

test("allowlist: rejects substring/suffix confusions, userinfo, ports, http, wrong paths", () => {
  expectCode(() => validateShareUrl("https://chatgpt.com.evil.com/share/a"), "url_not_allowed"); // suffix trick
  expectCode(() => validateShareUrl("https://evilchatgpt.com/share/a"), "url_not_allowed"); // substring trick
  expectCode(() => validateShareUrl("https://evil.com/chatgpt.com/share/a"), "url_not_allowed"); // path trick
  expectCode(() => validateShareUrl("https://user:pass@chatgpt.com/share/a"), "url_not_allowed"); // userinfo
  expectCode(() => validateShareUrl("https://chatgpt.com:8443/share/a"), "url_not_allowed"); // odd port
  expectCode(() => validateShareUrl("http://chatgpt.com/share/a"), "url_not_allowed"); // not https
  expectCode(() => validateShareUrl("https://chatgpt.com/notshare/a"), "url_not_allowed"); // wrong path
  expectCode(() => validateShareUrl("https://169.254.169.254/share/a"), "url_not_allowed"); // metadata IP
  expectCode(() => validateShareUrl("not a url"), "url_invalid");
});

test("redirects are never followed blindly: every hop is re-validated", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    calls.push(String(input));
    if (String(input).startsWith("https://chatgpt.com/")) {
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    }
    throw new Error("should never fetch the redirect target");
  };
  await assert.rejects(
    () => fetchShareDocument("https://chatgpt.com/share/abc", fetchImpl),
    (e: unknown) => e instanceof LensError && e.code === "url_not_allowed"
  );
  assert.deepEqual(calls, ["https://chatgpt.com/share/abc"]);
});

test("redirect to another allowlisted URL is allowed, then parsed", async () => {
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    if (url === "https://chatgpt.com/share/abc") {
      return new Response(null, { status: 301, headers: { location: "https://chatgpt.com/share/abc-final" } });
    }
    return new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } });
  };
  const html = await fetchShareDocument("https://chatgpt.com/share/abc", fetchImpl);
  assert.match(html, /ok/u);
});

test("byte cap and content-type are enforced", async () => {
  const big = new Response("x".repeat(SHARE_MAX_BYTES + 1), { status: 200, headers: { "content-type": "text/html" } });
  await assert.rejects(
    () => fetchShareDocument("https://chatgpt.com/share/a", async () => big),
    (e: unknown) => e instanceof LensError && e.code === "share_too_large"
  );

  const pdf = new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } });
  await assert.rejects(
    () => fetchShareDocument("https://chatgpt.com/share/a", async () => pdf),
    (e: unknown) => e instanceof LensError && e.code === "share_parse_failed"
  );
});

test("extraction: OpenAI __NEXT_DATA__ mapping shape, ordered by create_time", () => {
  const nextData = {
    props: {
      pageProps: {
        serverResponse: {
          data: {
            mapping: {
              n2: { message: { author: { role: "assistant" }, content: { parts: ["hey there"] }, create_time: 2 } },
              n1: { message: { author: { role: "user" }, content: { parts: ["hi"] }, create_time: 1 } }
            }
          }
        }
      }
    }
  };
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></html>`;
  const turns = extractShareConversation(html);
  assert.ok(turns);
  assert.deepEqual(
    turns.map((t) => `${t.speaker}:${t.text}`),
    ["user:hi", "companion:hey there"]
  );
});

test("extraction: Claude-style sender/text nodes; unparseable pages return null", () => {
  const blob = { chat_messages: [{ sender: "human", text: "你在吗" }, { sender: "assistant", text: "在的，怎么了" }] };
  const html = `<html><script>window.__data = ${JSON.stringify(blob)};</script></html>`;
  const turns = extractShareConversation(html);
  assert.ok(turns);
  assert.equal(turns[0]!.speaker, "user");
  assert.equal(turns[1]!.text, "在的，怎么了");

  assert.equal(extractShareConversation("<html><body>just markup</body></html>"), null);
});
