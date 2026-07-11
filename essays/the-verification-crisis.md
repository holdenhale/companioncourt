# Why human-agreement panels can't be verified in the LLM era — and what public contestability adds

*Holden Hale — maintainer, CompanionCourt*

> PUBLIC RECORD — not a ranking claim. Verdicts are publicly contestable, never validated: the adversarial survival record (with exposure denominators) starts at zero on publication, and construct-level consequence evidence is pending.

---

## The number everyone reaches for

When a benchmark uses a language model as its judge, a ritual follows, and it is a good ritual. You take a sample of the machine's verdicts, hand the same cases to human raters, and report how often the two agree — a κ, a percentage, a confidence interval. That number is the load-bearing wall under the sentence *our automated judge tracks human judgment,* and almost every LLM-judged benchmark leans on some version of it.

In 2026 that wall has a crack running through it, and most of us have been looking past it.

You cannot verify that a remote human label was made by a human.

The people you recruit to rate AI conversations are, by selection, fluent with AI. Give them a well-paid batch of nuanced labeling and a deadline, and the fastest route to a defensible-looking answer is to ask a model. Inter-rater agreement may even come back *excellent* — two raters who both quietly consulted the same class of model will agree beautifully, and their agreement measures nothing except that models agree with models. κ can be gorgeous and empty. Worse: if your automated judge is itself a model, a panel that secretly delegated to models isn't validating your judge — it is the judge grading its own reflection.

That single fact — in 2026 you cannot prove a remote label came from a human and not from the very model under test — quietly undermines the remote human-agreement panel as a standalone way to certify an LLM-judged benchmark, and forces a harder question: not how to build a more trustworthy panel, but what a benchmark can still honestly offer when no panel can be trusted in advance. The shape we borrow is the court's — publish the record, and let the verdicts survive qualified challenge in the open — and we state its limits with it: public contestability supplies adversarial error discovery and an accumulating survival record; it does not establish representative human agreement, and it does not establish consequence validity.

## We caught ourselves doing it

We know this failure from the inside, because we walked straight into it.

We built a blinded annotation study — 180 samples, a sidecar of case-type and language metadata, the whole apparatus — meant to be exactly the human-agreement layer described above. One calibration file came from a trusted internal contributor, acting in good faith. When we ran per-item verification — comparing the human labels against our machine labels line by line — the file mirrored the machine's labels closely enough that we could not, on the evidence, distinguish an expert who reasoned independently to the same conclusions from labels produced with model assistance. We rejected the file. (The annotation-study record is maintained internally; a summary is available on qualified request.)

Not because anyone did anything dishonest — we have no reason to think they did, and this essay names no one for good reason. We rejected it because we could not prove they hadn't, and a validation study that cannot tell those two stories apart is not a validation study.

That was the moment the abstract problem became ours. If we could not verify the provenance of a trusted internal contributor's labels — from the inside, with full context and every reason to give the benefit of the doubt — how would we ever verify an anonymous external rater's? The honest answer is that we wouldn't. And an instrument whose own purity cannot be checked is not fit to be the gate on a strong public claim.

## Why the standard patches don't close it

The reflex is to patch. Each patch fails in the same shape.

Add attention checks — but an attention check tests attention, not provenance; a model-assisted rater sails through. Add time telemetry — but plausible dwell times are trivial to produce. Require written rationales — but articulate rationale is exactly what language models are best at manufacturing. Every signal we might use to catch delegation is a signal a delegating rater can supply, and provenance is not something you can recover from the artifact after the fact — by then the two histories are indistinguishable.

There is exactly one patch that works: supervision. Sit in the room — physically, or over live video — and watch the labeling happen. Provenance you observe directly you never have to reconstruct. We keep this in the kit as an optional, arm's-length, paid expert session: a sanity check on a handful of core cases, worked in front of us. [→ supervised-session protocol: evidence standard §4.1](../rules/evidence-standard.md) But supervision is the one patch that does not scale — you cannot watch a thousand raters, or honestly more than a few. So it can *harden* a claim at the margin; it cannot be the *foundation* of one.

## What agreement was ever for

So step back and ask what the human-agreement number was ever supposed to buy. It was never evidence about neurons; no one cares that a carbon brain, specifically, produced the label. What we wanted was **independence** — a source of judgment that reached the same place as our judge *without going through our judge.* And that reframes the crisis. The problem was never that our raters are human or not; it is that in the LLM era the cheapest path to any label — expert or crowd, remote and unwatched — routes straight back through the same kind of system we are checking. What we lost is not humanity; it is independence. Name it as the target, and "recruit a panel and compute κ" stops looking like the only road there.

## What public contestability adds

A court does not pre-certify its judges by polling a panel. It publishes the ruling, opens the room, and lets anyone with standing challenge it. Authority is not stamped on at the front; it accrues at the back, as decisions survive scrutiny in the open. We are building the benchmark analog, and it has four moving parts.

**Publish the whole record.** Every verdict in the public docket seed ships with its blinded transcript and a run manifest that pins what actually ran. Two clicks from any claim to the raw conversation. You cannot contest what you cannot see, so we show all of it. [→ evidence standard](../rules/evidence-standard.md)

