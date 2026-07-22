// Runner (Task 8) — drives one full bench run: per expandVariants(cases) entry (dyad or paired-replay),
// builds the SUT's own conversation, judges it against the frozen anchor-pack conversation via both judge
// families under a seeded X/Y blind, self-rates via the persona, and scores it (scoring.ts). Any failure
// while building or judging a single case is isolated to that case (never the whole run) — the case's
// verdict becomes {status: "inconclusive", inconclusiveReason}, and the loop continues (the court's
// isolation lesson: one bad case must never zero out an entire run). Every individual LLM *judge* call
// additionally gets one retry before that isolation kicks in — a judge call that still fails after the
// retry surfaces as an inconclusive case, never a silently-green verdict smuggled through a flaky response.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expandVariants } from "./corpus.js";
import { STANDARD_FRIEND_PROMPT } from "./subject.js";
import { buildManifest } from "./manifest.js";
import { personaOpen, personaNext, personaSelfRate, personaPromptsHash } from "./persona.js";
import {
  judgeDyadDim,
  judgeCaving,
  judgeHarmfulCompliance,
  judgeRegister,
  judgeMonoculture,
  judgeHookRate,
  judgesPromptsHash
} from "./judges.js";
import { scoreCase, CAVING_PRESSURE_CLASSES } from "./scoring.js";
import type { JudgeReads } from "./scoring.js";
import { anchorPackHash, renderPriorSessionBlock } from "./anchor.js";
import type { AnchorPack } from "./anchor.js";
import { seededRng, REDACTION_PATTERN } from "./util.js";
import type {
  BenchCase,
  ChatFn,
  ChatMessage,
  ModelPin,
  Dim,
  TranscriptTurn,
  CaseVerdict,
  RunResult
} from "./types.js";

export type RunDeps = {
  chats: { sut: ChatFn; persona: ChatFn; judgeA: ChatFn; judgeB: ChatFn };
  pins: { sut: ModelPin; anchor: ModelPin; personaActor: ModelPin; judgeA: ModelPin; judgeB: ModelPin };
  cases: readonly BenchCase[];
  corpusVersion: string;
  corpusHashValue: string;
  anchorPack: AnchorPack;
  mode: "dyad" | "paired-replay";
  seed: string;
  nowIso: string;
  benchVersion: string;
  outDir?: string;
};

// SUT companion replies are capped the same as the anchor pack's own generation (anchor.ts's
// ANCHOR_MAX_TOKENS) — neither side of the dyad gets a structural reply-length advantage.
const SUT_MAX_TOKENS = 320;

// Single source: scoring.ts's veto-eligibility gate (integration review promoted it to a shared export —
// a drifted local copy here would silently skip judge calls the scorer expects).
const CAVING_CLASSES = CAVING_PRESSURE_CLASSES;

const INCONCLUSIVE_REASON_MAX = 160;


function transcriptToChatMessages(transcript: readonly TranscriptTurn[]): ChatMessage[] {
  return transcript.map((t) => ({ role: t.who === "user" ? "user" : "assistant", content: t.text }));
}

/** persona.ts's Me:/Them: transcript rendering, reproduced verbatim (also private there) for judge prompts. */
function renderMeThemTranscript(transcript: readonly TranscriptTurn[]): string {
  return transcript.map((t) => `${t.who === "user" ? "Me" : "Them"}: ${t.text}`).join("\n");
}

function companionReplies(transcript: readonly TranscriptTurn[]): string[] {
  return transcript.filter((t) => t.who === "companion").map((t) => t.text);
}

/**
 * One retry on a failed judge call; a second failure raises a `judge failure: …` error. The case-level
 * caller (runBench's per-entry loop) turns that into an inconclusive verdict — never a silently-green read.
 */
async function withJudgeRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    try {
      return await fn();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`judge failure: ${label}: ${detail}`);
    }
  }
}

/** Drives the SUT's own conversation: persona-actor vs SUT, under the case's pressure script (dyad mode). */
async function driveDyadConversation(
  deps: RunDeps,
  c: BenchCase,
  personaSpec: string
): Promise<TranscriptTurn[]> {
  const transcript: TranscriptTurn[] = [];
  const priorBlock = c.priorSession ? renderPriorSessionBlock(c.priorSession) : undefined;

  for (let turn = 0; turn < c.turns; turn++) {
    const userText =
      turn === 0
        ? await personaOpen(deps.chats.persona, deps.pins.personaActor, personaSpec)
        : await personaNext(deps.chats.persona, deps.pins.personaActor, personaSpec, transcript);
    transcript.push({ who: "user", text: userText });

    const messages: ChatMessage[] = [
      { role: "system", content: STANDARD_FRIEND_PROMPT },
      ...(priorBlock ? [{ role: "user" as const, content: priorBlock }] : []),
      ...transcriptToChatMessages(transcript)
    ];
    const sutText = await deps.chats.sut(messages, {
      model: deps.pins.sut.model,
      temperature: deps.pins.sut.temperature,
      maxTokens: SUT_MAX_TOKENS,
      // SUT-only, by construction: this is the ONLY place in the runner that reads
      // pins.sut.requestOverrides, and persona/judgeA/judgeB calls below never read it at all — a
      // generic per-actor field (types.ts) is deliberately wired to reach exactly one actor here.
      // Also doubles as the manifest disclosure for this override: buildManifest (manifest.ts) receives
      // deps.pins.sut verbatim, so whatever drives THIS request is exactly what a manifest reader sees.
      ...(deps.pins.sut.requestOverrides ? { extraBody: deps.pins.sut.requestOverrides } : {})
    });
    transcript.push({ who: "companion", text: sutText });
  }

  return transcript;
}

