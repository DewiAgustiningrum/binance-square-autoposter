// src/sources/smart-money.mjs
// Powers Theme 2 (Smart Money Setup).
// Imports the trading-signal skill's Mode 1 (Smart Money Signals) directly —
// pure HTTP call, no `baw` CLI involved.

import { COMMANDS, call } from "../../skills/trading-signal/scripts/cli.mjs";

const DEFAULT_CHAIN_ID = "56"; // BSC by default; use "CT_501" for Solana

/**
 * Fetch recent smart-money buy/sell signals and keep only the fields
 * useful for a short Square post. Filters out stale/low-conviction signals
 * so the LLM isn't fed noise.
 */
export async function getSmartMoneySignals({ chainId = DEFAULT_CHAIN_ID, pageSize = 20 } = {}) {
  const result = await call(COMMANDS["smart-money"]({ chainId, page: 1, pageSize }));

  const signals = (result?.data ?? [])
    .filter((s) => s.status !== "timeout")
    .map((s) => ({
      direction: s.direction,
      triggerPrice: s.alertPrice ?? s.triggerPrice,
      currentPrice: s.currentPrice ?? null,
      maxGain: s.maxGain ?? null,
      exitRate: s.exitRate ?? null,
      smartMoneyCount: s.smartMoneyCount ?? null,
      ticker: s.ticker,
      status: s.status,
    }))
    // higher conviction first
    .sort((a, b) => (b.smartMoneyCount ?? 0) - (a.smartMoneyCount ?? 0));

  return signals.slice(0, 5);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = await getSmartMoneySignals();
  console.log(JSON.stringify(data, null, 2));
}
