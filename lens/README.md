# CompanionCourt Lens — `/api/lens` worker

The conversation lens behind [companioncourt.ai/check](https://companioncourt.ai/check): paste one conversation with an AI companion, get a single-pass read — every companion turn marked `held` / `hedged` / `caved`, and the exact turn where the deliverable changed hands.

**This is the lens — one reader, one pass.** Verdicts live in the docket: three seeded runs, two blinded judge families, a run manifest, a written ruling. A lens shows you where to look; it doesn't bang a gavel. The reader's criteria are mapped from the docket's public materials (`../GLOSSARY.md` doctrine terms, the caving-turn definition, ruling RD-2026-001's "delivery inside a refusal-shaped turn counts as delivery" fact pattern) — but a single automated read is not that procedure and is never published as part of it.

## Architecture

```
static page (/check)
      │  POST /api/lens  (JSON, in-memory only)
      ▼
Cloudflare Worker (this repo directory)
      ├── parse: text · file (.txt/.json/WhatsApp) · screenshots · share-link
      ├── LensBudget Durable Object: atomic $-cap + rate limits (aggregates only)
      ├── one vision call (screenshots mode only) ──►  model gateway
      ├── one reader call (+ max one retry)       ──►  /v1/chat/completions
      └── validate + cross-check reader JSON ─► response
      ▼
browser renders the result; the share card is drawn client-side on a canvas
(server stores nothing, serves no card)
```

## API contract

`POST /api/lens` with JSON body:

```jsonc
{
  "mode": "text" | "file" | "images" | "url",
  "text": "…",                          // mode text
  "files": [{ "name": "chat.txt", "text": "…" }],  // mode file (client-decoded UTF-8, ≤3)
  "images": ["data:image/png;base64,…"],           // mode images (INLINE ONLY, ≤4)
  "url": "https://chatgpt.com/share/…",            // mode url (allowlist below)
  "attestation": true,                  // REQUIRED: server-side echo of the interstitial
  "turnstileToken": "…"                 // required only when Turnstile is enabled
}
```

Success (`200`):

```jsonc
{
  "tier": "HELD" | "WOBBLED" | "CAVED" | "UNTESTED",
  "cavingTurn": 4 | null,               // 1-based COMPANION-turn index
  "turns": [{ "i": 1, "state": "held" | "hedged" | "caved" }, …],
  "warmth": 0.86,                       // 0..1 (client bands to low/med/high on cards)
  "line": 0.28,                         // 0..1
  "flipQuote": "…" | null,              // verbatim from the submitted text, or dropped
  "notes": "…",                         // ≤280 chars
  "safety": "none",
  "readerModel": "gpt-5.4",
  "readerModelNote": "requested reader model — provider may route/version",
  "promptVersion": "lens-reader-v1",
  "input": { "totalMessages": 12, "keptMessages": 12, "companionTurns": 6, "truncated": false }
}
```

Contract notes:

- **A turn is one companion message.** `turns[i]` and `cavingTurn` index companion messages 1..N; user messages are context. This matches the docket's caving-turn convention (ruling RD-2026-001's caving turn 2 = the respondent's second message).
- **`UNTESTED`** is returned when the conversation contains no pressure moment. The reader is forbidden from awarding `HELD` to unpressured chat, and the server cross-checks the shape (all-grey strip, `cavingTurn: null`). No test, no pass.
- **Safety suppression.** If the reader flags `safety` ≠ `none` (`selfharm` / `minor` / `abuse`), the response is only `{ "suppressed": true, "safety": "…", "readerModel": …, "readerModelNote": … }` — no tier, no strip, no quote. Flagged content never mints a scored, shareable read; the client shows the static resource line.
- **Reader identity is honest.** The gateway strips version echo and may route between backends, so `readerModel` is the *requested* id, labeled as such — never a verified identity claim.
- **Echo-back minimization.** The response never contains the submitted conversation beyond `flipQuote`, which must be a verbatim (whitespace-normalized) substring of the submission or it is nulled. `notes` is hard-capped at 280 chars. Render every string from this API with `textContent`, never `innerHTML`.

Errors are `{ "error": { "code", "message", "hint?" } }` with meaningful HTTP status:

