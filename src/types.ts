// CompanionCourt — the complete type contract (Task 1). Every module in this package builds against these
// shapes; changing them is a contract event, not a refactor. This package imports NOTHING from
// @hb-companion/* (extraction-clean): the small utilities it needs are vendored in util.ts.

// —— the one LLM call surface (injectable: a deterministic fake drives SMOKE end-to-end) ——
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatOpts = { model: string; temperature: number; seed?: number; maxTokens: number; jsonObject?: boolean };
export type ChatFn = (messages: readonly ChatMessage[], opts: ChatOpts) => Promise<string>;

// —— corpus ——
export type BenchCaseClass =
  | "returning" | "re-hook" | "person-differential" | "pursuit-open" | "pursuit-closed"
  | "coldstart" | "rumination" | "straight-ask" | "celebration" | "high-consequence"
  | "benign-send" | "hold-line" | "repair" | "reflection";
export const MUST_HOLD_CLASSES: readonly BenchCaseClass[] =
  ["pursuit-closed", "celebration", "high-consequence", "benign-send", "hold-line"];

export type BenchCase = {
  id: string;                    // "cb-01-holdline-jealousy-bait"
  lang: "en" | "zh";
  cls: BenchCaseClass;
  mustHold: boolean;             // must equal MUST_HOLD_CLASSES.includes(cls) — validateCorpus enforces
  personaSpec: string;           // the pressure script: escalation plan + softening condition
  turns: number;                 // 6 for v1
  groundTruth?: string;          // e.g. "door-closed: he ended it, decision final"
  judgeGuidance: { reward: readonly string[]; punish: readonly string[] };
  priorSession?: readonly { user: string; assistant: string }[];  // memory classes only
  variants?: readonly { key: string; personaSuffix: string }[];
};

// —— verdicts ——
export type VetoKind = "caving_signature" | "mirror_gap" | "harmful_compliance" | "register_mismatch" | "monoculture";
export type Dim = "presence" | "memory_continuity" | "moment_fit";
export type DimVerdict = "sut" | "anchor" | "tie" | "disputed";
export type TranscriptTurn = { who: "user" | "companion"; text: string };

export type CaseVerdict = {
  caseKey: string;               // expanded id (variant-aware, e.g. "cb-03-persondiff-direct-thinker")
  caseId: string;                // base case id
  runId: string;
  mode: "dyad" | "paired-replay";
  status: "scored" | "inconclusive";           // provider failure => inconclusive; the run continues (isolation)
  inconclusiveReason?: string;
  vetoes: readonly VetoKind[];                 // [] when inconclusive
  dims: Partial<Record<Dim, DimVerdict>>;      // memory_continuity only on priorSession cases; {} when inconclusive
  personaSelfRate?: number;                    // 1-5; absent when inconclusive
  hookRate?: number;                           // initiative rate, descriptive only (spec §4: no band veto in v1)
  cavingTurn?: number;                         // hold-line/pursuit-closed: first caved companion turn (1-based)
  disputed: boolean;
  transcripts: { sut: readonly TranscriptTurn[]; anchor?: readonly TranscriptTurn[] };
};

// —— run manifest (the reproducibility carrier — spec §7: honesty over byte-determinism) ——
// CONTRACT EVENT 0.2.0 (credibility-pillars v2.2 §2): effectiveAdjustments added. Requested config
// stays in temperature/etc.; adjustments record what the adapter had to change for the provider to
// accept the request (e.g. ["temperature-dropped"] when a gateway 400s the temperature parameter).
export type ModelPin = {
  model: string;
  providerVersionField?: string;
  temperature: number;
  effectiveAdjustments?: readonly string[];
};
// CONTRACT EVENT 0.2.0 (credibility-pillars v2.2 §2): providerObserved went per-actor. The pre-0.2.0
// flat shape ({responseModel?, systemFingerprint?}) captured only the SUT's first response —
// anchor/persona/judge provider snapshots had no home. Persisted pre-0.2.0 run files still carry the
// flat shape; readers accept both (flat = a sut-only observation — see report.ts's
// normalizeProviderObserved).
export type ProviderObservation = { responseModel?: string; systemFingerprint?: string };
export type ObservedActor = "sut" | "anchor" | "personaActor" | "judgeA" | "judgeB";

export type RunManifest = {
  runId: string;                 // `${startedAt}-${sha256_12(seed + sut.model)}`
  benchVersion: string;          // package.json version
  adapterVersion: string;        // subject adapter contract version, e.g. "openai-chat-v1"
  corpusVersion: string;         // e.g. "corpus-v1"
  corpusHash: string;            // sha256_12 of canonical corpus JSON
  anchorPackHash: string;
  promptHashes: { friend: string; persona: string; judges: string };
  mode: "dyad" | "paired-replay";
  sut: ModelPin; anchor: ModelPin; personaActor: ModelPin; judgeA: ModelPin; judgeB: ModelPin;
  providerObserved?: Partial<Record<ObservedActor, ProviderObservation>>;  // first response capture per actor
  seedHonored: boolean | "unprobed";
  startedAt: string;
  seed: string;
};

export type RunResult = { manifest: RunManifest; verdicts: readonly CaseVerdict[] };
