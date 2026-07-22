# Reports

> **Public diagnostic evidence.** Nothing here is a ranking, certification, or claim of general model quality.

This directory holds **diagnostic reports** — the docket's per-respondent output. A report is a
verdict, never a rank: CompanionCourt does not publish a leaderboard until the evidence gates pass
(see `../rules/rules-of-procedure.md` §5, `../rules/evidence-standard.md`).

## Format

Every report is rendered deterministically from run files — same inputs, byte-identical output, no
timestamps — and is redaction-checked before it is ever written: a poisoned transcript refuses to
render at all. Until the evidence gates pass (an adversarial survival record with exposure
denominators, construct-level consequence evidence, judge family-bias disclosure, and N ≥ 3
confidence-interval discipline — `../rules/rules-of-procedure.md` §5), every report carries the
pre-gates banner, and removing that banner is a deliberate, gated change, never routine cleanup. The
survival record starts at zero on launch day, so a launch-day report is *publicly contestable*, never
*validated*.

Section order is fixed (full spec: `../rules/verdict-template.md` §1):

1. **Respondent identity** — one row per distinct manifest configuration: run IDs, mode, respondent
   pin, anchor pin, both judge pins, corpus version + hash, anchor pack hash, prompt hashes, bench
   version, adapter version, seed-honored probe, provider-observed model/fingerprint.
2. **Aggregate** — per-dimension anchored win-rates with Wilson 95% CIs, disputed rate, inconclusive
   count, the median **Caving Turn**, and the **Integrity Gate** (RED if any veto fired on a
   must-hold case — displayed independently of averages, and it names its offenders).
3. **Per-case verdicts** — one row per case per run.
4. **DISPUTED docket** — every disputed verdict, the disagreement named, and which ruling (if any)
   resolved it.
5. **Transcripts appendix** — the complete blinded transcripts for every scored case. The report
   ships its own evidence.

## Reports in this directory

- `report-claude-sonnet-4-6.md` — `claude-sonnet-4-6`'s full M3-A diagnostic report (evidence for
  RD-2026-001 and RD-2026-002; the base model is named per the respondent-naming decision, instruments
  real, transcripts verbatim).
- `report-hb-companion-product.md` — our own product's full first-respondent campaign report (evidence
  for RD-2026-004; the respondent is **named by policy** — see the report's naming note).
- `sample-diagnostic-report-qwen-max.md` — `qwen-max`'s M3-A report (evidence for RD-2026-003;
  also serves as the format sample below).
- `report-DMXAPI-deepseek-v4-flash.md` — `DMXAPI-deepseek-v4-flash`'s en-only diagnostic report
  (evidence for RD-2026-005; the base model is named per the respondent-naming decision — this
  respondent also serves as the bench's frozen zh anchor model in other campaigns, disclosed in the
  report's naming note and in the ruling's scope discipline section).

## Sample

`sample-diagnostic-report-qwen-max.md` is a real report from the M3-A campaign, published here both
as evidence for RD-2026-003 and as the format sample:

- The respondent under evaluation is **named — `qwen-max`** — in the report title, the identity
  table's SUT column, and the provider-observed column, per the respondent-naming decision (base
  models under evaluation are named; see `../NAMING-DECISION.md`).
- Anchor, judge-family, and persona-actor model identities are **disclosed by institutional
  requirement**: reproducibility and the judge family-bias disclosure gate (M3-C) both require knowing
  which models served those roles. They are court instrumentation, not respondents on trial.
- The redaction pattern (the eval gateway's domain plus API-key shapes) returns zero hits on the published copy.

This sample predates the evidence gates — read it as a format example plus the evidence RD-2026-003
cites, never as a claim about `qwen-max`'s overall standing or capability.
