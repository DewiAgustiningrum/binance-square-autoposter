import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { getDynamicBasket } from "../src/sources/market.mjs";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("all-tickers response that is not an array is rejected, not iterated", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ code: -1003, msg: "rate limited" }), { status: 200 });
  await assert.rejects(getDynamicBasket(5), /unexpected response shape/);
});

test("digit-prefixed tickers survive into the basket with a usable cashtag", async () => {
  const t = (symbol, qv) => ({ symbol, lastPrice: "2", highPrice: "3", lowPrice: "1", priceChangePercent: "1", quoteVolume: String(qv) });
  globalThis.fetch = async () => new Response(JSON.stringify([t("1000SATSUSDT", 5e9), t("BTCUSDT", 9e9)]), { status: 200 });
  const basket = await getDynamicBasket(5);
  assert.deepEqual(basket.map((b) => b.cashtag), ["$BTC", "$1000SATS"]);
});
