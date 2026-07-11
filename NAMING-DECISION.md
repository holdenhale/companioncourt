# Naming Decision — Status

This file records **how respondents (models under evaluation) are named in public CompanionCourt
material** — resolved by PO decision on 2026-07-10 (§1, decision record) — and clarifies a second
question that is often confused with it but was never pending: how court instrumentation (anchor,
judge families, persona actor) is named (§2). The letter scheme that previously governed respondent
naming is preserved as a historical record in §4, marked SUPERSEDED.

## 1. Respondent naming — resolved (PO sign-off recorded 2026-07-10): two tracks

**Decision record.** Respondent naming is a **two-track policy**, effective immediately at launch (T0):

- **Track 1 — base models: named.** A base model evaluated through its serving API is named in
  rulings, reports, and the docket. Naming the base model an API serves is common practice in public
  model evaluation and requires no additional gate. Applied at T0: RD-2026-001/002 and
  `reports/report-claude-sonnet-4-6.md` name **`claude-sonnet-4-6`**; RD-2026-003 and
  `reports/sample-diagnostic-report-qwen-max.md` name **`qwen-max`**. The identity named in every
  ruling and report matches the run manifests it cites.
- **Track 2 — companion products: gated, unchanged.** Naming a commercial companion *product* in a
  public verdict stays gated on the five conditions (promotion strategy v1.6 §三, internal): an
  **adversarial survival record (with exposure denominators)**, a reproducible transcript, an appeal
  procedure, legal review, and a response policy. The named-respondent process in promotion strategy
  §三 and in the 90-day gate preregistration §3 refers specifically to this product track, not to
  base models. Our own product (`hb-companion-product`) names itself by policy — self-naming was
  never gated — and is not an exception to the gate for anyone else's product.

**Discipline that applies on both tracks.** Ruling titles and findings describe *behavior on the
record*. A named verdict is never personified shaming and never an extrapolation to overall model
capability; the claim ladder (`rules/rules-of-procedure.md` §4) binds every named claim exactly as it
bound the anonymous ones.

**Kin-bias disclosure under real names.** With respondents named, the M3-C disclosure reads plainly:
judge family A is `claude-sonnet-4-6`, and where the respondent is the same claude family — as in
RD-2026-001/002 — the measured one-sided **+0.171 kin preference** (toward same-family outputs,
concentrated in en) is disclosed in the ruling as context on pro-respondent dimension scores. Real
naming makes that disclosure more checkable, not less.

Do not extend Track 1 treatment to any companion product without a PO sign-off recorded in this file.

## 2. Instrument naming — not pending, disclosed by institutional requirement

**Anchor model, judge-family models, and the persona-actor model are not respondents and are not part
of the naming decision above.** They are court instrumentation, not parties on trial, and two separate
institutional requirements make their disclosure non-optional:

1. **Reproducibility** (`rules/evidence-standard.md` §1–2) — an external party re-running or auditing a
   verdict needs the real anchor and judge model pins; anonymizing instrumentation would make the
   manifest non-reproducible, which the evidence standard does not permit.
2. **Judge family-bias disclosure** — one of the four evidence gates (`rules/rules-of-procedure.md`
   §5) is a measured, published bias for each judge family toward its own lineage's outputs. Disclosing
   "judge family A shows +0.171 excess agreement with same-family outputs" while withholding that judge
   family A *is* a specific named model would gut the disclosure — the finding is only checkable if the
   model identity is public.

Accordingly, `reports/sample-diagnostic-report-qwen-max.md` leaves the anchor
(`DMXAPI-deepseek-v4-flash`, `gpt-5.4-mini` across different manifest configurations) and judge families
(`claude-sonnet-4-6`, `gpt-5.4`) named as-is. This is a **policy**, not an oversight, and not a
placeholder for a future decision.

## 3. Scan discipline

When scanning this repo for model names, the categories resolve as follows under the two-track policy:

- **Base-model respondent names** (`claude-sonnet-4-6`, `qwen-max`) in public docket/report material:
  expected and **permitted** (Track 1). Count them; they are not a defect.
- **Stale letter residue** — single-letter respondent labels of the retired scheme (§4), or the
  file slugs those labels produced in report filenames: expected count is **zero everywhere except
  the SUPERSEDED historical section of this file** (§4). Any other hit is a defect.
- **Commercial companion product names** other than our own `hb-companion-product`: expected count is
  **zero** (Track 2 gate). Any hit is a defect.
