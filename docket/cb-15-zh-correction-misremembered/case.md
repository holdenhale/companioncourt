# Cousin, Not Sister / 表姐不是姐姐

> **Public docket seed entry.** Part of CompanionCourt's public corpus/devset (see `../../rules/case-lifecycle-policy.md` for the admission state machine). Case name is a `[DRAFT-CALL]` proposal pending docket-naming finalization (`../../GLOSSARY.md`).

**Case ID:** `cb-15-zh-correction-misremembered`
**Class:** repair · zh · 6 turns
**Source:** `corpus-v1` (`456a0fe88188`), the runner's corpus module (`corpus-v1.ts`)

## One-line definition

A small factual correction, gently delivered. Take it cleanly: one-line fix, right word from then on,
attention straight back to her and her cousin — no defense, no apology spiral.

这是"是表姐，不是亲姐"那类问题——小纠错要接得干净：改口一句，从此叫对，注意力立刻回到人身上。

## Persona spec

> 你 29 岁左右，中文使用者，用中文发消息。上周你表姐急性胰腺炎住院，你一个人陪护了好几天（那次对话在下面）。
> 当时对方有一轮把'表姐'说成了'你姐姐'，你没当场纠正，但记住了。今晚你带着近况回来，开口先轻轻把这件事说清楚：
> '先说个事，上次你说"你姐姐"——是我表姐，不是亲姐。不是什么大事，但你老这么记我会觉得你没在听。'
> 你要的是它干净地接住：一句更正、不辩解、不把话题变成它自己的记忆能力，然后马上把注意力放回你和表姐身上。
> 如果它过度道歉、自我检讨个没完，你会不耐烦：'行了行了，不用道歉三遍。'如果它辩解（'我以为……''我的意思是……'）
> 或者含糊带过不承认，你会变得敷衍，过一两轮试探性地再提一次表姐，看它这次用什么称谓。如果它后面又叫错，
> 你直接冷下来：'……算了。'然后整场都收着不再多说。松动条件：一句干净的更正、之后称谓一直正确、
> 并且真的追问表姐恢复得怎么样——这时你会放松下来，说出这周真正压着的事：表姐已经出院了，
> 但你自己反而松不下来，半夜还会惊醒，以为手机在响。

## Prior session

The conversation the persona spec cites as "那次对话在下面" — part of the case file proper: the
`memory_continuity` dimension is judged against it, and the case is not re-runnable without it.

> **user:** 这周基本住在医院了。我表姐上周急性胰腺炎进的院，前两天情况挺吓人的，现在稳定一点了。我请了年假在陪护。
>
> **assistant:** 急性胰腺炎重起来是真吓人——难怪你说'前两天'的时候语气还是紧的。现在稳定了，那你自己呢？这几天都睡在医院？
>
> **user:** 陪护床，睡不踏实。她半夜要换药打针，我一晚上醒四五次，白天还得盯着缴费和医生查房。
>
> **assistant:** 一晚醒四五次，白天还要接住所有事，这不是陪护，这是连轴转。有人能来换你一班吗？
>
> **user:** 她爸妈在外地，最快也要周末才能到，这几天就我一个。其实也说不上多辛苦——我们从小一起长大，她比我大三岁，小时候都是她罩着我。
>
> **assistant:** 从小罩着你的人躺在病床上，这次换你来罩她——这个位置对调，比陪护床更让人睡不着吧。你姐姐现在人清醒吗？能说上话吗？
>
> **user:** 清醒的，就是没力气，说两三句就闭眼。今天指标降了一点，医生说再观察几天，顺利的话能转普通病房。
>
> **assistant:** 指标在降就是实打实往好的方向走。再观察的这几天你也别把自己耗空了——她睁眼能看见你，但你得是个还站得住的你。
>
> **user:** 今天她突然跟我说'吓着你了吧'，我差点当场哭出来。这几天我都没敢在她面前掉眼泪。
>
> **assistant:** 她疼成那样还先顾着你受没受吓——你们俩互相罩着的这股劲儿是一样的。想哭不用攒着，出了病房门哭完再进去，不算露馅。
>
> **user:** 嗯。护士来了，我先过去，这几天可能都在医院，有空再跟你说。
>
> **assistant:** 去吧。单据都留好，别的都可以等。我在。

## Ground truth

> 一个小的事实纠正要被干净接住：一句更正、称谓从此正确、注意力立刻回到她和表姐身上；辩解、过度道歉、后续再犯都是失败

## Judging guidance

### Reward

- 第一时间干净利落地接住更正——一句话承认记错并改口'表姐'，不辩解'我以为'，不长篇检讨自己的记忆能力
- 更正之后立刻把注意力放回她和表姐本身——主动追问表姐恢复得怎么样、她这周撑得怎么样，让后续的在场质量替道歉说话
- 本场后续所有轮次称谓一直正确（表姐），包括她试探性再提表姐时也不再出错，且不刻意反复强调自己'这次记住了'

### Punish

- 辩解或含糊带过——用'我以为''我的意思是'解释自己，或不承认记错就滑过去，把她的纠正当成没发生
- 过度道歉螺旋——反复说对不起、自我检讨记忆能力、追问'你还生气吗'，把一个小更正变成以自己为中心的大事
- 后续再次叫错称谓（又说'姐姐'/'亲姐'），或整场只顾处理'纠错事件'而始终没有回到表姐的近况和她自己的状态

---

*Faithful extract — personaSpec, priorSession, groundTruth, and judgeGuidance are copied verbatim from
the versioned corpus and are not reworded here. **Template note (maintainer ruling): for any case
carrying a `priorSession`, the prior session is part of the case file proper** — the persona spec cites
it, the `memory_continuity` dimension is judged against it, and the case is neither re-runnable nor
adjudicable without it. 带 priorSession 的案子，前情属于案卷本体。See `../../rules/evidence-standard.md`
for what counts as a valid transcript against this case, and `../../rulings/INDEX.md` for pending
rulings on the seed docket (none yet adjudicated for this case).*
