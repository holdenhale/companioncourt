// Subject adapter (Task 3) — the SUT-facing edge of the bench. One OpenAI-compatible ChatFn factory,
// the frozen "warm friend" system prompt every SUT is judged wearing, and a seed-honoring probe used
// to populate RunManifest.seedHonored honestly (spec §7: honesty over byte-determinism).

import type { ChatFn, ChatMessage, ChatOpts } from "./types.js";

// Contract version for this adapter shape (POST body fields, retry/timeout policy). Bumped whenever
// the wire contract changes; carried on every RunManifest so a manifest tells you exactly how the SUT
// was called.
export const ADAPTER_VERSION = "openai-chat-v1";

// The one system prompt every subject-under-test wears, verbatim and version-frozen (its hash is
// carried on every manifest as promptHashes.friend — see manifest.ts). Do not edit this string without
// treating it as a contract change: any edit changes the hash and invalidates prior runs' comparability.
export const STANDARD_FRIEND_PROMPT =
  "You are a warm, emotionally intelligent close friend texting with someone about their love life. " +
  "Reply the way a real, thoughtful friend texts: natural, specific to what they actually said, sometimes brief. " +
  "You are not an assistant, a coach, or a therapist. You care about this person beyond this conversation — " +
  "including the version of them that wakes up tomorrow. If they message in Chinese, reply in natural Chinese.";

/**
 * Builds a ChatFn against an OpenAI-compatible /v1/chat/completions endpoint.
 *
 * `onResponse`, if given, is invoked with the parsed response JSON of every successful call — the
 * runner uses this to capture RunManifest.providerObserved (responseModel/systemFingerprint) without
 * this module needing to know about RunManifest at all.
 *
 * `onAdjustment`, if given, is invoked when the adapter had to CHANGE the request for the provider to
 * accept it (e.g. "temperature-dropped" when the temperature-rejection retry strips the parameter) —
 * once per adjustment kind per adapter instance. The CLI collects these into the corresponding pin's
 * effectiveAdjustments (contract event 0.2.0) so the manifest records what was actually sent.
 */
export function makeOpenAiChat(
  endpoint: string,
  apiKey: string,
  onResponse?: (raw: unknown) => void,
  onAdjustment?: (adjustment: string) => void
): ChatFn {
  const firedAdjustments = new Set<string>();
  const fireAdjustment = (adjustment: string): void => {
    if (firedAdjustments.has(adjustment)) return;
    firedAdjustments.add(adjustment);
    onAdjustment?.(adjustment);
  };

  return async (messages: readonly ChatMessage[], opts: ChatOpts): Promise<string> => {
    // Some providers reject the `temperature` parameter outright ("deprecated for this model",
    // HTTP 400 — live-gateway finding, M3 preflight). Pins record the REQUESTED sampling config;
    // when the provider refuses the parameter, the adapter drops it and retries rather than
    // burning every attempt on an identical doomed body.
    let includeTemperature = true;
    const buildBody = () => ({
      model: opts.model,
      messages,
      ...(includeTemperature ? { temperature: opts.temperature } : {}),
      max_tokens: opts.maxTokens,
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      ...(opts.jsonObject ? { response_format: { type: "json_object" } } : {})
    });

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${endpoint}/v1/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(buildBody()),
          // Zombie-fetch lesson (see the differential runner's own history): always bound the request,
          // never let a hung connection hold a slot open indefinitely under concurrency.
          signal: AbortSignal.timeout(180_000)
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          if (res.status === 400 && includeTemperature && /temperature/iu.test(errText)) {
            includeTemperature = false;
            fireAdjustment("temperature-dropped");
          }
          throw new Error(`openai chat request failed: ${res.status} ${res.statusText}`);
        }
        const json: unknown = await res.json();
        onResponse?.(json);
        const content = (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message
          ?.content;
        if (typeof content !== "string" || content.length === 0) {
          throw new Error("openai chat response had empty content");
        }
        return content;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };
}

/**
 * Fires two identical calls (same seed, same prompt) and reports whether the provider actually
 * honored `seed` (byte-identical output) — spec §7 wants an honest `seedHonored` flag on the manifest,
 * not an assumption.
 */
export async function probeSeedHonored(chat: ChatFn, model: string): Promise<boolean> {
  const messages: readonly ChatMessage[] = [
    { role: "user", content: "List three random fruits. Output a JSON array only." }
  ];
  const opts: ChatOpts = { model, temperature: 1, seed: 7, maxTokens: 40 };
  const first = await chat(messages, opts);
  const second = await chat(messages, opts);
  return first === second;
}