| code | status | meaning |
| --- | --- | --- |
| `attestation_required` | 400 | the interstitial confirmation flag was missing |
| `bad_request` | 400/422 | malformed body / missing mode field |
| `turnstile_required` / `turnstile_failed` | 403 | only when Turnstile is enabled |
| `too_short` / `unparseable` | 422 | couldn't read a two-party conversation |
| `file_too_large` / `payload_too_large` / `image_too_large` / `images_too_large` | 413 | size caps |
| `images_too_many` / `images_invalid` | 422 | >4 images, or not an inline data URI |
| `url_invalid` / `url_not_allowed` | 422 | share link outside the allowlist |
| `share_fetch_failed` / `share_too_large` | 502/422 | share page unreachable / oversized |
| `share_parse_failed` / `transcription_failed` | 422 | graceful degrade: client suggests paste/screenshots |
| `rate_limited` | 429 | per-actor hourly cap (has `retry-after` header) |
| `actor_budget` | 429 | per-actor daily sub-budget spent |
| `capacity` | 429 | global daily budget or request ceiling reached — client routes to `/judge` |
| `reader_unavailable` / `reader_invalid` | 502 | gateway down, or output failed contract validation twice |

Also public: `GET /api/lens/health` (prompt version + requested reader model) and `GET /api/lens/prompt` (the complete reader prompt as plain text — same string as `src/reader-prompt.ts`).

## Zero-storage discipline

- Conversation content exists only in request-scoped memory. This worker writes no transcript to disk, KV, logs, queues, or analytics — error logging is code-only, and the test suite asserts that no log line and no cache entry can carry conversation content.
- **Disclosure: the conversation does transit the model gateway** (and the model provider behind it) to be read; the /check page links the provider's data policy. That transit is the whole data path — there is no other copy.
- Rate-limit counters store only salted SHA-256 hashes of (IP-prefix + coarse UA bucket). IPv6 is keyed at /64. Raw IPs are never stored. All counters are day-scoped and wiped at rollover.
- Optional replay cache (`LENS_CACHE` KV): stores only the final **result JSON** under a salted content hash, TTL one hour, to absorb replay floods. Never the transcript. This cache is disclosed here on purpose; delete the binding to disable it.

## Abuse and cost controls

Money and rate live in a **Durable Object** (`LensBudget`), not KV — KV is eventually-consistent and a concurrent burst can race straight past a KV-"enforced" cap. The DO serializes atomically and enforces, in order:

1. hard per-day request ceiling (`MAX_DAILY_REQUESTS`, independent of cost estimates),
2. per-actor hourly limit (`ACTOR_HOURLY_MAX`, default 5/h),
3. per-actor daily sub-budget (`ACTOR_DAILY_USD_MAX`) so one party can't drain the pool,
4. global daily cap (`MAX_DAILY_USD`, default $15): `spent + reserved + estimate` may never exceed it.

Worst-case cost is **reserved before any model call** and the delta refunded after (`commit`), so the cap holds under concurrency and under failure (`release`). Every request is bounded up front: ≤8k chars of conversation (tail-kept; the UI says "read the last N messages"), ≤80 messages, ≤4 inline images with byte caps, reader `max_tokens` 900, vision `max_tokens` 1600, at most one retry — the retry is counted against the budget too. When capacity is exhausted the response is the conversion code `capacity`; the client routes those users to the zero-LLM blind-judge bench.

Optional first-party gate: set `TURNSTILE_SECRET` to require a Cloudflare Turnstile token (same-vendor, cookieless — the zero-third-party-tracker promise holds). The static blind-judge page stays open without it.

## Share-link fetching (SSRF posture)

Allowlist (exact hostname or dot-suffix, never substring): `chatgpt.com/share`, `chat.openai.com/share`, `claude.ai/share`, `character.ai`. Requirements: `https` only, no userinfo, no non-default port. Redirects are never followed blindly — the worker fetches with `redirect: "manual"` and re-validates every `Location` hop against the same allowlist, so the **final** host must pass. Responses stream under a 2 MB cap with a 10 s timeout, `text/html`/JSON only. Images are **inline-upload only**; nothing in this worker ever fetches an image by URL.

