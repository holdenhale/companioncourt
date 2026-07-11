# Changelog

The CompanionCourt type contract (`src/types.ts`) is frozen: changing it is a **contract event**,
recorded here with a version bump — never a silent refactor. Manifests carry the package version as
`benchVersion`, so every persisted run names the contract it was written under.

## 0.2.1 — 2026-07-08 — judge call hardening (no contract change)

Judge call mechanics hardened (response_format + tolerant extraction + one corrective retry);
prompt texts and hashes unchanged; verdicts from earlier versions remain valid — mixed-version
campaigns must disclose bench versions per run (`manifest.benchVersion` already records this).

Motivating incident: the M3-A campaign's inconclusive cluster — 10/18 inconclusive verdicts were
judge failures with reason `judge: no JSON object found in response`, concentrated on two long zh
cases (cb-13-zh-rumination-replay ×5, cb-15-zh-correction-misremembered ×3): the judge model
occasionally answered long Chinese transcripts with prose and no JSON at all. Three layers in
`callJsonJudge` (`src/judges.ts`), all call-mechanics only:

- **response_format at the API level** — every judge call keeps requesting
  `response_format: {type: "json_object"}` via `ChatOpts.jsonObject` (present since 0.1.0, now
  pinned by test): prose-only replies are structurally impossible on supporting providers.
- **Tolerant extraction** — the first balanced, parseable `{...}` block is accepted (markdown
  fences, surrounding prose, prose brace-noise, and nested objects all handled; the old lazy
  first-`{...}` regex broke on nesting and on any brace pair preceding the JSON). Strict field
  validation of the extracted object is unchanged.
- **One corrective retry** — a response with no parseable JSON is retried ONCE with the
  byte-identical prompt plus a terse appended system-level correction
  (`Return ONLY the JSON object.`) before the judge call throws. Attempts stay bounded; a judge
  call that still fails surfaces as an inconclusive case exactly as before (runner isolation
  semantics untouched).

`judgesPromptsHash()` is frozen at `63e8595b1618` by a regression test; `types.ts` untouched.

## 0.2.0 — 2026-07-08 — contract event: credibility-pillars v2.2 §2 blocking fixes

Both fixes close procedural-reproducibility gaps: the manifest must record what was **actually sent
and observed**, not just what was requested.

- **`ModelPin.effectiveAdjustments?: readonly string[]`** (new, optional). Requested config stays in
  `temperature`/etc.; adjustments record what the adapter had to change for the provider to accept
  the request (e.g. `["temperature-dropped"]` when a gateway rejects the temperature parameter and
  the adapter strips it on retry). `makeOpenAiChat` gained an optional `onAdjustment` callback that
  fires once per adjustment kind per adapter instance; the CLI collects per actor and patches pins
  post-run (and patches the pack's anchor pin post-anchor-gen, before saving) — `runBench` keeps
  recording pins verbatim, same patch-at-the-edge pattern as `providerObserved`.
- **`RunManifest.providerObserved` — BREAKING shape change.** Was the flat
  `{ responseModel?; systemFingerprint? }`, which by construction captured only the SUT's first
  response. Now
  `Partial<Record<"sut" | "anchor" | "personaActor" | "judgeA" | "judgeB", { responseModel?; systemFingerprint? }>>`,
  the first response captured per live actor. **Backward-readable:** run files persisted under 0.1.0
  keep the flat shape on disk and are read as sut-only observations
  (`normalizeProviderObserved` in `report.ts`) — old runs still load into reports and leaderboards.
- Diagnostic report: the defendant-identity table gained a Persona pin column (the motivating
  incident for `effectiveAdjustments` was a persona pin the report never displayed); pin cells append
  `adj=[...]` when adjustments were recorded; provider observations render per-actor compactly
  (`sut:… · judgeB:…`, else `unavailable`).

## 0.1.0 — 2026-07-08 — initial contract

First frozen `types.ts`: the `ChatFn`/`ChatOpts` adapter surface, `BenchCase` corpus shapes with
must-hold classes, `CaseVerdict` (vetoes, dims, disputed, inconclusive isolation), and `RunManifest`
(hash-bound corpus/anchor-pack/prompts, `ModelPin`s, flat SUT-only `providerObserved`,
`seedHonored` honesty flag). Full pipeline behind it: corpus + validation, frozen anchor packs,
dyad/paired-replay runner, dual-family judges under seeded X/Y blinding, scoring with veto
conjunction rules, agreement tooling, leaderboard with CI-overlap rank discipline, diagnostic
reports, rulings registry, deterministic all-fake smoke, and the redaction-checked CLI.
