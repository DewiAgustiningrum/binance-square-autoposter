// src/sources/tokenized-stocks.mjs
// Powers Theme 6 (Tokenized Stocks Corner).
//
// Rewritten to use data-api.binance.vision instead of www.binance.com/bapi/defi
// (the old binance-tokenized-securities-info skill's endpoint). bStocks —
// Binance's tokenized US equities (NVDAB, TSLAB, CRCLB, etc.) — trade as
// regular SPOT pairs, so they're readable through the exact same public
// ticker endpoint as BTC/ETH/BNB. No special headers, no separate domain,
// no geo-block risk (www.binance.com wasn't confirmed safe from GitHub
// Actions the way data-api.binance.vision is).
//
// Trade-off: this drops the underlying-stock fundamentals (P/E, dividend
// yield, 52-week range) that the old RWA endpoint provided — spot ticker
// data doesn't include those. The theme's angle shifts accordingly: instead
// of "on-chain price vs stock fundamentals", it's now "equities trading
// 24/7 alongside crypto, including outside normal market hours" — which is
// arguably the more interesting story anyway.

const BASE_URL = "https://data-api.binance.vision";

// Known bStocks USDT pairs as of the product's rollout. This list is NOT
// guaranteed exhaustive or current — Binance has been adding new bStocks
// regularly (5 at launch, 46+ within two months). Update this list
// periodically by checking Binance's bStocks announcement page. A symbol
// that gets delisted or renamed will just fail its own fetch (caught and
// skipped below) rather than breaking the whole theme.
const BSTOCK_SYMBOLS = [
  "NVDABUSDT", // Nvidia
  "TSLABUSDT", // Tesla
  "CRCLBUSDT", // Circle
  "MUBUSDT", // Micron
  "SNDKBUSDT", // Sandisk
  "CBRSBUSDT", // Cerebras
  "SPYBUSDT", // S&P 500 ETF exposure
];

async function fetchTicker24hr(symbol) {
  const res = await fetch(`${BASE_URL}/api/v3/ticker/24hr?symbol=${symbol}`);
  if (!res.ok) {
    throw new Error(`bStock ticker fetch failed for ${symbol}: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch live data for a handful of bStocks. Picks a random subset each run
 * (rather than always the same ones) so the theme doesn't always talk
 * about the same 2-3 tickers. Symbols that fail to fetch (delisted,
 * renamed, typo in BSTOCK_SYMBOLS) are silently skipped, not fatal.
 */
export async function getTokenizedStocksSnapshot({ count = 3 } = {}) {
  const shuffled = [...BSTOCK_SYMBOLS].sort(() => Math.random() - 0.5);
  const picks = shuffled.slice(0, count);

  const results = await Promise.allSettled(picks.map(fetchTicker24hr));

  return results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value)
    .map((t) => ({
      symbol: t.symbol,
      lastPrice: Number(t.lastPrice),
      priceChangePercent: Number(t.priceChangePercent),
      highPrice: Number(t.highPrice),
      lowPrice: Number(t.lowPrice),
      volume: Number(t.volume),
      quoteVolume: Number(t.quoteVolume),
    }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = await getTokenizedStocksSnapshot();
  console.log(JSON.stringify(data, null, 2));
}
