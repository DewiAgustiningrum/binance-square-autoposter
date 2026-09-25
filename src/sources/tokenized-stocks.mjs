// src/sources/tokenized-stocks.mjs
// Powers Theme 7 (Tokenized Stocks Corner).
// No CLI script for this skill (docs-only) — manual fetch() per
// skills/binance-tokenized-securities-info/SKILL.md. Public, no key.

const BASE_URL = "https://www.binance.com/bapi/defi";
const HEADERS = {
  "Accept-Encoding": "identity",
  "User-Agent": "binance-web3/1.1 (Skill)",
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Tokenized stocks fetch failed: ${res.status} ${url}`);
  const json = await res.json();
  if (json.code !== "000000" || !json.success) {
    throw new Error(`Tokenized stocks API error: ${JSON.stringify(json)}`);
  }
  return json.data;
}

// API 1 — list of supported Ondo tokenized stocks (type=1 = Ondo)
async function listStockTokens() {
  return fetchJson(
    `${BASE_URL}/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai?type=1`
  );
}

// API 5 — real-time on-chain + underlying stock data for one token
async function getStockDynamic(chainId, contractAddress) {
  return fetchJson(
    `${BASE_URL}/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai?chainId=${chainId}&contractAddress=${contractAddress}`
  );
}

/**
 * Pick a handful of tokenized stocks and pull their live on-chain + stock
 * fundamentals. `count` controls how many tickers get detail-fetched
 * (each is a separate API 5 call, so keep this small).
 */
export async function getTokenizedStocksSnapshot({ count = 3 } = {}) {
  const list = await listStockTokens();
  const picks = list.slice(0, count);

  const details = await Promise.all(
    picks.map((t) => getStockDynamic(t.chainId, t.contractAddress))
  );

  return details.map((d) => {
    const referencePrice =
      Number(d.tokenInfo.price) / Number(d.tokenInfo.sharesMultiplier);

    return {
      ticker: d.ticker,
      tokenSymbol: d.symbol,
      onchainPrice: Number(d.tokenInfo.price),
      referencePrice, // price ÷ sharesMultiplier — comparable to real stock price
      priceChangePct24h: Number(d.tokenInfo.priceChangePct24h) * 100,
      totalHolders: Number(d.tokenInfo.totalHolders),
      marketCap: Number(d.tokenInfo.marketCap),
      stockPriceHigh52w: d.stockInfo.priceHigh52w,
      stockPriceLow52w: d.stockInfo.priceLow52w,
      priceToEarnings: d.stockInfo.priceToEarnings,
      dividendYield: d.stockInfo.dividendYield,
    };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = await getTokenizedStocksSnapshot();
  console.log(JSON.stringify(data, null, 2));
}
