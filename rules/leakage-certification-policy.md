# CompanionCourt — Leakage & Certification Policy

**Version:** v1.0 · **Status:** launch version.
**What this is:** one of three governance policies of **a public docket for pressure-testing AI companions**. It draws the boundary between what is public and what stays hidden, says what happens when the public side leaks into training data, and states plainly what we do not sell: **v1 offers no certification** — no seal, no compliance equivalence. A docket that hands out stamps before it has earned trust would be caving to its own pressure test.

> **v1.0 changelog (launch):** finalized from v0.1-draft; the four `[DRAFT-CALL]`s resolved by maintainer ruling — §2 leakage detection signals, §2 hidden-tier disclosure detail, §4 certification-expiry basis (certification still **not offered** in v1), §5 private-audit existence disclosure.

## 1. The boundary: public devset vs hidden bar exam

| Tier | Visibility | Role |
| --- | --- | --- |
| **Public corpus / devset** (16–20 cases) | Ships with the repo; anyone can run it | The runner's input; builds the shared language |
| **Public docket** (10–12 of those, full case files) | Published with rulings and dissent | The precedent edition of the devset — same cases, not a different set |
| **Hidden bar exam** (incl. the 14-case held-out certification corpus + rotating variant bank) | **Never enters the public repo** | Anti-gaming reserve; the private evaluation asset for any *future* certification or re-examination |

The boundary is structural, not aspirational: nothing from the hidden tier is quoted, excerpted, paraphrased into public rulings, or used to generate public artifacts. Public precedents build the language; the private taste registry and hidden corpus stay private.

## 2. Leakage: assumption, detection, response

**Assumption.** Public cases will eventually be trained against. This is priced in — it is why the corpus is versioned, why every published score names its corpus version, and why fix directions in rulings are **doctrinal, not recipe-level** (the docket teaches judgment; it is written to be a poor answer key).

**Detection (ruling).** Four signals, and **any one triggers a leakage review**: (1) verbatim or near-verbatim case text surfacing in public model outputs; (2) a sudden, case-specific score jump on one case across vendors; (3) an explicit disclosure of corpus inclusion in a training set; (4) divergence between a respondent's public-devset scores and its hidden-variant scores on the same pressure shapes — public inflation without hidden movement is the signature of teaching to the test. Triggering a review is not itself a finding — it opens the inquiry that decides retirement.

**Response — rotation and retirement** (mechanics in the Case Lifecycle Policy):

1. A confirmed-leaked case is **retired** from the active corpus and replaced from the **variant bank** (same pressure shape and ground truth, new surface) in the next corpus version.
2. Scores earned on the leaked version remain published, labeled with their corpus version — leakage changes the future corpus, never the past record.
3. A leak of hidden-bar-exam material is a different order of event: the affected hidden cases are burned and replaced, and the incident is disclosed in the Docket Update. **Disclosure detail (ruling):** we acknowledge the **leak event and the affected tier's size** — and **never the case content**. Disclosing the breach must not itself expose what the hidden tier holds.

## 3. Certification: not offered in v1

- **No seal.** v1 issues diagnostic reports, not certificates. No respondent may describe a CompanionCourt result as a certification, accreditation, or pass.
- **No compliance equivalence.** Verdicts are *SB 243-adjacent operational evidence* at most — behavioral evidence relevant to safety-protocol effectiveness — and are **not** a legal-compliance equivalent. Any compliance-mapping language requires counsel review before publication.
- The public storyline is companion integrity under pressure; certification is not the pitch, and the first day sells nothing.

## 4. The future certification path — separately gated, honestly priced

Certification language unlocks on its own line — never bundled with jurisdiction language or predictive-validity claims — and only when all three hold:

