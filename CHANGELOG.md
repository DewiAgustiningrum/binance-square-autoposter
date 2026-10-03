# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-03

Reliability and content-integrity release. No new secrets are required and existing `data/posts.json` files keep working; see **Upgrade notes** for the few behaviour changes.

### Added
- **Source grounding** (`src/grounding.mjs`): every `$TICKER` and every significant number in a generated post must trace back to the data the LLM was given (rounding and truncation allowed, invention not). Set `GROUNDING_MODE=warn` to log violations instead of rejecting posts.
- **Request timeouts** on every outbound call (`src/http.mjs`): Binance 15 s, LLM 60 s, Square 30 s, media upload 120 s. `HTTP_TIMEOUT_MS` overrides all of them. Timeout errors never include the request query string.
- **Retries that are safe** (`src/run.mjs`): transient generation failures are retried with growing backoff (`RETRY_DELAY_MS`, default 5000), and a post that Square definitively rejects is regenerated. A publish whose outcome is unknown (timeout, 502, 504) is never retried, to avoid duplicate posts.
- **Publish status tracking** in `data/posts.json`: each entry now has an `id` and a `status` of `pending` (written before publishing), `published`, `unknown`, or `failed`.
- **Time-aware themes**: the Morning Market Brief is only eligible 05:00-12:00 WIB and the Daily Recap only 18:00-03:00 WIB (`THEME_HOURS_WIB` in `src/generate.mjs`).
- **Optional Telegram failure alert**: a workflow step sends the repo name and run link when a run fails. It does nothing unless `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` secrets are set.
- **Automated test suite**: 74 tests on `node:test`, no dependencies, no network. Run with `npm test`. Added an `npm start` script.
- **Dependabot** for GitHub Actions updates (monthly).
- `src/cashtags.mjs`: one shared definition of what counts as a cashtag.

### Changed
- Workflow cron moved from `0 */6 * * *` to `17 */6 * * *` (00:17, 06:17, 12:17, 18:17 UTC) to avoid the top-of-hour peak when GitHub delays or drops scheduled runs.
- Workflow: `timeout-minutes: 10`, and the history commit now does `git pull --rebase` with up to 3 push attempts.
- GitHub Actions are pinned to full commit SHAs (`actions/checkout` and `actions/setup-node`, both v4.4.0).
- Morning Brief and Daily Recap prompts no longer ask for "what's worth watching next"; they describe what stood out and nothing about what comes next.
- Breakout Watch now only includes tokens at 1.3x their usual daily range or more, and Quiet Movers only 0.8x or less. Tokens with fewer than 5 full days of history are excluded. One failing klines request no longer fails the whole theme.
- Relative Strength uses the median alt instead of the mean, so a single outlier cannot skew it. Data fields: `altsAvgChangePercent` is now `altsMedianChangePercent`, and `basketSize` is replaced by `altsCount`.
- Tokenized Stocks backfills a failing symbol with another candidate and requires at least 2 tokens, otherwise the theme fails and the run retries with a different one.
- An empty source dataset is now an error instead of being sent to the LLM.
- Validation additionally rejects the wording "resistance", "could/may/might signal", and "watch the next".
- Binance responses of the wrong shape (for example a non-array ticker list) are rejected.
- `data/posts.json` is resolved relative to the module, not the current working directory.
- README updated: schedule, status lifecycle, history reset rules, limitations, testing.

### Fixed
- A corrupt, truncated, or wrongly shaped `posts.json` was silently treated as empty history, which disabled duplicate protection and let the next write overwrite every past entry. It now stops the run with a `HistoryError`.
- History writes are atomic (temp file, fsync, rename), so a crash cannot leave a half-written file.
- An HTTP 504 from Square was recorded as a confirmed publish. It is now recorded as `unknown`, with a warning to check Square manually.
- If a post was published but the follow-up history update failed, the post could be republished later. The `pending` entry written before publishing now keeps duplicate protection in place, and the run no longer fails over bookkeeping.
- Tickers containing digits (`$1INCH`, `$1000SATS`) were not recognised, so the 3-cashtag cap could be bypassed and digit-only posts were rejected for having no cashtag.
- The "as an AI" filter wrongly rejected posts containing phrases such as "as an airdrop candidate".
- Ticker selection in Tokenized Stocks was biased toward some symbols; it now uses a uniform shuffle.

### Security
- The Gemini API key is sent in the `x-goog-api-key` header instead of the URL query string, so it cannot end up in logs.
- Third-party GitHub Actions are pinned to immutable commit SHAs.

### Upgrade notes
- Existing `data/posts.json` entries without `status` are read as published. No migration is needed.
- A `posts.json` that exists but is empty, corrupt, or not an array now stops the run. To reset history, delete the file or set its content to `[]`. A missing file is still fine.
- Grounding is strict by default. If you want to observe its effect first, set `GROUNDING_MODE: warn` in the "Generate and publish post" step of `.github/workflows/square.yml`.
- Anything that consumed the Relative Strength data fields directly must use the renamed fields (see **Changed**).
- Forks need their own secrets, Actions enabled, and workflow permissions set to read and write; this is unchanged from 1.0.0.

## [1.0.0]

Initial release.