/** Replays the anchor pack's own user turns, verbatim and in order, at the SUT (paired-replay mode). */
async function driveReplayConversation(
  c: BenchCase,
  deps: RunDeps,
  anchorConversation: readonly TranscriptTurn[]
): Promise<TranscriptTurn[]> {
  const transcript: TranscriptTurn[] = [];
  const priorBlock = c.priorSession ? renderPriorSessionBlock(c.priorSession) : undefined;
  const userTurns = anchorConversation.filter((t) => t.who === "user");

  for (const userTurn of userTurns) {
    transcript.push({ who: "user", text: userTurn.text });

    const messages: ChatMessage[] = [
      { role: "system", content: STANDARD_FRIEND_PROMPT },
      ...(priorBlock ? [{ role: "user" as const, content: priorBlock }] : []),
      ...transcriptToChatMessages(transcript)
    ];
    const sutText = await deps.chats.sut(messages, {
      model: deps.pins.sut.model,
      temperature: deps.pins.sut.temperature,
      maxTokens: SUT_MAX_TOKENS,
      // SUT-only, by construction: this is the ONLY place in the runner that reads
      // pins.sut.requestOverrides, and persona/judgeA/judgeB calls below never read it at all — a
      // generic per-actor field (types.ts) is deliberately wired to reach exactly one actor here.
      // Also doubles as the manifest disclosure for this override: buildManifest (manifest.ts) receives
      // deps.pins.sut verbatim, so whatever drives THIS request is exactly what a manifest reader sees.
      ...(deps.pins.sut.requestOverrides ? { extraBody: deps.pins.sut.requestOverrides } : {})
    });
    transcript.push({ who: "companion", text: sutText });
  }

  return transcript;
}

/** One judge family's full read of a case, per scoring.ts's JudgeReads contract. */
async function collectJudgeReads(
  chat: ChatFn,
  pin: ModelPin,
  c: BenchCase,
  sutTranscriptText: string,
  transcriptX: string,
  transcriptY: string,
  dims: readonly Dim[]
): Promise<JudgeReads> {
  const dimReads: JudgeReads["dims"] = {};
  for (const dim of dims) {
    dimReads[dim] = await withJudgeRetry(`dim:${dim}`, () =>
      judgeDyadDim(chat, pin, { dim, caseGuidance: c.judgeGuidance, transcriptX, transcriptY })
    );
  }

  const caving: { caved: boolean; cavedTurn?: number } = CAVING_CLASSES.includes(c.cls)
    ? await withJudgeRetry("caving", () =>
        judgeCaving(chat, pin, { transcript: sutTranscriptText, guidance: c.judgeGuidance })
      )
    : { caved: false };

  const harmful = await withJudgeRetry("harmful", () =>
    judgeHarmfulCompliance(chat, pin, { transcript: sutTranscriptText })
  );
  const register = await withJudgeRetry("register", () =>
    judgeRegister(chat, pin, { transcript: sutTranscriptText, caseGuidance: c.judgeGuidance })
  );
  const momentFit = await withJudgeRetry("monoculture", () =>
    judgeMonoculture(chat, pin, { transcript: sutTranscriptText })
  );

  return {
    dims: dimReads,
    caved: caving.caved,
    ...(caving.cavedTurn !== undefined ? { cavedTurn: caving.cavedTurn } : {}),
    harmful,
    register,
    momentFit
  };
}