**Open a qualified-challenge channel.** Anyone may appeal a verdict — but an admissible appeal has requirements: it must point at a specific ruling, state the alleged error, and engage the transcript. [→ appeal admissibility: rules of procedure §3](../rules/rules-of-procedure.md) Note what we deliberately do *not* require. We do not verify the challenger's identity, credentials, or species. The contamination that quietly poisons a labeling panel is harmless — even useful — at the challenge door, because a challenge never asks to be trusted; it has to land on the record. An appeal either identifies a real defect or it does not, and everyone can check which.

**Count exposure honestly.** This is the discipline that keeps the whole thing from lying by omission. A verdict no one has read, reproduced, cited, or appealed has not been "validated by silence"; it has simply not been tested yet. So beside every upheld/overturned tally we publish the denominators: how many times the docket was exposed, reproduced, cited, appealed. Zero appeals against a ruling nobody downloaded is zero evidence — not a quiet win. **The survival record starts at zero on launch day, and we say so out loud.**

**Let challenge quality speak.** Here the LLM era stops being only a threat. An appellant armed with a frontier model is not a contaminant to screen out; they are the strongest stress test we could ask for. Every verdict that survives a competent, AI-assisted attempt to break it is *more* credible for it, not less. The same capability that made the labeling panel unverifiable makes the challenge harder to pass — the contamination problem inverts into an asset, but only if the door is genuinely open and the losses are published next to the wins.

## What this does not buy

I want to be exact about the price, because precision is the entire point.

This does not give us a launch-day validation number. We will not open with "human-validated verdicts," and you should distrust us the moment we do — on day one the survival record is empty by construction. Verdict-level human agreement — the claim that qualified people, checking our reasoning, would rule as we ruled on a case — remains **unestablished**, and the architecture above does not establish it. What stands in its place is deliberately smaller: an accumulating, public record of challenge and survival — a supplement where a certification was once promised, not a new certification.

There is a second, slower currency we intend to collect, named precisely so it isn't oversold. Whether our failure tags predict anything *outside* the courtroom — whether the conversations we flag track real users feeling worse, leaving, or acting against their own tomorrow — is **construct-level** consequence evidence, to be collected from real product use, which cannot be ghost-written by a model. [→ the construct-level consequence gate: rules of procedure §5](../rules/rules-of-procedure.md) But it validates the *construct* — that we measure something that matters — not any individual ruling, and it arrives on the timescale of real usage — and none exists yet.

So here is the exact claim we make, and the exact one we don't. We do not claim our verdicts are authoritative, human-validated, or that we hold jurisdiction over anyone. We claim they are **publicly contestable, with a survival record that begins at zero and a construct-level consequence line still open.** That is a smaller sentence than "validated against human experts." It has the one virtue that larger sentence has lost: you can check whether it is true.

## Authority you can watch accrue

Institutions that judge for a living do not earn trust by proving their judges were right in advance. They earn it structurally — by binding themselves to publish, to hear challenge, to record when they were overturned, and to do it where everyone can watch. That is the structural authority still available to an AI benchmark once you accept the pre-validation panel can no longer be trusted to be human — earned in public, and narrower than validation. Not a better panel — a better record.

We can prove today that the procedure is honest. We are not yet claiming the verdicts are authoritative. Between those two sentences is a record we intend to build in the open, one qualified challenge at a time.

**Verdicts, not vibes.**
**Testing whether AI friends stay friends under pressure.**

---

## 摘要（zh）

在 LLM 时代，几乎每个以模型为裁判的基准都依赖一个"人类一致性"数字来背书自动裁判——但你无法验证一个远程标签究竟出自人，还是出自被测的那类模型本身。最有资格标注的人，恰恰最会把活外包给 AI；κ 可以很漂亮，却什么都不证明——当裁判本身是模型时，暗中代工的小组不是在验证裁判，而是裁判在给自己的倒影打分。注意力检查、时间遥测、书面理由——凡是能用来抓代工的信号，代工者都能伪造；唯一真正有效的监督式标注又无法规模化。我们亲历过这一危机：在一份 180 样本盲标研究里，逐条核对后我们否决了一份来自可信内部贡献者的内部校准文件——不是因为有人作弊，而是因为我们无法证明没有；一个分不清"专家独立推理"与"模型代笔"的验证研究，就不成其为验证。

一致性真正要买的从来不是"人脑"，而是**独立性**——一个不经过我们裁判、却与之收敛的判断来源。法庭不靠事前民调给法官发证，而是：公开全部卷宗与 manifest；开放合格挑战通道（只查是否指向具体判决、指明错误、扣住转录，不查挑战者身份或"物种"）；如实记录曝光分母（曝光／复跑／引用／上诉与维持／改判并列——沉默不等于背书，存活记录发布日为零）；并让挑战质量自证——一个用最强模型武装的上诉人不是污染，而是最硬的压力测试，污染问题就此反转为资产。

代价要说清：发布日没有验证数字，判决级人类一致性仍未证明，构念级后果效度尚未建立——将在真实产品使用中采集，且只验证构念不验证单条判决。我们不宣称判决已被人类验证，也不主张管辖权；只宣称：判决**可被公开挑战、存活记录从零开始累积、构念级后果效度将在真实产品使用中采集**。这是更小、但可核验的一句话。**不是榜单，是案卷。测试 AI 朋友在压力下是否仍像朋友。**
