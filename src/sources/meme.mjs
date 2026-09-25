// src/sources/meme.mjs
// Powers Theme 5 (Meme Launch Radar) and Theme 6 (Hot Topic Rush).
// Imports meme-rush skill directly (no baw, no key).

import { COMMANDS, call } from "../../skills/meme-rush/scripts/cli.mjs";

const DEFAULT_CHAIN_ID = "56"; // BSC by default

/**
 * Theme 5 — Meme Launch Radar.
 * rankType 20 = Finalizing (about to migrate) — more "watch this" energy
 * than rankType 10 (New), which is too early/noisy for a public post.
 */
export async function getLaunchRadar({ chainId = DEFAULT_CHAIN_ID, limit = 10 } = {}) {
  const result = await call(
    COMMANDS["meme-rush"]({ chainId, rankType: 20, limit })
  );

  return (result?.data ?? []).slice(0, limit).map((t) => ({
    symbol: t.symbol,
    price: Number(t.price),
    marketCap: Number(t.marketCap),
    liquidity: Number(t.liquidity),
    progress: t.progress, // pre-formatted %, append "%" directly
    holders: t.holders,
    protocol: t.protocol,
  }));
}

/**
 * Theme 6 — Hot Topic Rush.
 * rankType 10 = Latest, sort 10 = create time (per skill docs, this is
 * the default convention when no explicit preference is given).
 */
export async function getHotTopics({ chainId = DEFAULT_CHAIN_ID, limit = 3 } = {}) {
  const result = await call(
    COMMANDS["topic-rush"]({ chainId, rankType: 10, sort: 10, asc: false })
  );

  return (result?.data ?? []).slice(0, limit).map((topic) => ({
    name: topic.name?.topicNameEn,
    type: topic.type,
    aiSummary: topic.aiSummary?.aiSummaryEn,
    netInflow: topic.topicNetInflow,
    netInflow1h: topic.topicNetInflow1h,
    tokenCount: topic.tokenSize,
    tags: topic.topicTags,
    topTokens: (topic.tokenList ?? []).slice(0, 3).map((t) => ({
      symbol: t.symbol,
      marketCap: Number(t.marketCap),
      priceChange24h: t.priceChange24h,
      netInflow: t.netInflow,
    })),
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [radar, topics] = await Promise.all([getLaunchRadar(), getHotTopics()]);
  console.log(JSON.stringify({ radar, topics }, null, 2));
}
