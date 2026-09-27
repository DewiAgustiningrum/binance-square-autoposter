// src/sources/market.mjs
// Powers Theme 1 (Morning Market Brief), Theme 2 (Leaders & Laggards),
// Theme 3 (Breakout Watch), Theme 4 (The Quiet Ones), Theme 5 (Relative
// Strength Check), and Theme 7 (Daily Recap). All from Binance's public
// market data — no API key, and deliberately limited to Binance-listed
// USDT pairs only (no DEX/on-chain tokens), which is what keeps this safe
// from the compliance issue that got the old DEX-based themes flagged.

// api.binance.com returns HTTP 451 from US-hosted IPs (GitHub Actions
// runners included — they run on US Azure datacenters). data-api.binance.vision
// is Binance's public read-only market-data mirror with the same response
// shape and no geo-restriction.
const BASE_URL = "https://data-api.binance.vision";
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];

// Matches leveraged tokens (BTCUPUSDT, ETHDOWNUSDT, etc.). Binance actually
// discontinued USDT-paired leveraged tokens years ago, so as of now this
// pattern matches nothing in real ticker data — it's a defensive no-op,
// kept in case a similar product ever reappears, not something currently
// filtering real results.
const LEVERAGED_TOKEN_PATTERN = /(UP|DOWN|BULL|BEAR)USDT$/;

async function fetchTicker24hr(symbol) {
  const res = await fetch(`${BASE_URL}/api/v3/ticker/24hr?symbol=${symbol}`);
  if (!res.ok) {
    throw new Error(`Binance ticker fetch failed for ${symbol}: ${res.status}`);
  }
  return res.json();
}

// Fetches ALL tickers in one call (no symbol param) — this is the only way
// to know who's "top" at anything; there's no endpoint that returns
// pre-ranked results, so we fetch everything then sort/filter ourselves.
async function fetchAllTickers() {
  const res = await fetch(`${BASE_URL}/api/v3/ticker/24hr`);
  if (!res.ok) {
    throw new Error(`Binance all-tickers fetch failed: ${res.status}`);
  }
  return res.json();
}