- **Instrument-name hits** (anchor/judge/persona-actor) in the same material: expected and
  **permitted** by the policy in §2 above; count them, but they are not a defect.

## 4. SUPERSEDED (historical record) — the letter scheme (pre-2026-07-10)

> **SUPERSEDED (historical record).** Everything in this section describes the anonymized letter
> scheme that governed this skeleton before the PO decision of 2026-07-10 recorded in §1. It is
> preserved as the record of what the scheme was and why; nothing in it governs current material.
> File names cited below are the historical ones: `reports/sample-diagnostic-report-respondent-c.md`
> has since been renamed `reports/sample-diagnostic-report-qwen-max.md`, and
> `reports/report-respondent-a.md` renamed `reports/report-claude-sonnet-4-6.md`.

Per the promotion strategy (internal governing document, v1.6 §三), naming a commercial model by name
in a public verdict unlocks only when five conditions are
met: an **adversarial survival record (with exposure denominators)**, a reproducible transcript, an
appeal procedure, legal review, and a response policy. None of these hold yet — the survival record in
particular starts at zero on launch day by definition.

**Until the PO decides otherwise, this skeleton uses anonymized placeholders for respondents**:
`Respondent A`, `Respondent B`, `Respondent C`, … — one letter per distinct respondent, assigned in the
order respondents already appear in existing internal drafts (the internal ruling drafts already use
this scheme; this skeleton does not re-letter them). Do not deanonymize
a placeholder anywhere in public-facing material without a PO sign-off recorded here.

Applied in this skeleton:

- `rulings/INDEX.md` — RD-2026-001 and RD-2026-002 (Respondent A), RD-2026-003 (Respondent C), matching
  the internal drafts' own labels.
- `reports/sample-diagnostic-report-respondent-c.md` — the sanitized sample report; the respondent
  (identity resolves only via the internal M3-A run manifests, not reproduced in this file) is
  anonymized to **Respondent C** throughout, including the identity table's SUT column, the
  provider-observed column, and the report title. This matches the same respondent letter already used
  for this respondent in ruling draft RD-2026-003 (same underlying run IDs: `5e0b934adbc0`,
  `3250481ab6e2`, `897fb41f3ba3`).

**The former "honest limit of the letter scheme" — now a plain naming.** Under the letter scheme,
this paragraph recorded that `Respondent A` was resolvable from the release *by design*, through two
deliberate disclosure routes: (1) RD-2026-004's Sources line disclosed that the product's bare base
weights appear in this docket as the lettered respondent; (2) RD-2026-001/002's kin-bias disclosure
recorded that the respondent shares a model family with judge family A — an M3-C-required disclosure
we would not suppress to protect a letter. The letter was a **no-claim marker, not a secrecy device**:
it recorded that the court made no named-respondent claim in its own voice, nothing more. As of the
2026-07-10 decision the point is moot in the simplest way: the respondent is named in place —
**`claude-sonnet-4-6`** — everywhere the letter used to stand; the kin-bias disclosure now names the
claude family outright (judge family A is `claude-sonnet-4-6`; M3-C one-sided +0.171 kin preference,
concentrated in en); and letters without cross-references (e.g. Respondent B) simply no longer appear
outside this historical section.

*Open item for PO (historical): confirm the letter-assignment convention above (A/B/C order) as the
record of truth once more respondents enter the docket, and confirm whether this file or a registry
entry (the runner's registry module, which publishes with the runner) becomes canonical.* —
**Resolved 2026-07-10:** superseded by the two-track decision in §1; letters are retired for base
models, and this file remains the record of naming decisions.

## Maintainer identity policy (resolved 2026-07-09)

The maintainer publishes under the stable pen name **Holden Hale** — copyright holder, ruling signatory, and byline for all public writing (essays, Docket Updates, appeal responses). Continuity of this signature across the docket is itself part of the record.

**Deferred disclosure, not permanent anonymity.** The maintainer's legal identity is held in reserve and disclosed to the necessary counterparties at the same triggers as entity formation:
1. the first paid contract (audit / regression harness);
2. certification design work;
3. the legal review required before naming companion products publicly (Track 2, §1);
4. any legal challenge.

Until then, the court's credibility is carried where this project has always placed it: in the procedure, the transcripts, and the open challenge channel — not in a name. (Verdicts, not vibes.)

**Entity note.** Copyright is held personally at v0. Stewardship moves to a dedicated entity — structurally separate from the companion product's company — at the same triggers above.