1. a functioning **hidden bar exam** (held-out corpus + rotating variants) that a certification could actually be examined against;
2. **expiry** — any future certification is time-boxed and re-examined; there is no perpetual seal, because models drift and corpora rotate. **Ruling:** expiry is **tied to the corpus version, not the calendar** — a certification would name the corpus it was examined against, and a new corpus version is itself a re-examination trigger. (This only fixes the term *for if and when* a certification is ever offered; **v1 still offers none**);
3. **paid-pilot evidence** — real willingness-to-pay discovered through pilots, with the standing caveat that a vendor's paid or invited participation never counts toward the independence signals that unlock institutional language.

## 5. Public report vs private audit

- A **public report** is a diagnostic report on the public corpus: published in full, transcript-linked, on the record, eligible (once evidence gates pass) for cross-model comparison.
- A **private audit** is a paid engagement run on hidden-tier material for a party that wants to find its failure modes before the public does ("the failure modes regulators and T&S teams will ask about"). Its results are private, confer **no seal and no public claim** — a party may not cite a private audit as a CompanionCourt result — and, like every paid interaction, it cannot influence case selection, is disclosed under the conflict-of-interest rules, and does not count toward any independence signal. **Existence disclosure (ruling):** the *existence* of private-audit engagements is disclosed as an **aggregate count per year, with no client names** — enough to show the conflict surface honestly, never enough to name who paid.

---

## 中文摘要（zh summary）

**边界**：public corpus/devset（16–20 案，随 repo 发布、任何人可跑）→ public docket（其中 10–12 案的精装判例版，同一批案子）→ hidden bar exam（含 14 案 held-out 认证语料 + 轮换变体库，**永不入公开 repo**）。边界是结构性的：隐藏层内容不引用、不节选、不转述进任何公开工件；公开判例建语言，私有 taste registry 与隐藏语料保持私有。

**泄漏**：默认公开案终将被训——因此语料版本化、每个成绩标注语料版本、修复方向停在教义层（案卷是差劲的答案钥匙）。**检测信号（已裁定，任一触发复核）**：案文原样/近原样在公开输出中复现／单案跨厂商分数骤跳／明确的训练集纳入披露（触发复核≠已认定，复核才决定是否退役）。处置：确认泄漏的案 **retired** 并经 variant bank 换面替换入下一语料版本；旧成绩保留并标注版本——泄漏改变未来的语料，不改写过去的记录；隐藏层泄漏则烧毁替换并在 Docket Update 披露。**披露粒度（已裁定）**：承认**泄漏事件 + 受影响层的规模**，**绝不披露案文内容**。

**认证：v1 不提供**——不发认证章、不声称法律合规等价；判决至多是 SB 243-adjacent 运营证据（safety-protocol 有效性的行为学佐证），一切合规映射措辞须 counsel review。**未来认证路径单独解锁、不与管辖权语言或预测效度宣称捆绑**，三条件齐备方谈：隐藏 bar exam 可考、认证带有效期（无永久章，**已裁定：绑语料版本而非日历——认证注明所依语料、新语料即复核触发；v1 仍不提供认证**）、paid-pilot 付费意愿证据——且厂商付费/受邀参与永不计入独立性信号。**公开报告 vs 私有审计**：公开报告全文发布、转录可点、入卷在案；私有审计用隐藏层材料、结果私有、**不产生任何章或公开宣称**、不得被引用为 CompanionCourt 结果、不影响案件遴选、按 COI 规则披露。**审计存在披露（已裁定）**：按年**匿名聚合计数、不具名客户**。

---

*Sources: institution design v0.2.4 (§2 three-tier terminology, §8 privacy table incl. no-seal / no-compliance-equivalence clause); credibility pillars v2.5 (§8 policy split, §9 anti-answer-key, §10 three-line unlock incl. certification line, §4/§6 COI + case-selection firewall); companion-bench design v1.3 (§1 SB 243 honest boundary + counsel review, §3 variant bank + version labeling, §9 not our product's certification tool); promotion strategy v1.6 (§8 compliance-narrative discipline, Phase 4 discovery before selling certification); maintainer rulings 2026-07-09 (§2 detection signals + hidden-tier disclosure, §4 expiry basis, §5 private-audit disclosure).*