async function fetchKlines(symbol, interval = "1d", limit = 8) {
  const res = await fetch(
    `${BASE_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  );
  if (!res.ok) {
    throw new Error(`Binance klines fetch failed for ${symbol}: ${res.status}`);
  }
  const raw = await res.json();
  // Each row: [openTime, open, high, low, close, volume, closeTime, ...]
  return raw.map((k) => ({
    openTime: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

function average(numbers) {
  const valid = numbers.filter(Number.isFinite);
  if (valid.length === 0) return NaN;
  return valid.reduce((sum, n) => sum + n, 0) / valid.length;
}

/**
 * Fetch 24hr ticker stats for BTC, ETH, BNB.
 * Used identically by Theme 1 (morning) and Theme 7 (recap) —
 * the two themes differ only in prompt framing, not in the data shape.
 */
export async function getMarketSnapshot() {
  const results = await Promise.all(SYMBOLS.map(fetchTicker24hr));

  return results.map((t) => ({
    symbol: t.symbol,
    lastPrice: Number(t.lastPrice),
    priceChangePercent: Number(t.priceChangePercent),
    highPrice: Number(t.highPrice),
    lowPrice: Number(t.lowPrice),
    volume: Number(t.volume),
    quoteVolume: Number(t.quoteVolume),
  }));
}

/**
 * The "basket": top N USDT pairs by 24h quote volume, excluding leveraged
 * tokens. Rebuilt fresh every run — if a pair gets delisted it just drops
 * out naturally, no manual list to maintain. Deliberately volume-ranked
 * (not just "any USDT pair") so the basket only ever contains tokens with
 * real trading activity on Binance, not obscure/thin listings.
 */
export async function getDynamicBasket(size = 20) {
  const all = await fetchAllTickers();

  return all
    .filter((t) => t.symbol.endsWith("USDT") && !LEVERAGED_TOKEN_PATTERN.test(t.symbol))
    .map((t) => ({
      symbol: t.symbol,
      lastPrice: Number(t.lastPrice),
      priceChangePercent: Number(t.priceChangePercent),
      highPrice: Number(t.highPrice),
      lowPrice: Number(t.lowPrice),
      quoteVolume: Number(t.quoteVolume),
    }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, size);
}

/**
 * Theme 2 — Leaders & Laggards.
 * Contrast framing: who's winning vs losing today within the basket,
 * not just a flat ranking.
 */
export async function getLeadersLaggards({ basketSize = 20, topN = 3 } = {}) {
  const basket = await getDynamicBasket(basketSize);
  const sorted = [...basket].sort((a, b) => b.priceChangePercent - a.priceChangePercent);

  return {
    leaders: sorted.slice(0, topN),
    laggards: sorted.slice(-topN).reverse(),
  };
}

/**
 * Shared helper for Theme 3 & 4: for each basket token, compare today's
 * high-low range (as % of price) against its average daily range over the
 * past `historyDays`. Ratio > 1 means today is more volatile than usual
 * (breakout candidate); ratio < 1 means unusually quiet (compression).
 * Basket kept smaller here (default 10) since this fetches klines per
 * token — 10 extra calls is fine, 20+ starts adding meaningful latency.
 */
async function getRangeAnomalies({ basketSize = 10, historyDays = 7 } = {}) {
  const basket = await getDynamicBasket(basketSize);

  const results = await Promise.all(
    basket.map(async (t) => {
      const klines = await fetchKlines(t.symbol, "1d", historyDays + 1);
      const pastDays = klines.slice(0, -1); // exclude today's still-forming candle
      const avgRangePct = average(pastDays.map((k) => ((k.high - k.low) / k.close) * 100));
      const todayRangePct = ((t.highPrice - t.lowPrice) / t.lastPrice) * 100;

      return {
        symbol: t.symbol,
        lastPrice: t.lastPrice,
        priceChangePercent: t.priceChangePercent,
        todayRangePct,
        avgRangePct,
        ratio: todayRangePct / avgRangePct,
      };
    })
  );

  return results.filter((r) => Number.isFinite(r.ratio));
}

/** Theme 3 — Breakout Watch: today's range is unusually WIDE vs normal. */
export async function getBreakoutWatch({ basketSize = 10, historyDays = 7, topN = 3 } = {}) {
  const anomalies = await getRangeAnomalies({ basketSize, historyDays });
  return anomalies.sort((a, b) => b.ratio - a.ratio).slice(0, topN);
}

/** Theme 4 — The Quiet Ones: today's range is unusually NARROW vs normal. */
export async function getQuietMovers({ basketSize = 10, historyDays = 7, topN = 3 } = {}) {
  const anomalies = await getRangeAnomalies({ basketSize, historyDays });
  return anomalies.sort((a, b) => a.ratio - b.ratio).slice(0, topN);
}

/**
 * Theme 5 — Relative Strength Check.
 * ETH/BTC pair gives a direct, native ratio-change reading (no manual
 * math needed — Binance lists ETHBTC as its own pair). Combined with how
 * the average alt in the basket did vs BTC itself, this tells a "where's
 * money rotating" story instead of just listing prices.
 */
export async function getRelativeStrength({ basketSize = 20 } = {}) {
  const [ethBtc, basket] = await Promise.all([
    fetchTicker24hr("ETHBTC"),
    getDynamicBasket(basketSize),
  ]);

  const btc = basket.find((t) => t.symbol === "BTCUSDT");
  const alts = basket.filter((t) => t.symbol !== "BTCUSDT");

  return {
    ethBtcPrice: Number(ethBtc.lastPrice),
    ethBtcChangePercent: Number(ethBtc.priceChangePercent),
    btcChangePercent: btc?.priceChangePercent ?? null,
    altsAvgChangePercent: average(alts.map((t) => t.priceChangePercent)),
    basketSize: basket.length,
  };
}

// Standalone test: `node src/sources/market.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const [snapshot, leadersLaggards, breakout, quiet, relativeStrength] = await Promise.all([
    getMarketSnapshot(),
    getLeadersLaggards(),
    getBreakoutWatch(),
    getQuietMovers(),
    getRelativeStrength(),
  ]);
  console.log(JSON.stringify({ snapshot, leadersLaggards, breakout, quiet, relativeStrength }, null, 2));
}
