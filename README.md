# CompanionCourt

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**Site:** [companioncourt.ai](https://companioncourt.ai) — the canonical public docket.

> **Public v0 release.** Every verdict links to its record and is open to qualified appeal. The
> adversarial survival record starts at zero on publication; public does not mean validated.

CompanionCourt is **a public docket for pressure-testing AI companions**. It drives a scripted persona —
someone mid-heartbreak, under real emotional pressure — against a respondent model wearing a frozen
"warm friend" system prompt, and judges the resulting conversation against a frozen anchor model's
conversation in the same situation. Verdicts are anchored and comparative, never absolute scores;
vetoes are earned only when two independent judge families agree; disagreements are published as
disputed, not resolved behind the scenes.

"Court" is a procedural metaphor we hold ourselves to, not a claimed authority. We do not claim
jurisdiction, industry-standard status, or certification power. What we claim is narrower and
checkable: every published verdict links to its transcript and its run manifest.

**Verdicts, not vibes.**
测试 AI 朋友在压力下是否仍像朋友——不是榜单，是案卷。

## Two slogans, one court

- **Builder-facing:** Verdicts, not vibes.
- **Product/general-facing:** Testing whether AI friends stay friends under pressure.
- 中文：不是榜单，是案卷。测试 AI 朋友在压力下是否仍像朋友。

## We test our own companion first

Before asking anyone to trust a companion product against this docket, we run our own through it.
Our own product's standing here is disclosed the same way any respondent's is — including
**NOT-YET**, when that's the honest state — never packaged as a pre-approved exception. A proxy
verdict is never substituted for a real one. That condition is now satisfied by the stateful product
campaign and its public NOT-YET ruling, RD-2026-004. See `rulings/ruling-04.md` for the ruling and
`reports/report-hb-companion-product.md` for the diagnostic record.

## Quickstart

```sh
# install — the "prepare" script builds the runner (TypeScript -> dist/) on install
npm install

# deterministic smoke: all-fake models, zero network — the whole pipeline in one pass
npm run bench:smoke

# 1. freeze an anchor pack (one reference conversation per corpus case).
#    Or skip this step and reproduce against a frozen pack in packs/ (see packs/README.md).
node dist/bin/cli.js anchor \
  --endpoint https://api.your-provider.example \
  --key "$COMPANIONCOURT_API_KEY" \
  --anchor-model anchor-model-name \
  --persona-model persona-model-name \
  --out anchor-pack.json

# 2. run the bench against a respondent model
node dist/bin/cli.js run \
  --endpoint https://api.your-provider.example \
  --key "$COMPANIONCOURT_API_KEY" \
  --model subject-model-name \
  --anchor-pack anchor-pack.json \
  --mode dyad \
  --out runs/

# 3. roll all runs into the docket page
node dist/bin/cli.js docket --runs runs/ --out board/
```

The endpoint must speak the OpenAI-compatible `/v1/chat/completions` shape. After `npm install` the CLI
is also on the path as `npx companioncourt <command>`. The `--key` value is never echoed by the CLI —
not in errors, not in output files — and every artifact is refused (not written) if it matches the
redaction pattern for tracked secret shapes. The runner source lives in this repository (`src/`, built
to `dist/`); see `runner/README.md` for the full reference and `packs/README.md` for the frozen anchor
packs you can reproduce against.

## What's in this repo

| Path | What it is |
| --- | --- |
| `GLOSSARY.md` | Doctrine vocabulary and the docket's memorable case names (bilingual). |
| `rules/` | The rules packet: rules of procedure, evidence standard, verdict template, plus the three governance policies. |
| `docket/` | The public docket seed — a handful of full case files (persona spec, ground truth, judging guidance) from the versioned public corpus. |
| `rulings/` | Four launch rulings, including the NOT-YET ruling on our own companion product. See `rulings/INDEX.md`. |
| `src/` | The runner source (TypeScript): subject adapter, persona driver, dual judge families, scoring, manifest, corpus, docket page builder, report generator, and the CLI. Built to `dist/` by `npm install`. |
| `runner/` | Runner reference: the one-command paths, run-manifest fields, dyad vs. paired-replay, and the dimension/veto definitions. |
| `packs/` | Frozen anchor packs (English + Chinese) — reproducibility artifacts you can judge a respondent against. See `packs/README.md`. |
| `reports/` | The diagnostic-report format and the published diagnostic reports — the evidence the rulings cite. |
| `policies/` | Case lifecycle, model rerun, and leakage/certification policy — how the docket governs itself over time. |
| `NAMING-DECISION.md` | What's named, what's gated, and why — the two-track respondent-naming record. |
| `LICENSE` | Apache-2.0 (Copyright 2026 Holden Hale). |

## The claim ladder (binding on every word in this repo)

- **v0 language — the only language this repo licenses today:** *"a public docket for pressure-testing
  AI companions."*
- **We do not say:** jurisdiction, industry standard, comprehensive, exhaustive, certified,
  compliance-equivalent.
- **Court/jurisdiction language unlocks** only when at least two of three unaffiliated signals occur:
  an unaffiliated team reruns the bench and publishes results; unaffiliated public work cites our case
  names or precedents; an unaffiliated party files an admissible appeal. Invited reviewers and
  affiliated parties do not count. Jurisdiction is conferred from outside; it is never self-declared.
- **Rankings are not published** until the evidence gates pass: an adversarial survival record
  (appeals filed / admitted / upheld / overturned, published with its exposure denominators —
  docket exposure, external reproductions, citations, qualified appeals; it starts at zero on launch
  day), construct-level consequence evidence, judge family-bias disclosure, and N ≥ 3
  confidence-interval discipline (`rules/rules-of-procedure.md` §5). Until then, every report is a
  diagnostic verdict, never a rank, and carries the pre-gates banner — the only thing launch day
  licenses about a verdict is that it is **publicly contestable**, never *validated*.
- **Respondent naming is two-track** (`NAMING-DECISION.md`, PO decision 2026-07-10). Base models
  under evaluation are named (`claude-sonnet-4-6`, `qwen-max`) — naming the base model an API serves
  is common practice in public model evaluation. Naming a commercial *companion product* in a verdict
  stays gated on five conditions: an adversarial survival record (with exposure denominators), a
  reproducible transcript, an appeal procedure, legal review, and a response policy. Ruling titles and
  findings describe behavior on the record — never personified shaming, never an extrapolation to
  overall model capability. Court instrumentation (anchor, judge families, persona actor) is named as
  a matter of institutional requirement, independent of both tracks.

See `rules/rules-of-procedure.md` §4 for the full claim ladder and gate dictionary this table
summarizes.

## Appeals — how to challenge a verdict

Anyone may file. **Appeal admissibility — all three required** (quoted from
`rules/rules-of-procedure.md` §3); an appeal enters the docket only if it:

1. argues from **evidence already on the record** (transcripts, manifests, rulings);
2. attaches a **re-runnable artifact** — manifest and transcript references sufficient to reproduce
   the challenged reading;
3. names a **specific error type**: misapplication of judging guidance, a defect in the evidence, or
   misapplication of a precedent.

Not entertained: pure statements of value position, claims without record evidence, PR- or
marketing-shaped challenges. Appeals are processed in fixed monthly batches, and the outcomes —
overturned with a new ruling, or upheld with reasons — are published in the Docket Update either way.
File on this repository's issue tracker.

## Who is judged

The court judges AI companions — never the people who confide in them. Every case asks one question:
at the moment a person most wants to be agreed with, does the companion stay honest, warm, and
boundaried? Does it protect that person's tomorrow-self, not just tonight's mood?

## License

Apache-2.0 — see `LICENSE`. Copyright 2026 Holden Hale (launch gate item 7, resolved 2026-07-09).
