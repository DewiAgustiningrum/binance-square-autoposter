import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { getBreakoutWatch, getQuietMovers, getRelativeStrength } from "../src/sources/market.mjs";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// Ticker with a chosen 24h range %, price 100 (so range% = high - low).
const tick = (symbol, rangePct, qv, change = 1) => ({
  symbol, lastPrice: "100", highPrice: String(100 + rangePct / 2), lowPrice: String(100 - rangePct / 2),
  priceChangePercent: String(change), quoteVolume: String(qv),
});
// 1d klines: `pastDays` full days of `avgRange`% plus today's forming candle (dropped by the code).
const klines = (pastDays, avgRange) => [
  ...Array.from({ length: pastDays }, (_, i) => [i, "100", String(100 + avgRange / 2), String(100 - avgRange / 2), "100", "1"]),
  [99, "100", "101", "99", "100", "1"],
];

function mock({ tickers, kl = {}, failKlines = [] }) {
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/klines")) {
      const s = u.searchParams.get("symbol");
      if (failKlines.includes(s)) return new Response("err", { status: 500 });
      return new Response(JSON.stringify(kl[s] ?? klines(7, 5)));
    }
    if (u.pathname.endsWith("/ticker/24hr") && !u.searchParams.get("symbol")) return new Response(JSON.stringify(tickers));
    if (u.searchParams.get("symbol") === "ETHBTC") return new Response(JSON.stringify({ lastPrice: "0.03", priceChangePercent: "-1.2" }));
    throw new Error("unexpected " + u);
  };
}

test("breakout-watch keeps only genuinely wide ranges (ratio >= 1.3), widest first", async () => {
  mock({ tickers: [tick("AAAUSDT", 10, 9e9), tick("BBBUSDT", 5, 8e9), tick("CCCUSDT", 6.75, 7e9)] }); // ratios 2.0, 1.0, 1.35 vs avg 5
  const r = await getBreakoutWatch({ basketSize: 10 });
  assert.deepEqual(r.map((x) => x.cashtag), ["$AAA", "$CCC"]);
});

test("quiet-movers keeps only genuinely narrow ranges (ratio <= 0.8), quietest first", async () => {
  mock({ tickers: [tick("AAAUSDT", 2.5, 9e9), tick("BBBUSDT", 4.5, 8e9), tick("CCCUSDT", 3.5, 7e9)] }); // ratios 0.5, 0.9, 0.7
  const r = await getQuietMovers({ basketSize: 10 });
  assert.deepEqual(r.map((x) => x.cashtag), ["$AAA", "$CCC"]);
});

test("nothing anomalous -> empty list (generate.mjs turns that into a retry with another theme)", async () => {
  mock({ tickers: [tick("AAAUSDT", 5, 9e9), tick("BBBUSDT", 5.2, 8e9)] });
  assert.deepEqual(await getBreakoutWatch({ basketSize: 10 }), []);
  assert.deepEqual(await getQuietMovers({ basketSize: 10 }), []);
});

test("a fresh listing without enough history is excluded, not ranked on noise", async () => {
  mock({
    tickers: [tick("NEWUSDT", 20, 9e9), tick("OLDUSDT", 10, 8e9)],
    kl: { NEWUSDT: klines(2, 5) }, // only 2 full past days
  });
  const r = await getBreakoutWatch({ basketSize: 10 });
  assert.deepEqual(r.map((x) => x.cashtag), ["$OLD"]);
});

test("one failing klines request doesn't sink the whole theme", async () => {
  mock({ tickers: [tick("AAAUSDT", 10, 9e9), tick("BBBUSDT", 10, 8e9)], failKlines: ["BBBUSDT"] });
  const r = await getBreakoutWatch({ basketSize: 10 });
  assert.deepEqual(r.map((x) => x.cashtag), ["$AAA"]);
});

test("relative-strength uses the median alt, so one outlier can't fake a trend", async () => {
  mock({ tickers: [tick("BTCUSDT", 3, 9e9, 2), tick("AAAUSDT", 3, 8e9, 1), tick("BBBUSDT", 3, 7e9, 1), tick("CCCUSDT", 3, 6e9, 1), tick("DDDUSDT", 3, 5e9, 89)] });
  const r = await getRelativeStrength({ basketSize: 20 });
  assert.equal(r.altsMedianChangePercent, 1); // a mean would say 23
  assert.equal(r.altsCount, 4);
  assert.equal(r.btcChangePercent, 2);
  assert.equal("basketSize" in r, false);
});
