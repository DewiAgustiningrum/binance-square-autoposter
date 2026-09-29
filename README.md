# Binance Square Auto-Poster

![Workflow Status](https://github.com/acevod/binance-square-autoposter/actions/workflows/square.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

Serverless bot that generates a crypto market post every 6 hours and publishes
it to Binance Square, using GitHub Actions as the scheduler/compute (no
server, nothing that needs to stay running).

```
Cron (GitHub Actions)
  → fetch market data (Binance public spot API, data-api.binance.vision)
  → generate post text (Groq, Gemini fallback)
  → sanitize (em dashes, unicode quotes, stablecoin cashtags)
  → validate (length, cashtags, duplicates, banned patterns)
  → publish to Binance Square
  → commit post history back to the repo
```

## How it works

1. **Pick a theme**: one of 7, uniform random (`src/generate.mjs`), excluding
   whichever themes appear in the last 4 published posts
   (`getRecentThemes()` in `validate.mjs`). With 7 themes and at most 4
   excluded, there are always at least 3 left to pick from — this never
   errors out, even with no history yet.
2. **Fetch data** for that theme (`src/sources/*.mjs`).
3. **Generate text** with an LLM (Groq primary, Gemini fallback), using a
   per-theme prompt plus shared style rules (casual tone, cashtag format,
   anti-repetition, only-use-supplied-data, etc.).
4. **Sanitize** the output deterministically (`sanitizeText()` in
   `generate.mjs`), because prompt instructions alone aren't reliable.
5. **Validate** (`src/validate.mjs`): length, banned patterns, cashtag
   count/presence, duplicate check against recent posts.
6. If validation fails, **start over** (up to 3 attempts). Each attempt is a
   fresh generation and may land on a different theme, it doesn't just
   re-roll the same draft.
7. **Publish** to Binance Square (`src/publish.mjs`), then record the post
   in `data/posts.json` for future duplicate checks.
8. The workflow commits the updated `data/posts.json` back to the repo so
   history persists across runs (GitHub Actions runners are ephemeral). A
   `concurrency` lock stops a manual run and the cron run from overlapping.

## Project structure

```
.github/workflows/square.yml   cron + manual trigger, concurrency lock, runs src/run.mjs
skills/square-post/            Binance's official posting skill (publishing only)
src/
  sources/
    market.mjs                 Themes 1-5 and 7: Binance public market data
    tokenized-stocks.mjs       Theme 6: bStocks (tokenized equities), same API
  generate.mjs                 theme picker, prompts, LLM calls, sanitizeText
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

It's the only skill this repo depends on. All market data comes straight
from Binance's public spot API, with no key and no other skill involved.

## The 7 themes

| # | Theme | Source |
|---|---|---|
| 1 | Morning Market Brief | BTC/ETH/BNB 24h ticker (`market.mjs`) |
| 2 | Leaders & Laggards | Top gainers vs losers in the dynamic basket |
| 3 | Breakout Watch | Past-24h range vs 7-day average daily range (klines) |
| 4 | The Quiet Ones | Same as above, inverted: unusually compressed range |
| 5 | Relative Strength Check | ETH/BTC pair + average alt vs BTC (price performance, not capital flow) |
| 6 | Tokenized Stocks Corner | bStocks read as regular spot tickers (`tokenized-stocks.mjs`) |
| 7 | Daily Recap | BTC/ETH/BNB 24h ticker (`market.mjs`) |

All themes pull exclusively from Binance-listed USDT pairs
(`data-api.binance.vision`), with no DEX/on-chain token data anywhere in the
pipeline (see "Not included" for why). Theme selection is uniform random
(`THEMES` in `src/generate.mjs`) — all 7 themes now pull from the same
safe data source, so each gets an equal chance per run, minus whichever
were used in the last 4 posts (see "How it works" above).

The basket behind themes 2-5 is dynamic, not a hardcoded list. Every run
fetches all USDT pairs, drops stablecoin pairs and ranks the rest by 24h
quote volume. Stablecoins are caught two ways: a name list (USDC, USD1,
USDE, ...) plus a peg fingerprint (priced within 2 cents of $1 with a
sub-1% daily range), because the name list alone missed USD1 and it showed
up in a real "Quiet Ones" post. Delistings
and new listings are picked up automatically. A leveraged-token filter
(`*UP`/`*DOWN`/`*BULL`/`*BEAR`) is also in place but currently matches
nothing, since Binance discontinued those years ago.

## Setup

### 1. GitHub Secrets

Settings → Secrets and variables → Actions:

| Secret | Where to get it |
|---|---|
| `BINANCE_SQUARE_OPENAPI_KEY` | Binance Square Developer/OpenAPI settings |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |

Secrets never carry over to forks or template copies, so anyone reusing
this repo needs their own keys (and their own Square key, otherwise posts
go to *your* account). Also delete `data/posts.json` in a fresh copy so it
starts with its own history.

### 2. Workflow permissions

`.github/workflows/square.yml` needs `permissions: contents: write` (already
set) so it can commit `data/posts.json` back after a successful publish.

### 3. Schedule

Default cron is `0 */6 * * *` (every 6 hours: 00:00/06:00/12:00/18:00 UTC =
07:00/13:00/19:00/01:00 WIB). Cron in GitHub Actions is always UTC, and runs
can start a few minutes late. Adjust to taste.

At 4 runs/day with up to 3 attempts each, worst case is ~12 LLM requests and
roughly 60,000-70,000 tokens/day — comfortably under Groq's free-tier
gpt-oss-120b limits (1,000 requests/day, 200,000 tokens/day) and Square's
100 posts/day cap. The anti-repeat check (below) matters more at this
frequency: several runs can land within the same rolling-24h data window,
so avoiding a repeated theme is what keeps back-to-back posts from reading
near-identical.

## Local testing

```bash
cp .env.example .env   # then fill in the keys
node --env-file=.env src/run.mjs
```

Test individual sources in isolation:

```bash
node src/sources/market.mjs           # themes 1-5 and 7
node src/sources/tokenized-stocks.mjs # theme 6
```

**Network notes.** Binance's regular endpoints behave differently depending
on where you call them from:

- `api.binance.com` and `fapi.binance.com` return HTTP 451 from US IPs,
  which includes GitHub Actions runners (US Azure). That's why market data
  uses `data-api.binance.vision`, Binance's public market-data mirror.
  Other developers report the block can vary by time of day, so don't
  assume a passing run means the block is gone.
- Some local ISPs reset connections to `www.binance.com` / `web3.binance.com`
  (`ECONNRESET`). That's a local network issue: the same domains worked
  from GitHub Actions, and publishing itself goes through
  `www.binance.com/bapi/...`.

## Known quirks (found by testing against the real API)

These aren't documented anywhere in the skills themselves. They were found
by hitting the real errors during development:

- **Cashtag limit**: Square rejects posts referencing more than 3 distinct
  `$COIN` tickers (error `220095`, undocumented). Enforced in both the
  prompt and `validate.mjs` (`MAX_CASHTAGS`). Stablecoins written as
  cashtags count too, so `$USDT` is stripped to `USDT`.
- **Post length limit is confirmed at 1900 characters**, tested directly
  (the skill itself only documents error `20013` "Content length is
  limited" with no number). Prompts target 1600, `MAX_LENGTH` is 1850 as a
  small margin, since it's unclear whether Square counts raw characters or
  UTF-16 code units.
- **`gpt-oss-120b` is a reasoning model**: it spends part of `max_tokens`
  on internal reasoning before writing the answer, and can return empty or
  truncated text if the budget is too tight. Mitigated with
  `reasoning_effort: "low"`, a larger `max_tokens`, and explicit
  `finish_reason` checks in `generate.mjs`.
- **Em dash**: the LLM ignores "never use em dash" in the prompt often
  enough that a real run failed validation 3 attempts in a row and skipped
  the day's post. Retrying alone isn't reliable, so `generate.mjs` runs a
  deterministic `sanitizeText()` on every output before validation (em dash
  to comma or "to", curly quotes and non-breaking hyphens to ASCII). Once
  em dashes were banned the model switched to spaced en dashes (`–`), which
  are the same tell, so those are handled too. `validate.mjs` still rejects
  both as a safety net.
- **Predictive language**: even with "no predictions" in the prompt, drafts
  said things like "something brewing" and "keep an eye on the squeeze" for
  tokens whose range was only ~30% below normal. Themes 3-4 now tell the
  model to scale its wording to the size of the gap and describe only what
  happened, and `validate.mjs` rejects words like "squeeze", "brewing" and
  "coiled".
- **Cashtags must match the tradable ticker, not the raw trading-pair
  symbol**: a real post wrote "$MARSCOINUSDT" and "$ZECUSDT" — Square
  actually parsed these fine (only the base asset rendered as a live
  cashtag, "USDT" sat after as plain text) but with no space it read as
  one garbled ticker. bStocks have the same issue in reverse: they trade
  as `NVDAB`, not `NVDA`, so deriving a cashtag from the symbol guesses
  wrong either way. Every `market.mjs` and `tokenized-stocks.mjs` function
  now sends a ready-made `cashtag` field (base asset only, `$` prefix
  included) so the model doesn't have to derive one, plus a rule in
  `STYLE_RULES` telling it to use that field verbatim.
- **`success_without_post_id`**: `square-post`'s publish call can return a
  504 and still have actually posted, with `id`/`shareLink` as `null`.
  `publish.mjs` treats this as success (only a thrown error counts as
  failure). Caveat: a 504 doesn't *guarantee* the post landed, so a null id
  is "probably posted", not "confirmed".
- **bStocks trade as regular spot pairs**: `NVDABUSDT`, `TSLABUSDT`, etc.
  are readable through the same `ticker/24hr` endpoint as BTC/ETH/BNB, so
  Theme 6 doesn't need the separate RWA API that the
  `binance-tokenized-securities-info` skill documents. Switching also
  removed that skill's extra headers and a second API surface. Trade-off:
  spot tickers carry no stock fundamentals (P/E, dividend yield), so the
  theme leans on the "trades 24/7" angle instead.
- **Rolling 24h vs calendar day**: `ticker/24hr` is a rolling window ending
  now, not "since 00:00 UTC". Prompts say "past 24 hours" rather than
  "today" for that reason. Themes 3-4 also compare that rolling range
  against daily-candle averages, which is directionally useful but not a
  strict like-for-like comparison.
- **`data/posts.json` doesn't exist on first run** (or after a
  validation-only failure): the workflow's commit step checks the file
  exists before trying to `git add` it.

## Known limitations

Deliberately left as-is for a one-post-a-day bot, but worth knowing:

- No timeout or retry/backoff on individual HTTP calls (Binance, Groq,
  Gemini, Square). A hung connection stalls the run until GitHub's job
  timeout.
- `BSTOCKS` in `tokenized-stocks.mjs` is a hand-maintained list of 7
  tickers, while Binance keeps adding bStocks. It needs occasional manual
  updates (check Binance's announcements). Delisted symbols are skipped
  silently rather than breaking the theme.
- Duplicate detection is a simple word-overlap ratio (threshold 0.6) against
  the last 30 posts. It can miss paraphrases and occasionally over-reject
  posts that share common words.
- If the publish call succeeds but writing `data/posts.json` fails, that post
  isn't in history and a near-duplicate could be published later.
- No automated tests and no failure alerting; a failed run is only visible in
  the Actions tab.

## Not included / out of scope

- **DEX/on-chain skills (`trading-signal`, `crypto-market-rank`, `meme-rush`)
  were removed from this repo entirely**, not just unwired, after a real
  post (via `crypto-market-rank`'s `smart-money-inflow`) referenced a token
  not listed on Binance and got a compliance notice from Square. These
  skills surface whatever's active on BSC/Solana DEXs with no guarantee of
  a Binance listing: fine for manual research, not safe for unattended
  auto-posting. All themes now come from Binance's own listed pairs only.
- No fallback beyond Groq → Gemini (OpenRouter, etc.). At a handful of
  posts a day a dual-provider outage is unlikely enough that it's not
  worth the added complexity yet.
