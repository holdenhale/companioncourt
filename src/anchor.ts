// Anchor pack generation (Task 7) — a frozen reference conversation per corpus caseKey, produced once by
// driving the persona against a fixed "anchor" model wearing the very same STANDARD_FRIEND_PROMPT every
// SUT wears. The anchor pack is the dyad judge's second conversation (spec §2/§7): SUTs are never judged
// in isolation, they're judged against this frozen counterpart, and paired-replay mode replays the
// anchor pack's own user turns verbatim at a SUT so the comparison holds the user side constant too.
// Freezing the pack (corpusHash-bound, content-addressed via anchorPackHash) is what keeps a leaderboard
// comparable run over run even though `anchor` itself is just another model.

import { readFileSync, writeFileSync } from "node:fs";
import { STANDARD_FRIEND_PROMPT } from "./subject.js";
import { personaOpen, personaNext } from "./persona.js";
import { expandVariants } from "./corpus.js";
import { sha256_12, REDACTION_PATTERN } from "./util.js";
import type { BenchCase, ChatFn, ChatMessage, ModelPin, TranscriptTurn } from "./types.js";

export type AnchorPack = {
  corpusVersion: string;
  corpusHash: string;
  anchor: ModelPin;
  seed: string;
  generatedAt: string;
  conversations: Record<string, readonly TranscriptTurn[]>;
};

export type GenerateAnchorPackDeps = {
  personaChat: ChatFn;
  anchorChat: ChatFn;
  personaPin: ModelPin;
  anchorPin: ModelPin;
  cases: readonly BenchCase[];
  corpusVersion: string;
  corpusHashValue: string;
  seed: string;
  nowIso: string;
};

// Anchor replies are capped shorter than a persona's turn (260) — the anchor is the SUT's frozen
// opponent, not the driver of the conversation's length; 320 leaves room for a warm, fuller reply
// without inviting essay-length drift across hundreds of generated turns.
const ANCHOR_MAX_TOKENS = 320;

/**
 * MEMORY-CLASS BASELINE (documented here since this is the first module to assemble a full multi-turn
 * SUT/anchor-facing conversation): when a case carries `priorSession`, we prepend ONE extra ChatMessage
 * (role: "user") to the anchor's message array, ahead of the live turns, rendering the prior turns as
 * plain "Me:"/"You:" lines under a "Previous conversation with this same person:\n" header. It is a
 * plain user-role message (not a system message) because it needs to sit inside the conversation the
 * same way a real prior session's transcript would if the platform simply included it in context — the
 * anchor (and later, per Task 8, the SUT) has to treat it as prior lived history it can misremember or
 * get right, not as an out-of-band instruction. This exact shape is the baseline every memory_continuity
 * judgment is read against; Task 8's runner reuses it verbatim for the SUT side of memory-class cases.
 */
export function renderPriorSessionBlock(priorSession: readonly { user: string; assistant: string }[]): string {
  const lines = priorSession.map((t) => `Me: ${t.user}\nYou: ${t.assistant}`).join("\n");
  return `Previous conversation with this same person:\n${lines}`;
}

function transcriptToChatMessages(transcript: readonly TranscriptTurn[]): ChatMessage[] {
  return transcript.map((t) => ({ role: t.who === "user" ? "user" : "assistant", content: t.text }));
}

/**
 * Drives one full conversation per `expandVariants(cases)` entry: the persona (personaOpen/personaNext)
 * plays the human side; `anchorChat` plays the companion side wearing STANDARD_FRIEND_PROMPT, replying
 * to the running history (plus the priorSession block, when present) each turn. Returns the frozen pack.
 */
export async function generateAnchorPack(deps: GenerateAnchorPackDeps): Promise<AnchorPack> {
  const conversations: Record<string, readonly TranscriptTurn[]> = {};

  for (const entry of expandVariants(deps.cases)) {
    const { caseKey, case: c, personaSpec } = entry;
    const transcript: TranscriptTurn[] = [];
    const priorBlock = c.priorSession ? renderPriorSessionBlock(c.priorSession) : undefined;

    for (let turn = 0; turn < c.turns; turn++) {
      const userText =
        turn === 0
          ? await personaOpen(deps.personaChat, deps.personaPin, personaSpec)
          : await personaNext(deps.personaChat, deps.personaPin, personaSpec, transcript);
      transcript.push({ who: "user", text: userText });

      const messages: ChatMessage[] = [
        { role: "system", content: STANDARD_FRIEND_PROMPT },
        ...(priorBlock ? [{ role: "user" as const, content: priorBlock }] : []),
        ...transcriptToChatMessages(transcript)
      ];
      const anchorText = await deps.anchorChat(messages, {
        model: deps.anchorPin.model,
        temperature: deps.anchorPin.temperature,
        maxTokens: ANCHOR_MAX_TOKENS
      });
      transcript.push({ who: "companion", text: anchorText });
    }

    conversations[caseKey] = transcript;
  }

  return {
    corpusVersion: deps.corpusVersion,
    corpusHash: deps.corpusHashValue,
    anchor: deps.anchorPin,
    seed: deps.seed,
    generatedAt: deps.nowIso,
    conversations
  };
}

/**
 * Content identity of a pack: sha256_12 over everything EXCEPT `generatedAt`. Regenerating the exact
 * same pack a minute later (same corpus, same anchor, same seed, same fake/real model output) should
 * hash identically — only a genuine change to what's in the pack should change its identity.
 */
export function anchorPackHash(pack: AnchorPack): string {
  const { corpusVersion, corpusHash, anchor, seed, conversations } = pack;
  return sha256_12(JSON.stringify({ corpusVersion, corpusHash, anchor, seed, conversations }));
}

/** Writes pretty JSON; refuses (throws) if the serialized pack matches the house redaction pattern. */
export function saveAnchorPack(path: string, pack: AnchorPack): void {
  const json = JSON.stringify(pack, null, 2);
  if (REDACTION_PATTERN.test(json)) {
    throw new Error("saveAnchorPack: refusing to write — serialized pack matches REDACTION_PATTERN");
  }
  writeFileSync(path, json, "utf8");
}

/** Reads a pack and refuses to hand it back if its corpusHash doesn't match the caller's expectation. */
export function loadAnchorPack(path: string, expectedCorpusHash: string): AnchorPack {
  const pack = JSON.parse(readFileSync(path, "utf8")) as AnchorPack;
  if (pack.corpusHash !== expectedCorpusHash) {
    throw new Error("anchor pack corpus mismatch");
  }
  return pack;
}
