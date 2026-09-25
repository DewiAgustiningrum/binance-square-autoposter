// src/sources/market-rank.mjs
// Powers Theme 3 (Trending Narrative) and Theme 4 (Smart Money Inflow).
// Imports crypto-market-rank skill directly (no baw, no key).

import { COMMANDS, call } from "../../skills/crypto-market-rank/scripts/cli.mjs";

const DEFAULT_CHAIN_ID = "56"; // BSC by default

/**
 * Theme 3 — Trending Narrative.
 * rankType 10 = Trending (the default board people mean by "trending").
 */
export async function getTrendingTokens({ chainId = DEFAULT_CHAIN_ID, size = 10 } = {}) {
  const result = await call(
    COMMANDS["token-rank"]({ rankType: 10, chainId, page: 1, size })
  );

  return (result?.data?.tokens ?? []).slice(0, size).map((t) => ({
    symbol: t.symbol,
    price: Number(t.price),
    marketCap: Number(t.marketCap),
    percentChange24h: Number(t.percentChange24h),
    volume24h: Number(t.volume24h ?? t["volume24h"]),
    holders: Number(t.holders),
  }));
}

/**
 * Theme 4 — Smart Money Inflow.
 * Ranked by net inflow, not by price movement — deliberately a different
 * lens than Theme 3 so the two don't read as the same post reworded.
 */
export async function getSmartMoneyInflow({ chainId = DEFAULT_CHAIN_ID, period = "24h" } = {}) {
  const result = await call(COMMANDS["smart-money-inflow"]({ chainId, period }));

  return (result?.data ?? []).slice(0, 10).map((t) => ({
    tokenName: t.tokenName,
    price: Number(t.price),
    marketCap: Number(t.marketCap),
    priceChangeRate: Number(t.priceChangeRate),
    inflow: t.inflow, // already numeric per docs
    traders: t.traders,
    tokenRiskLevel: t.tokenRiskLevel,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [trending, inflow] = await Promise.all([
    getTrendingTokens(),
    getSmartMoneyInflow(),
  ]);
  console.log(JSON.stringify({ trending, inflow }, null, 2));
}
