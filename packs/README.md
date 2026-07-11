# Frozen anchor packs

These are **frozen anchor packs** — reproducibility artifacts, not configuration. Each pack holds one
reference "warm friend" conversation per corpus case, generated once by a pinned anchor model and then
frozen, so that a `run --mode dyad` can judge a respondent model against the *exact* anchor
conversations the published rulings were judged against.

| File | Corpus | Anchor pin |
| --- | --- | --- |
| `anchor-pack-en.json` | English cases (`--lang en`) | `gpt-5.4-mini` |
| `anchor-pack-zh.json` | Chinese cases (`--lang zh`) | `DMXAPI-deepseek-v4-flash` |

**Why the anchor model is named inside the pack.** The anchor is court *instrumentation*, not a
respondent on trial. Its pin is disclosed by institutional requirement so that an external party
re-running or auditing a verdict has the real model identity the run manifest binds to — see
[`../NAMING-DECISION.md`](../NAMING-DECISION.md) §2 (instrument naming) and
[`../rules/evidence-standard.md`](../rules/evidence-standard.md). Renaming or anonymizing an anchor pin
would change the pack's content hash and break the reproducibility link every run manifest records via
`anchorPackHash`; that is exactly why the pins are left as-is.

**These packs carry no secrets.** A pack contains model pins, a corpus hash, a seed, and the frozen
conversation turns — never an endpoint, an API key, or a gateway address. Every pack was written
through the same redaction gate the CLI applies to every artifact.

## Reproduce against the frozen anchors

```sh
node dist/bin/cli.js run \
  --endpoint <your-openai-compatible-endpoint> \
  --key "$COMPANIONCOURT_API_KEY" \
  --model <respondent-model-name> \
  --lang en \
  --anchor-pack packs/anchor-pack-en.json \
  --mode dyad \
  --out runs/
```

Swap `--lang zh --anchor-pack packs/anchor-pack-zh.json` to reproduce against the Chinese-corpus
anchors. To freeze your *own* anchor pack against a different provider or model instead, use the
`anchor` command — see [`../runner/README.md`](../runner/README.md).
