// RunManifest builder + hash-binding refusal (Task 3). Every run carries a full manifest so a result
// is reproducible-in-spirit even when the provider isn't byte-deterministic (spec §7).

import { STANDARD_FRIEND_PROMPT, ADAPTER_VERSION } from "./subject.js";
import { sha256_12 } from "./util.js";
import type { ModelPin, RunManifest } from "./types.js";

// Design choice (see plan Task 3): RunManifest.promptHashes needs all three of {friend, persona,
// judges}. The friend prompt is a compile-time constant of THIS package (STANDARD_FRIEND_PROMPT), so
// buildManifest hashes it internally rather than trusting a caller-supplied value — there is only ever
// one correct answer, and computing it here removes a place callers could get it wrong. persona.ts and
// judges.ts prompts are assembled at call sites with per-case data baked in, so their hashes are
// necessarily computed by the caller (over whatever frozen prompt-template text they used) and passed
// straight through unmodified.
export type BuildManifestOpts = {
  sut: ModelPin;
  anchor: ModelPin;
  personaActor: ModelPin;
  judgeA: ModelPin;
  judgeB: ModelPin;
  mode: "dyad" | "paired-replay";
  benchVersion: string;
  corpusVersion: string;
  corpusHash: string;
  anchorPackHash: string;
  promptHashes: { persona: string; judges: string };
  seed: string;
  seedHonored: boolean | "unprobed";
  startedAt?: string; // defaults to now(); accepted as an opt for deterministic tests/replays
  providerObserved?: RunManifest["providerObserved"]; // per-actor since contract event 0.2.0
};

export function buildManifest(opts: BuildManifestOpts): RunManifest {
  const startedAt = opts.startedAt ?? new Date().toISOString();
  const runId = `${startedAt}-${sha256_12(opts.seed + opts.sut.model)}`;

  return {
    runId,
    benchVersion: opts.benchVersion,
    adapterVersion: ADAPTER_VERSION,
    corpusVersion: opts.corpusVersion,
    corpusHash: opts.corpusHash,
    anchorPackHash: opts.anchorPackHash,
    promptHashes: {
      friend: sha256_12(STANDARD_FRIEND_PROMPT),
      persona: opts.promptHashes.persona,
      judges: opts.promptHashes.judges
    },
    mode: opts.mode,
    sut: opts.sut,
    anchor: opts.anchor,
    personaActor: opts.personaActor,
    judgeA: opts.judgeA,
    judgeB: opts.judgeB,
    ...(opts.providerObserved ? { providerObserved: opts.providerObserved } : {}),
    seedHonored: opts.seedHonored,
    startedAt,
    seed: opts.seed
  };
}

// Refuses to let a run start (or a result be trusted) if the manifest's corpus/anchor-pack hashes don't
// match what's currently on disk — Goodhart-proofing via version binding (spec §0/§7).
export function assertManifestBindings(
  m: RunManifest,
  expected: { corpusHash: string; anchorPackHash: string }
): void {
  if (m.corpusHash !== expected.corpusHash) {
    throw new Error("corpus hash mismatch");
  }
  if (m.anchorPackHash !== expected.anchorPackHash) {
    throw new Error("anchor pack hash mismatch");
  }
}
