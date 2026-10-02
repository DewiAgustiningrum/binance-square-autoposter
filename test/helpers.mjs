import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Points HISTORY_PATH at a fresh temp file and returns helpers for it. */
export async function useTempHistory(initial) {
  const dir = await mkdtemp(path.join(tmpdir(), "autoposter-test-"));
  const file = path.join(dir, "posts.json");
  process.env.HISTORY_PATH = file;
  if (initial !== undefined) {
    await writeFile(file, typeof initial === "string" ? initial : JSON.stringify(initial));
  }
  return { dir, file, read: async () => JSON.parse(await readFile(file, "utf-8")) };
}

// Source data modelled on a real daily-recap post (BTC/ETH/BNB 24h tickers).
export const RECAP_DATA = [
  { symbol: "BTCUSDT", cashtag: "$BTC", lastPrice: 84750, priceChangePercent: 1.211, highPrice: 85273.65, lowPrice: 83186, volume: 16923.4, quoteVolume: 1.42e9 },
  { symbol: "ETHUSDT", cashtag: "$ETH", lastPrice: 2701.53, priceChangePercent: 0.6, highPrice: 2722, lowPrice: 2673.13, volume: 264705.2, quoteVolume: 7.128e8 },
  { symbol: "BNBUSDT", cashtag: "$BNB", lastPrice: 771.29, priceChangePercent: 0.507, highPrice: 774.48, lowPrice: 763.02, volume: 94096.1, quoteVolume: 7.236e7 },
];

export const GOOD_RECAP =
  "$BTC closed at $84,750, up 1.211 % on the day. It hit a high of $85,273.65 before slipping to a low of $83,186, trading about 16,923 BTC with $1.42 B in USDT volume.\n\n" +
  "$ETH nudged higher, finishing at $2,701.53 (+0.6 %). The pair bounced between $2,673.13 and $2,722, moving roughly 264,705 ETH and $712.8 M in USDT volume.\n\n" +
  "$BNB ticked up to $771.29 (+0.507 %). Its range was tight, $763.02 low, $774.48 high.";
