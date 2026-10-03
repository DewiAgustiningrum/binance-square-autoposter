import test from "node:test";
import assert from "node:assert/strict";
import { extractCashtags } from "../src/cashtags.mjs";

test("plain tickers", () => {
  assert.deepEqual([...extractCashtags("$BTC and $ETH's move")].sort(), ["$BTC", "$ETH"]);
});

test("tickers with digits are recognised", () => {
  assert.deepEqual([...extractCashtags("$1INCH and $1000SATS")].sort(), ["$1000SATS", "$1INCH"]);
});

test("prices and price shorthand are not cashtags", () => {
  assert.equal(extractCashtags("BTC at $84,750 or $84K, vol $1.4B, $2.7K").size, 0);
});

test("lowercase and glued trailing letters are not cashtags", () => {
  assert.equal(extractCashtags("$btc moved").size, 0);
});
