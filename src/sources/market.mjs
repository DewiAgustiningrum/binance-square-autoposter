// src/sources/market.mjs
// Powers Theme 1 (Morning Market Brief) and Theme 8 (Daily Recap).
// Public Binance REST API — no API key required.

const BASE_URL = "https://api.binance.com";
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT"];

async function fetchTicker24hr(symbol) {
  const res = await fetch(`${BASE_URL}/api/v3/ticker/24hr?symbol=${symbol}`);
  if (!res.ok) {
    throw new Error(`Binance ticker fetch failed for ${symbol}: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch 24hr ticker stats for BTC, ETH, BNB.
 * Used identically by both Theme 1 (morning) and Theme 8 (recap) —
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

// Standalone test: `node src/sources/market.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const data = await getMarketSnapshot();
  console.log(JSON.stringify(data, null, 2));
}