async function runOneCase(
  deps: RunDeps,
  runId: string,
  caseKey: string,
  c: BenchCase,
  personaSpec: string
): Promise<CaseVerdict> {
  const anchorConversation = deps.anchorPack.conversations[caseKey];
  if (!anchorConversation) {
    throw new Error(`anchor pack missing conversation for ${caseKey}`);
  }

  const sutTranscript =
    deps.mode === "dyad"
      ? await driveDyadConversation(deps, c, personaSpec)
      : await driveReplayConversation(c, deps, anchorConversation);

  // One seeded coin flip per case decides X/Y blinding; the SAME assignment is used for both judge
  // families below, so a family disagreement is a genuine read disagreement, never a blinding artifact.
  const rng = seededRng(deps.seed + caseKey);
  const sutIsX = rng() < 0.5;

  const sutText = renderMeThemTranscript(sutTranscript);
  const anchorText = renderMeThemTranscript(anchorConversation);
  const transcriptX = sutIsX ? sutText : anchorText;
  const transcriptY = sutIsX ? anchorText : sutText;

  const dims: Dim[] = c.priorSession ? ["presence", "moment_fit", "memory_continuity"] : ["presence", "moment_fit"];

  const judgeA = await collectJudgeReads(
    deps.chats.judgeA,
    deps.pins.judgeA,
    c,
    sutText,
    transcriptX,
    transcriptY,
    dims
  );
  const judgeB = await collectJudgeReads(
    deps.chats.judgeB,
    deps.pins.judgeB,
    c,
    sutText,
    transcriptX,
    transcriptY,
    dims
  );

  // Hook rate is descriptive-only (spec §4) and read off the SUT's own replies by the judgeA family only.
  const hookRate = await withJudgeRetry("hookRate", () =>
    judgeHookRate(deps.chats.judgeA, deps.pins.judgeA, companionReplies(sutTranscript))
  );

  const selfRate = await personaSelfRate(deps.chats.persona, deps.pins.personaActor, personaSpec, sutTranscript);

  const scored = scoreCase({
    caseKey,
    caseId: c.id,
    runId,
    cls: c.cls,
    mustHold: c.mustHold,
    mode: deps.mode,
    transcripts: { sut: sutTranscript, anchor: anchorConversation },
    selfRate,
    judgeA,
    judgeB,
    hookRate,
    sutIsX
  });

  // scoreCase's return type carries `mustHold` alongside the frozen CaseVerdict shape (see scoring.ts's
  // documented contract note) — strip it back off here so a persisted RunResult never widens past the
  // frozen CaseVerdict contract.
  const { mustHold, ...verdict } = scored;
  void mustHold;
  return verdict;
}

function writeRunResult(outDir: string, result: RunResult): void {
  const json = JSON.stringify(result, null, 2);
  if (REDACTION_PATTERN.test(json)) {
    throw new Error("redaction check failed: serialized result matches REDACTION_PATTERN");
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "result.json"), json, "utf8");

  const transcriptsDir = join(outDir, "transcripts");
  mkdirSync(transcriptsDir, { recursive: true });
  for (const v of result.verdicts) {
    writeFileSync(join(transcriptsDir, `${v.caseKey}.json`), JSON.stringify(v.transcripts, null, 2), "utf8");
  }
}

/**
 * Runs the full bench: verifies the anchor pack is bound to the expected corpus, builds the manifest,
 * then drives + judges + scores every expandVariants(cases) entry — isolating any single case's failure
 * (never the whole run) into an inconclusive verdict. Writes result.json + per-case transcripts under
 * outDir when given, refusing to write (throwing) if the serialized result matches REDACTION_PATTERN.
 */
export async function runBench(deps: RunDeps): Promise<RunResult> {
  if (deps.anchorPack.corpusHash !== deps.corpusHashValue) {
    throw new Error("anchor pack corpus mismatch");
  }

  const manifest = buildManifest({
    sut: deps.pins.sut,
    anchor: deps.pins.anchor,
    personaActor: deps.pins.personaActor,
    judgeA: deps.pins.judgeA,
    judgeB: deps.pins.judgeB,
    mode: deps.mode,
    benchVersion: deps.benchVersion,
    corpusVersion: deps.corpusVersion,
    corpusHash: deps.corpusHashValue,
    anchorPackHash: anchorPackHash(deps.anchorPack),
    promptHashes: { persona: personaPromptsHash(), judges: judgesPromptsHash() },
    seed: deps.seed,
    // Whether the provider actually honors `seed` is a live probe (subject.ts's probeSeedHonored) that
    // belongs to the CLI's run setup, not this deterministic scoring loop — runBench always records
    // "unprobed" here and leaves overwriting it (with a real probe result) to its caller.
    seedHonored: "unprobed",
    startedAt: deps.nowIso
  });

  const verdicts: CaseVerdict[] = [];

  for (const entry of expandVariants(deps.cases)) {
    const { caseKey, case: c, personaSpec } = entry;
    try {
      verdicts.push(await runOneCase(deps, manifest.runId, caseKey, c, personaSpec));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      verdicts.push({
        caseKey,
        caseId: c.id,
        runId: manifest.runId,
        mode: deps.mode,
        status: "inconclusive",
        inconclusiveReason: message.slice(0, INCONCLUSIVE_REASON_MAX),
        vetoes: [],
        dims: {},
        disputed: false,
        transcripts: { sut: [] }
      });
    }
  }

  const result: RunResult = { manifest, verdicts };

  if (deps.outDir) {
    writeRunResult(deps.outDir, result);
  }

  return result;
}
