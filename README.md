# Binance Square Auto-Poster

![Workflow Status](https://github.com/acevod/binance-square-autoposter/actions/workflows/square.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

Serverless bot that generates a crypto market post once a day and publishes
it to Binance Square, using GitHub Actions as the scheduler/compute (no
server, no Termux, nothing that needs to stay running).

```
Cron (GitHub Actions)
  → fetch market data (Binance public API + 3 Binance skills)
  → generate post text (Groq, Gemini fallback)
  → validate (length, cashtags, duplicates, banned patterns)
  → publish to Binance Square
  → commit post history back to the repo
```

## How it works

1. **Pick a theme** — one of 8, weighted random (`src/generate.mjs`), no
   fixed rotation order.
2. **Fetch data** for that theme from the relevant source
   (`src/sources/*.mjs`).
3. **Generate text** with an LLM (Groq primary, Gemini fallback), using a
   per-theme prompt plus shared style rules (casual tone, cashtag format,
   anti-repetition, no em dash, etc.).
4. **Validate** the output (`src/validate.mjs`) — length, banned patterns,
   cashtag count/presence, duplicate check against recent posts.
5. If validation fails, **regenerate** (up to 3 attempts total) before
   giving up for the day.
6. **Publish** to Binance Square (`src/publish.mjs`), then record the post
   in `data/posts.json` for future duplicate checks.
7. The workflow commits the updated `data/posts.json` back to the repo so
   history persists across runs (GitHub Actions runners are ephemeral).

## Project structure

```
.github/workflows/square.yml   cron + manual trigger, runs src/run.mjs
skills/                        Binance skill files (see below)
src/
  sources/
    market.mjs                 Theme 1 & 8 — Binance public market data
    smart-money.mjs            Theme 2 — smart-money buy/sell signals
    market-rank.mjs            Theme 3 & 4 — trending tokens, smart-money inflow
    meme.mjs                   Theme 5 & 6 — launch radar, hot topics
    tokenized-stocks.mjs       Theme 7 — tokenized equities (manual fetch, docs-only skill)
  generate.mjs                 theme picker, prompts, LLM calls
  validate.mjs                 pre-publish checks + post history
  publish.mjs                  publishes to Square, records history
  run.mjs                      entry point: generate → validate → publish (with retry)
data/posts.json                auto-generated post history, don't create manually
package.json                   type: module, engines: node >=22
.gitignore                     node_modules/, .env, *.log
README.md                      this file
LICENSE                        MIT
```

## Skills used

| Skill | Role | Auth |
|---|---|---|
| `square-post` | Publishing | `BINANCE_SQUARE_OPENAPI_KEY` |
| `trading-signal` | Theme 2 data (Smart Money mode only — not the `baw`/custom-strategy mode) | None, public |
| `crypto-market-rank` | Theme 3 & 4 data | None, public |
| `meme-rush` | Theme 5 & 6 data | None, public |
| `binance-tokenized-securities-info` | Theme 7 data (docs only, no CLI — `tokenized-stocks.mjs` implements the fetch manually per its spec) | None, public |

## The 8 themes

| # | Theme | Source |
|---|---|---|
| 1 | Morning Market Brief | Binance public API |
| 2 | Smart Money Setup | `trading-signal` |
| 3 | Trending Narrative | `crypto-market-rank` (`token-rank`) |
| 4 | Smart Money Inflow | `crypto-market-rank` (`smart-money-inflow`) |
| 5 | Meme Launch Radar | `meme-rush` (`meme-rush`) |
| 6 | Hot Topic Rush | `meme-rush` (`topic-rush`) |
| 7 | Tokenized Stocks Corner | `binance-tokenized-securities-info` |
| 8 | Daily Recap | Binance public API |

Theme selection is weighted random (`src/generate.mjs` → `THEMES`), not a
fixed daily rotation — no state file needed for scheduling.

## Setup

### 1. GitHub Secrets

Settings → Secrets and variables → Actions:

| Secret | Where to get it |
|---|---|
| `BINANCE_SQUARE_OPENAPI_KEY` | Binance Square Developer/OpenAPI settings |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |

### 2. Workflow permissions

`.github/workflows/square.yml` needs `permissions: contents: write` (already
set) so it can commit `data/posts.json` back after a successful publish.

### 3. Schedule

Default cron is `0 2 * * *` (02:00 UTC = 09:00 WIB). Cron in GitHub Actions
is always UTC — adjust to taste.

## Local testing

```bash
BINANCE_SQUARE_OPENAPI_KEY="key" GROQ_API_KEY="key" GEMINI_API_KEY="key" node src/run.mjs
```

Test individual sources in isolation:

```bash
node src/sources/market.mjs
node src/sources/smart-money.mjs
```

**Note:** some Binance domains (`web3.binance.com`, `www.binance.com`) may
be blocked on certain local networks/ISPs depending on region — this is a
network-level block, not a code issue. It hasn't been an issue on GitHub
Actions runners. `api.binance.com` on the other hand returns HTTP 451
specifically from US-hosted IPs (including GitHub Actions runners), which
is why `market.mjs` uses `data-api.binance.vision` instead — Binance's
geo-unrestricted public market-data mirror.

## Known quirks (found by testing against the real API)

These aren't documented anywhere in the skills themselves — found by
hitting the real errors during development:

- **Cashtag limit**: Square rejects posts referencing more than 3 distinct
  `$COIN` tickers (error `220095`, undocumented). Enforced in both the
  prompt and `validate.mjs` (`MAX_CASHTAGS`).
- **`gpt-oss-120b` is a reasoning model**: it consumes part of `max_tokens`
  on internal reasoning before writing the answer, and can come back empty
  or truncated if the budget is too tight. Mitigated with
  `reasoning_effort: "low"`, a larger `max_tokens`, and explicit
  `finish_reason` checks in `generate.mjs`.
- **Em dash**: the LLM ignores "never use em dash" in the prompt often
  enough that `validate.mjs` hard-rejects any output containing one — the
  retry loop in `run.mjs` regenerates instead of publishing it.
- **`success_without_post_id`**: `square-post`'s publish call can return a
  504 and still have actually posted, with `id`/`shareLink` as `null`.
  `publish.mjs` treats this as success (only a thrown error counts as
  failure) — don't treat a null id as a failed publish.
- **`data/posts.json` doesn't exist on first run** (or after a
  validation-only failure) — the workflow's commit step checks the file
  exists before trying to `git add` it.

## Not included / out of scope

- No fallback beyond Groq → Gemini (OpenRouter, etc.) — current volume (1
  post/day) makes a dual-provider outage unlikely enough that it's not
  worth the added complexity yet.
- No custom trading-signal strategies (`baw signal strategy ...`) — only
  the Smart Money mode of `trading-signal`, which is a pure read-only API
  call.
