# CompanionCourt — Model Rerun Policy

**Version:** v1.0 · **Status:** launch version.
**What this is:** one of three governance policies of **a public docket for pressure-testing AI companions**. Models drift, gateways swap backends, corpora evolve — this policy says when a respondent is re-tried, and promises the one thing a docket must never do: rewrite its own history. The court judges AI companions, never the people who talk to them; and it judges the model that actually ran, pinned in the manifest, not the model a vendor wishes had run.

> **v1.0 changelog (launch):** finalized from v0.1-draft; the four `[DRAFT-CALL]`s resolved by maintainer ruling — §1.1 drift is flagged "rerun pending," not auto-rerun; §1.2 vendor rerun rate limit; §1.3 post-bump queue priority; §1.4 time-rerun cadence.

## 1. When a rerun happens

### 1.1 Model version change (alias drift)
The manifest records the provider-observed response model and system fingerprint, and the anchor pack is periodically re-verified — so a provider silently swapping the model behind an alias is **detectable**. When drift is detected:

- existing verdicts stand, labeled with the manifest they were earned under;
- the drifted alias is treated as a new respondent configuration and is eligible for a fresh N ≥ 3 run;
- the report keeps the two configurations in separate identity rows — drift is displayed, never averaged away.

**Ruling:** a detected drift does **not** auto-rerun a publicly reported respondent. The affected verdicts are flagged **"version-drifted, rerun pending"** and stand under the manifest they were earned on; the rerun is **scheduled for the next Docket Update**, not fired the moment drift is seen. Detection surfaces a fact on the record; it does not silently replace one.

### 1.2 Vendor request (via right-to-reply)
A publicly evaluated party may request a rerun through the right-to-reply channels — typically alongside a **version/prompt mismatch note** (their production configuration differs from what was evaluated). Admissibility of a rerun request:

1. it identifies the **specific configuration difference** (model version, endpoint, serving parameters) with evidence — not a general dissatisfaction with the verdict;
2. the requested configuration is **publicly reachable** through the standard adapter, under the same frozen friend prompt as every other respondent;
3. it is filed **on the record** and is processed in the same monthly batch cadence as appeals.

A granted rerun produces a **new versioned run** under the new configuration. It never amends, replaces, or unpublishes the prior verdict; the mismatch note is annexed to the old report, and the new report links back. Rerun requests, like every reply channel, **cannot influence case selection** — and a vendor's paid or invited engagement never counts as an independence signal. **Rate limit (ruling):** **one granted rerun per respondent, per model version, per corpus version** — enough for a genuine fixed-it, never enough to shop for a friendlier draw.

### 1.3 Corpus version bump
A new corpus version means a new frozen anchor pack, and results never migrate: runs on corpus vN and vN+1 are different records, and a report refuses to aggregate across corpus hashes. After a bump, previously reported respondents are queued for rerun on the new version before any cross-model comparison is published on it. **Queue priority (ruling):** **precedent-bearing cases first, then must-hold cases, then the rest** — the records that carry the most doctrine and the most weight re-establish themselves first.

### 1.4 Scheduled time-rerun (stability governance)
Independently of any trigger, the same configuration is re-run after an interval to measure **time-rerun stability** — surfacing gateway and backend drift that no single manifest can show. This is a post-launch governance duty, published as a stability note, not as a fresh verdict. **Cadence (ruling): quarterly, on one designated reference respondent** — not the full slate. A single stable reference is enough to detect gateway and backend drift; a full-slate re-run every quarter would be cost without added signal.

## 2. How history is preserved

- **Verdicts are immutable.** A published verdict is never edited, overwritten, or unpublished by a rerun. Corrections of factual errors in a report happen through the technical-correction channel and are published as annexes, on the record.
- **Every run is a new versioned record**: new runId, new manifest, new report. The old and new reports coexist, each pinned to its corpus version, anchor pack hash, and observed model identity.
- **Precedent never flips a non-disputed verdict**, and no rerun retroactively applies newer rulings to older records.
- The public record therefore reads like a docket, not a leaderboard cache: you can always see what was true, when, under exactly which pins.

## 3. What a rerun is not

- Not an appeal: an appeal challenges a reading of existing evidence; a rerun creates new evidence. Filing one is never a precondition for the other.
- Not a negotiation: no rerun request, granted or refused, moves a case in or out of the corpus.
- Not an eraser: "we fixed it" earns a new verdict next to the old one — that ordering is the docket's memory, and its value.

---

## 中文摘要（zh summary）

**何时重跑**：①**模型版本漂移**——manifest 记录 provider 实际返回的 response model / system_fingerprint，锚包定期重校验，别名悄换底模因此可检测；旧判决原样保留并标注其 manifest，漂移后的配置视为新被测配置、可跑新的 N≥3；报告中两种配置分行展示、不得平均。**已裁定**：漂移**不自动重跑**，受影响判决标注"version-drifted, rerun pending"、排入**下一 Docket Update** 重跑。②**厂商经答辩权请求**——须指明具体配置差异并附证据、目标配置可经标准 adapter 公开访问、入卷按月批处理；获准的重跑产生**新的版本化 run**，绝不修改或下架旧判决；mismatch note 作旧判决附注；重跑请求同样**不得影响案件遴选**，付费/受邀使用不计独立信号。**频次上限（已裁定）**：每被测方·每模型版本·每语料版本**一次**。③**语料版本更新**——新语料配新锚包，结果不跨版本迁移，报告拒绝聚合跨语料 hash 的 run；已报告的被测方在新版本重跑后才发布跨模型比较。**排队优先级（已裁定）**：precedent-bearing 优先 → 其次 must-hold → 再其余。④**定期隔期复跑**——度量 time-rerun stability、覆盖网关/后端漂移，以稳定性附注发布而非新判决。**节奏（已裁定）**：季度一次，仅一个**指定参考被测方**（非全量 slate）。

**历史保留**：判决不可变——重跑永不改写、覆盖或下架已发布判决；事实性错误走 technical correction 通道、以附注入卷；每次 run 是新的版本化记录（新 runId、新 manifest、新报告），新旧并存、各钉各的语料版本与观测到的模型身份；判例永不翻转非争议判决，重跑也不回溯适用新判例。**重跑不是**上诉（上诉质疑证据的解读，重跑产生新证据）、不是谈判（不动案件遴选）、不是橡皮擦（"我们修好了"只能在旧判决旁边挣一份新判决——这个先后顺序正是案卷的记忆与价值）。

---

*Sources: credibility pillars v2.5 (§8 policy split, §2 time-rerun stability, §10 paid/invited signals excluded); institution design v0.2.4 (§7 right-to-reply three channels + case-selection firewall, §6 precedent never flips); companion-bench design v1.3 (§7 manifest fields + alias-drift detection, §5 same frozen friend prompt); report.ts (identity-row splitting, corpus-hash aggregation refusal); maintainer rulings 2026-07-09 (§1.1 rerun-pending flag, §1.2 rate limit, §1.3 queue priority, §1.4 time-rerun cadence).*
