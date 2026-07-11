# CompanionCourt — Case Lifecycle Policy

**Version:** v1.0 · **Status:** launch version.
**What this is:** one of three governance policies of **a public docket for pressure-testing AI companions**. Credibility comes from continued governance, not from a launch: this policy says how a case is born, admitted, run, disputed, honored, and let go. Cases exist to test AI companions — every persona is synthetic, no real user's story is ever a case.

> **v1.0 changelog (launch):** finalized from v0.1-draft; the three `[DRAFT-CALL]`s resolved by maintainer ruling — §1.5 precedent re-examination (trigger + window + outcome), §1.6 deprecation triggers, §3 variant-bank refresh cadence.

## 1. States

`candidate → admitted → active → (disputed) → (precedent-bearing) → deprecated → retired`

### 1.1 candidate
A drafted case, originally authored (persona base drafts generated programmatically citing the ESC-Eval/ESC-Judge *methods* only — zero scraping, zero real-user data, no human subjects). A candidate binds nothing and grounds no verdict.

### 1.2 admitted — the two-layer check
1. **Schema completeness** (machine-checkable): all five elements present — persona spec with escalation script and loosening conditions; ground truth (which door is open or closed, what counts as caving); judging guidance (at least two reward and two punish entries, each operational); class label from the taxonomy plus must-hold marking; a memorable case name.
2. **Public docket admission review** (human): criteria 1–4 are mandatory — (1) a clear pressure point, (2) an observable failure mode, (3) a reviewable transcript, (4) embodies one piece of doctrine; criteria 5–7 are the review gate — (5) a reasonable opposing/boundary reading exists, (6) it is more than an ordinary bad answer, (7) it does not depend on private product knowledge.
Purpose of the review: the docket must never become "a collection of cases we found interesting."

### 1.3 active
The case is in the current corpus version and counts in runs. Terminology, fixed: the **public corpus/devset** (16–20 cases, ships with the repo, anyone can run) is what the runner consumes; the **public docket** (10–12 of those, written up as full case files with rulings and dissent) is its precedent edition, not a different set of cases; the **hidden bar exam** never enters the public repo (see Leakage & Certification Policy).

### 1.4 disputed
A case carries open DISPUTED verdicts — the judge families disagreed and the disagreement is published pending a maintainer ruling. Disputed is a live condition on top of active, not an exit from it: a case with a genuine boundary reading *producing* disagreement is doing its job (high dispute on boundary cases is institutional value; instability on core doctrine is an alarm, not a case property).

### 1.5 precedent-bearing
At least one numbered ruling names this case's fact pattern. From this point, edits to the case's ground truth or judging guidance require re-examining every ruling that cites it, under the precedent's own review condition; a change that would alter the fact pattern forces a new corpus version rather than a silent edit. **Re-examination procedure (ruling):** a precedent is re-examined when the maintainer initiates it **or** an admissible appeal triggers it; the review window is the **next Docket Update cycle**; the outcome is recorded as a **ruling amendment with a version bump** — never a silent rewrite.

### 1.6 deprecated
The case no longer enters new runs — superseded by a better variant, or its guidance found flawed by ruling or appeal — but its case file, transcripts, and any rulings remain published and citable. Deprecation is a statement about the future, never a rewriting of the past. **Deprecation triggers (ruling), any one:** the doctrine it carried is superseded; leakage is confirmed on it; **persistent judge-instability** — a case-level disputed rate above **60% across two corpus versions** (instability on core doctrine is an alarm, not the case doing its job); or its corpus version is retired.

### 1.7 retired
The case is removed from the corpus entirely — the standing response to confirmed leakage or compromise (see Leakage & Certification Policy) — and replaced through the variant bank in the next corpus version. Retired cases stay in the public record with their retirement reason; results earned on them remain labeled with the corpus version they were earned under.

## 2. Versioning

- The corpus is versioned; every corpus version is bound to exactly one frozen anchor pack, and both are hash-pinned in every run manifest.
- Any material edit to an admitted case — ground truth, guidance, escalation script — lands in a new corpus version. Verdicts never migrate silently across versions: a report refuses to aggregate runs that span different corpus hashes.
- Every published score names the corpus version it was earned on.

## 3. Variant bank rotation

The Goodhart hedge: each case maintains surface-rewrite variants (same pressure shape, same ground truth, different surface). Rotation happens (a) on confirmed leakage — retire and substitute; (b) on scheduled corpus refresh, and **that refresh is reviewed at each corpus version bump, never on a calendar (ruling)** — the variant bank tracks corpus versions, not months. Rotation changes surfaces, never doctrine: a variant that would alter the fact pattern of a precedent-bearing case is a new case, admitted from candidate.

---

## 中文摘要（zh summary）

案件状态机：`candidate → admitted → active → (disputed) → (precedent-bearing) → deprecated → retired`。**候选**：原创编写，persona 底稿程序化生成（仅引用 ESC-Eval/ESC-Judge 方法），零爬取、零真实用户数据。**入卷两层检验**：schema 完整性（案情五件俱全，机器可查）+ 公开入卷审查七条（①压力点明确 ②失败模式可观察 ③转录可复核 ④体现一条 doctrine——四条必须全满足；⑤存在合理反方 ⑥不只是普通 bad answer ⑦不依赖私有产品知识——为审查关），防止案卷变成"我们觉得有趣的案例合集"。**三层术语**：public corpus/devset（16–20 案随 repo 发布）、public docket（其中 10–12 案的精装判例版）、hidden bar exam（永不入公开 repo）。

**disputed** 是 active 之上的活动状态：boundary 案的高分歧是制度价值，core doctrine 不稳才是警报。**precedent-bearing**：被编号判例引用后，改 groundTruth/判定指引须复审全部引用判例，动事实模式必须开新语料版本。**复审程序（已裁定）**：维护者发起**或**合格 appeal 触发；窗口 = 下一 Docket Update 周期；结果记为**带版本号的裁定修正**，绝不静默改写。**deprecated**：不再入新 run，但案卷、转录、判例保持公开可引用——弃用是对未来的声明，不是改写过去。**触发条件（已裁定，任一）**：教义被取代／确认泄漏／判官持续不稳（案级 disputed 率 >60% 且跨两个语料版本）／所属语料版本退役。**retired**：确认泄漏/失效后整案移出、经 variant bank 替换，留卷注明原因。**版本化**：语料版本与锚包一一互绑、hash 入 manifest；实质性修改必开新版本；报告拒绝聚合跨语料 hash 的 run；每个公开成绩标注所属语料版本。**Variant bank 轮换**：同压力形状、同真值、换表面；泄漏即轮换 + **每次语料版本更新时评估（已裁定，不按日历）**；会改变判例事实模式的变体是新案，从 candidate 重走入卷。

---

*Sources: credibility pillars v2.5 (§8 policy split, §5 admission criteria, §3 boundary-vs-core-doctrine reading); institution design v0.2.4 (§2 schema completeness + admission review + three-tier terminology, §6 precedent elements); companion-bench design v1.3 (§3 corpus design + Goodhart hedge, §7 versioning binding); report.ts (corpus-hash aggregation refusal); maintainer rulings 2026-07-09 (§1.5 re-examination, §1.6 deprecation triggers, §3 variant-bank cadence).*
