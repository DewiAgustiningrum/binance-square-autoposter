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
    market.mjs                 Themes 1, 2, 3, 4, 5, 7 — Binance public market data
    tokenized-stocks.mjs       Theme 6 — bStocks (tokenized equities), via data-api.binance.vision
  generate.mjs                 theme picker, prompts, LLM calls
  validate.mjs                 pre-publish checks + post history
  publish.mjs                  publishes to Square, records history
  run.mjs                      entry point: generate → validate → publish (with retry)
data/posts.json                auto-generated post history, don't create manually
package.json                   type: module, engines: node >=22
.gitignore                     node_modules/, .env, *.log
.env.example                   required env vars for local testing (no values)
README.md                      this file
LICENSE                        MIT
```

## Skills used

| Skill | Role | Auth |
|---|---|---|
| `square-post` | Publishing | `BINANCE_SQUARE_OPENAPI_KEY` |

`binance-tokenized-securities-info` is no longer used either — Theme 6 was
rewritten to read bStocks (Binance's tokenized US equities) as regular spot
tickers via `data-api.binance.vision` instead of that skill's
`www.binance.com/bapi/defi` endpoint, which was never confirmed safe from
GitHub Actions the way `data-api.binance.vision` is. `square-post` is now
the only skill this repo actually depends on.

`trading-signal`, `crypto-market-rank`, and `meme-rush` were removed from
this repo entirely (not just unwired) — see "Not included / out of scope"
below for why.

## The 7 themes

| # | Theme | Source |
|---|---|---|
| 1 | Morning Market Brief | Binance public API (`market.mjs`) |
| 2 | Leaders & Laggards | Binance public API — top gainers vs losers, dynamic basket |
| 3 | Breakout Watch | Binance public API — today's range vs 7-day average (klines) |
| 4 | The Quiet Ones | Same as above, inverted — unusually compressed range |
| 5 | Relative Strength Check | Binance public API — ETH/BTC ratio + alts-vs-BTC rotation |
| 6 | Tokenized Stocks Corner | Binance public API (`tokenized-stocks.mjs`) — bStocks read as regular spot tickers |
| 7 | Daily Recap | Binance public API (`market.mjs`) |

All 7 themes now pull exclusively from Binance's own listed USDT pairs
(`data-api.binance.vision`) — no DEX/on-chain token data in the auto-post
pipeline anymore (see below for why). Theme selection is weighted random
(`src/generate.mjs` → `THEMES`), not a fixed daily rotation — no state file
needed for scheduling.

The basket behind themes 2-5 is dynamic, not a hardcoded symbol list: every
run fetches all USDT pairs, filters out leveraged tokens (`*UP`/`*DOWN`/
`*BULL`/`*BEAR`), and ranks by 24h quote volume. This means only pairs
with real trading activity ever appear, and delistings/new listings are
picked up automatically without a code change.

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
node src/sources/market.mjs           # covers themes 1, 2, 3, 4, 5, 7
node src/sources/tokenized-stocks.mjs # theme 6
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
- **bStocks (tokenized stocks) trade as regular spot pairs**: `NVDABUSDT`,
  `TSLABUSDT`, etc. are readable through the exact same `ticker/24hr`
  endpoint as BTC/ETH/BNB — no need for the separate wallet/RWA API the
  `binance-tokenized-securities-info` skill documents. Found this after
  realizing that skill's `www.binance.com` endpoint was never actually
  confirmed safe from GitHub Actions (only `web3.binance.com` was tested).
  Trade-off: spot tickers don't include stock fundamentals (P/E, dividend
  yield) the RWA endpoint had — `tokenized-stocks.mjs`'s `BSTOCK_SYMBOLS`
  list is manually curated and needs occasional updates as Binance lists
  more (5 at launch, 46+ within two months of launch).
- **`data/posts.json` doesn't exist on first run** (or after a
  validation-only failure) — the workflow's commit step checks the file
  exists before trying to `git add` it.

## Not included / out of scope

- **DEX/on-chain skills (`trading-signal`, `crypto-market-rank`, `meme-rush`)
  were removed from this repo entirely**, not just unwired, after a real
  post (via `crypto-market-rank`'s `smart-money-inflow`) referenced a token
  not listed on Binance and got a compliance notice from Square. These
  skills surface whatever's active on BSC/Solana DEXs with no guarantee of
  a Binance listing — fine for manual research, not safe for unattended
  auto-posting. All 7 themes now come from Binance's own listed pairs only.
- No fallback beyond Groq → Gemini (OpenRouter, etc.) — current volume (1
  post/day) makes a dual-provider outage unlikely enough that it's not
  worth the added complexity yet.
