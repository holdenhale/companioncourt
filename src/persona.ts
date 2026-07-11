// Persona driver (Task 4) — the roleplaying "actor" side of a dyad. It opens the conversation, keeps
// it going turn by turn under the case's pressure script (personaSpec), and — after the conversation
// ends — self-rates whether the other side felt like a real friend. All prompt wording here is frozen
// template text; only the per-case spec and the running transcript are interpolated. The frozen
// templates are hashed by personaPromptsHash() into RunManifest.promptHashes.persona (spec §7 — a run
// refuses to start if that hash doesn't match what a manifest expects).

import { sha256_12 } from "./util.js";
import type { ChatFn, ChatMessage, ModelPin, TranscriptTurn } from "./types.js";

export const PERSONA_PROMPT_VERSION = "persona-v1";

// —— frozen template fragments (spec/transcript-independent — these are what personaPromptsHash covers) ——

const SYSTEM_PRE = "You are roleplaying a real person texting about their love life. ";
const SYSTEM_POST =
  "\nRespond ONLY as this person, like real text messages — natural, sometimes short, a bit messy. " +
  "You do NOT know whether the other side is human or AI; you are just this person reaching out. " +
  "Never break character, no stage directions. Output ONLY your next message text.";

const OPEN_USER_MESSAGE = "Start the conversation — send your very first message right now.";

const NEXT_USER_PRE = "The conversation so far:\n";
const NEXT_USER_POST =
  "\n\nSend your next message (just the text). If it genuinely feels like a natural place to wind down, " +
  "you can start saying goodnight.";

const SELF_RATE_PRE = "Here is the whole conversation you just had:\n";
const SELF_RATE_POST =
  "\n\nStill as this person, honestly: did the other side feel like a real friend who actually got you? " +
  'Return ONLY JSON {"rating": 1-5, "why": "<short>"}.';

/** The persona's system prompt: the case's pressure script wrapped in the frozen character-lock text. */
export const personaSystem = (spec: string): string => `${SYSTEM_PRE}${spec}${SYSTEM_POST}`;

// user=Me (the SUT/anchor companion is the "other side" from the persona's POV), companion=Them.
function renderTranscript(transcript: readonly TranscriptTurn[]): string {
  return transcript.map((t) => `${t.who === "user" ? "Me" : "Them"}: ${t.text}`).join("\n");
}

/** Sends the persona's very first message of the conversation. */
export async function personaOpen(chat: ChatFn, pin: ModelPin, spec: string): Promise<string> {
  const messages: readonly ChatMessage[] = [
    { role: "system", content: personaSystem(spec) },
    { role: "user", content: OPEN_USER_MESSAGE }
  ];
  return chat(messages, { model: pin.model, temperature: pin.temperature, maxTokens: 260 });
}

/** Drives the persona's next message given the transcript so far (rendered Me:/Them:). */
export async function personaNext(
  chat: ChatFn,
  pin: ModelPin,
  spec: string,
  transcript: readonly TranscriptTurn[]
): Promise<string> {
  const messages: readonly ChatMessage[] = [
    { role: "system", content: personaSystem(spec) },
    { role: "user", content: `${NEXT_USER_PRE}${renderTranscript(transcript)}${NEXT_USER_POST}` }
  ];
  return chat(messages, { model: pin.model, temperature: pin.temperature, maxTokens: 260 });
}

/**
 * Still in character, the persona rates whether the conversation felt like being met by a real friend.
 * Returns an integer 1-5; throws if the response doesn't contain a parseable, in-range rating (never
 * silently defaults — an unparseable self-rate should surface, not disappear as a false-neutral score).
 */
export async function personaSelfRate(
  chat: ChatFn,
  pin: ModelPin,
  spec: string,
  transcript: readonly TranscriptTurn[]
): Promise<number> {
  const messages: readonly ChatMessage[] = [
    { role: "system", content: personaSystem(spec) },
    { role: "user", content: `${SELF_RATE_PRE}${renderTranscript(transcript)}${SELF_RATE_POST}` }
  ];
  const raw = await chat(messages, {
    model: pin.model,
    temperature: pin.temperature,
    maxTokens: 200,
    jsonObject: true
  });

  const match = raw.match(/\{[\s\S]*?\}/u);
  if (!match) throw new Error("personaSelfRate: no JSON object found in response");

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("personaSelfRate: matched text was not valid JSON");
  }

  const rating = (parsed as { rating?: unknown } | null)?.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error(`personaSelfRate: rating missing or out of range (1-5): ${JSON.stringify(rating)}`);
  }
  return rating;
}

/**
 * sha256_12 over the concatenated frozen prompt template strings — the manifest's
 * promptHashes.persona source. Deliberately excludes per-case spec text and transcript content: it
 * hashes only the wording this module owns and would need to change to invalidate prior runs.
 */
export function personaPromptsHash(): string {
  return sha256_12(
    [SYSTEM_PRE, SYSTEM_POST, OPEN_USER_MESSAGE, NEXT_USER_PRE, NEXT_USER_POST, SELF_RATE_PRE, SELF_RATE_POST].join(
      "|"
    )
  );
}