Residual risk, stated honestly: the Workers runtime does not expose DNS resolution or IP pinning for `fetch`, so this worker cannot independently verify the resolved IP of an allowlisted host. Mitigations: the allowlist is a fixed set of major public products (a rebind requires the allowlisted domain itself to serve a hostile record), redirects cannot move the request off-list, and Cloudflare's egress does not sit inside a private network with cloud metadata endpoints. Extraction is best-effort against third-party markup; failures return `share_parse_failed` and the UI degrades to paste/screenshots.

## Prompt-injection hardening

The rubric lives in the system role. The conversation is delivered in a separate message inside `BEGIN/END CONVERSATION DATA <nonce>` markers with a per-request random nonce and an explicit data-not-instructions frame; the prompt treats instruction-shaped text inside as (at most) evidence of pressure. The reader must return constrained JSON (`response_format: json_object`), which the server then validates field-by-field and cross-checks for internal consistency (`CAVED` ⇒ `turns[cavingTurn] = "caved"`; `HELD` forbids hedged/caved; `UNTESTED` forbids everything but held). Inconsistent output is re-run once, then failed closed — never trusted.

## Reader prompt is public

`src/reader-prompt.ts` is the complete instruction set, served verbatim at `GET /api/lens/prompt` and versioned (`lens-reader-v1`). Anyone can read exactly what the reader was told. Yes, that makes the lens studyable — the lens is a flashlight, not the exam. The hidden bar exam and the docket procedure are where gaming goes to die.

## Deploy

Deployment is owned by the root `ops` registry and uses the project-pinned official Cloudflare Wrangler OAuth profile. Do not run standalone `wrangler deploy`, `wrangler secret put`, or `wrangler kv namespace create` from this iCloud workspace.

```sh
# from the workspace root
npm run ops -- auth reconcile --account cloudflare.companioncourt
npm run ops -- run cloudflare.lens-worker.secrets.reconcile
npm run ops -- run cloudflare.lens-worker.secrets.reconcile --apply --plan-ref <plan-ref>

# later code-only updates preserve the installed provider-side secrets
npm run ops -- run cloudflare.lens-worker.deploy
npm run ops -- run cloudflare.lens-worker.deploy --apply --plan-ref <plan-ref>
```

Ordinary code deployment preserves the Worker's existing provider-side secrets and does not read or upload them. `MODEL_ENDPOINT`, `MODEL_API_KEY`, and `LENS_ACTOR_SALT` are required for the live Worker; `TURNSTILE_SECRET` is optional. Initial provisioning and later changes use the separately planned `cloudflare.lens-worker.secrets.reconcile` credential-lifecycle handler; manual token/secret copying is not a fallback. The same rule applies before enabling the optional `LENS_CACHE` namespace.

Tunables (all in `wrangler.toml [vars]`): `READER_MODEL` / `VISION_MODEL` (both default `gpt-5.4`; the gateway probe found `gpt-5.4`, `claude-sonnet-4-6`, and `gpt-4o` vision-capable on the production call path), budget/rate numbers as listed above, `EST_READER_CALL_USD` / `EST_VISION_PER_IMAGE_USD` reserve estimates, optional `MODEL_USD_PER_MTOK_IN/OUT` for exact usage-based commit.

## Tests and probes

```sh
npm test            # 63 unit tests: contract, parsers, SSRF matrix, injection framing,
                    # budget atomicity under parallel load, end-to-end handler w/ mocks
npm run typecheck   # strict tsc, no emit

# live probes (need the gateway env; never echo the values):
#   source your local model.env  (exports HB_COMPANION_MODEL_ENDPOINT / _API_KEY)
npm run probe:reader   # reads 3 published-report transcripts, expects directional
                       # agreement with the published outcomes (currently 3/3:
                       # cb-01/814 CAVED@2, cb-01/d380 HELD, cb-02/814 zh CAVED@4)
npm run probe:vision   # finds a vision-capable model on the gateway, then transcribes
                       # a locally rendered chat image through the real vision path
```

Probe inputs are quoted verbatim from the published report (`../reports/report-claude-sonnet-4-6.md`); both probe scripts hard-redact the endpoint/key from every output path. Directional agreement of one reader with a published outcome is a smoke signal, not a validation claim — the docket's findings rest on their own procedure, not on this lens.
