import test from "node:test";
import assert from "node:assert/strict";
import { headlineTone, pickNarrativeHeadline, agreement, buildNarrative, getDataVsNarrative } from "../src/sources/narrative.mjs";
import { checkSemantics } from "../src/semantic.mjs";
import { factsPromptBlock } from "../src/facts.mjs";
import { selectTheme } from "../src/generate.mjs";
import { validatePost } from "../src/validate.mjs";
import { useTempHistory } from "./helpers.mjs";

const H = (title, ageHours = 2, source = "CoinDesk") => ({ source, title, ageHours });
const REGIME = { btcChangePercent: -0.56, altsMedianChangePercent: -2.95, altsCount: 19, breadthUpPct: 16, breadthDownPct: 84, medianRangePct: 12.14, direction: "broad-down", leadership: "btc-ahead" };

test("headlineTone: single direction only", () => {
  assert.equal(headlineTone("Bitcoin rallies toward a new record high"), "up");
  assert.equal(headlineTone("Crypto market slumps as traders sell off"), "down");
  assert.equal(headlineTone("Bitcoin rallies then slumps in volatile session"), null); // both
  assert.equal(headlineTone("Bitcoin ETF issuer files updated paperwork"), null); // neither
});

test("pickNarrativeHeadline: freshest market-wide headline with a clear tone", () => {
  const hs = [H("Some small token surges after exchange listing today", 1), H("Bitcoin slides as the crypto market turns risk averse", 5), H("Ethereum jumps as network upgrade nears", 3)];
  assert.equal(pickNarrativeHeadline(hs).title, "Ethereum jumps as network upgrade nears");
  assert.equal(pickNarrativeHeadline([H("Exchange adds new staking product for users", 1)]), null);
});

test("agreement is computed from BTC and the median alt", () => {
  assert.equal(agreement("down", REGIME), "supports");
  assert.equal(agreement("up", REGIME), "contradicts");
  assert.equal(agreement("up", { btcChangePercent: 0.7, altsMedianChangePercent: -2 }), "mixed");
});

test("getDataVsNarrative returns [] when news is off, when feeds fail, or when no headline fits", async () => {
  delete process.env.NEWS_CONTEXT;
  assert.deepEqual(await getDataVsNarrative({ fetchImpl: async () => [H("Bitcoin surges to a new high today", 1)], regimeImpl: async () => REGIME }), []);
  process.env.NEWS_CONTEXT = "on";
  const log = console.error; console.error = () => {};
  try {
    assert.deepEqual(await getDataVsNarrative({ fetchImpl: async () => { throw new Error("x"); }, regimeImpl: async () => REGIME }), []);
    assert.deepEqual(await getDataVsNarrative({ fetchImpl: async () => [H("Exchange adds new staking product", 1)], regimeImpl: async () => REGIME }), []);
    const ok = await getDataVsNarrative({ fetchImpl: async () => [H("Bitcoin slides as crypto market turns cautious", 2)], regimeImpl: async () => REGIME });
    assert.equal(ok.agreement, "supports");
    assert.equal(ok.headline.source, "CoinDesk");
  } finally { delete process.env.NEWS_CONTEXT; console.error = log; }
});

test("the theme only takes part in selection when NEWS_CONTEXT=on", () => {
  const pick = () => selectTheme([], new Date("2026-10-10T06:00:00Z"), () => 0.999);
  delete process.env.NEWS_CONTEXT;
  for (let i = 0; i < 20; i++) assert.notEqual(selectTheme([], new Date(), () => i / 20).id, "data-vs-narrative");
  process.env.NEWS_CONTEXT = "on";
  try {
    const ids = new Set(Array.from({ length: 40 }, (_, i) => selectTheme([], new Date("2026-10-10T06:00:00Z"), () => i / 40).id));
    assert.ok(ids.has("data-vs-narrative"));
    assert.ok(pick());
  } finally { delete process.env.NEWS_CONTEXT; }
});

const DATA = buildNarrative(H("Crypto market slumps as traders sell off"), REGIME);

test("semantic: verdict claims must match the computed agreement", () => {
  assert.equal(DATA.agreement, "supports");
  const right = "CoinDesk reported a crypto slump, and the data backs it up: $BTC fell 0.56% and the median alt fell 2.95%.";
  assert.equal(checkSemantics(right, "data-vs-narrative", DATA).ok, true);
  const wrong = "CoinDesk reported a crypto slump, but the data contradicts it: $BTC fell 0.56%.";
  const r = checkSemantics(wrong, "data-vs-narrative", DATA);
  assert.equal(r.ok, false);
  assert.match(r.reason, /contradicts the headline/);
  const mixed = buildNarrative(H("Bitcoin rallies as crypto market recovers"), { ...REGIME, btcChangePercent: 0.4 });
  assert.equal(mixed.agreement, "mixed");
  assert.equal(checkSemantics("The numbers support the headline: $BTC rose 0.4%.", "data-vs-narrative", mixed).ok, false);
});

test("prompt block states the verdict in plain words", () => {
  const block = factsPromptBlock("data-vs-narrative", DATA);
  assert.match(block, /verdict: the 24h data SUPPORTS/);
  assert.match(block, /a broad decline \(16% of alts are up\)/);
});

test("end to end through validatePost: attributed, grounded, no link", async () => {
  await useTempHistory();
  const news = { byToken: { market: [DATA.headline] } };
  const text = "CoinDesk reported that the crypto market slumped, and the 24h data backs it up. $BTC slipped 0.56% while the median alt fell 2.95%, with only 16% of the 19 alts finished green.";
  assert.deepEqual(await validatePost(text, "data-vs-narrative", DATA, { news }), { valid: true });
  const link = text + " Source: coindesk.com";
  assert.equal((await validatePost(link, "data-vs-narrative", DATA, { news })).valid, false);
});

// Published 12 Oct post: the headline's direction was misread, and the "quote" was not the headline.
test("headlineTone: contrast, hedging and negation make a headline unusable", () => {
  for (const t of [
    "Bitcoin shrugs off ETF outflows and slips below $84K",
    "Bitcoin fails to rally despite ETF inflows",
    "Bitcoin rallies even as ETF outflows continue",
    "Bitcoin holds gains but traders stay cautious",
    "Ethereum doesn't drop after the upgrade",
  ]) assert.equal(headlineTone(t), null, t);
  assert.equal(headlineTone("Bitcoin rallies toward a new record high"), "up");
});

test("narrative verdict must be stated in plain words and match the computed agreement", () => {
  const supports = buildNarrative(H("Crypto market slumps as traders sell off"), REGIME); // supports
  const loose = "CoinDesk reported a crypto slump. $BTC fell 0.56%, the median alt fell 2.95%. The data moves opposite the headline's vibe.";
  const r = checkSemantics(loose, "data-vs-narrative", supports);
  assert.equal(r.ok, false);
  assert.match(r.reason, /contradicts the headline/);
  const vague = "CoinDesk reported a crypto slump. $BTC fell 0.56%, the median alt fell 2.95%, and 84% of alts are down.";
  const v = checkSemantics(vague, "data-vs-narrative", supports);
  assert.equal(v.ok, false);
  assert.match(v.reason, /does not state the verdict/);
  const good = "CoinDesk reported a crypto slump, and the data supports it: $BTC fell 0.56% and the median alt fell 2.95%.";
  assert.equal(checkSemantics(good, "data-vs-narrative", supports).ok, true);
});

// The headline of the published 12 Oct post (from meta.headlines): "falls" was about oil, not Bitcoin.
test("headlineTone only counts direction words near the market term (real 12 Oct headline)", () => {
  assert.equal(headlineTone("Bitcoin shrugs off ETF outflows to trade above $84,000 as oil falls"), null); // contrast word
  assert.equal(headlineTone("Bitcoin trades above $84,000 as oil falls"), null); // 'falls' is far from, and about, something else
  assert.equal(headlineTone("Oil falls as Bitcoin climbs toward $85,000"), null); // both directions: too easy to attach to the wrong subject
  assert.equal(headlineTone("Bitcoin slides below $80,000 as traders sell off"), "down");
  assert.equal(headlineTone("Oil prices climb while the ETF filing is delayed"), null); // no market term
});

test("the real published draft would now be rejected on two counts (fake quote, loose verdict)", async () => {
  const { checkNews } = await import("../src/news-guard.mjs");
  const title = "Bitcoin shrugs off ETF outflows to trade above $84,000 as oil falls";
  const text = "CoinDesk reported \"Bitcoin shrugs off ETF outflows, trades above $84K.\"\n\n$BTC rose 1.19% in the last 24 h, while the median alt jumped 4.78%.\n\n19 alts tracked: 95% up, 5% down, so most tokens outperformed BTC.\n\nThe data moves opposite the headline's vibe.";
  assert.equal(checkNews(text, { byToken: { market: [{ source: "CoinDesk", title, ageHours: 1.1 }] } }).ok, false);
  assert.equal(headlineTone(title), null); // so this headline would never have been chosen
});

// 13 Oct run: "Strive reports $208M in warrant exercises as Bitcoin holdings jump 11%" was read as a rising market.
test("headlineTone: 'Bitcoin holdings/miners/ETF inflows jump' is not the price going up", () => {
  assert.equal(headlineTone("Strive reports $208M in warrant exercises as Bitcoin holdings jump 11%"), null);
  assert.equal(headlineTone("Bitcoin miners jump after hashrate record"), null);
  assert.equal(headlineTone("Bitcoin ETF inflows climb for a third day"), null);
  assert.equal(headlineTone("Bitcoin treasury firm adds 500 BTC as holdings rise"), null);
});

test("headlineTone: the market itself moving is still read", () => {
  assert.equal(headlineTone("Bitcoin rallies toward a new record high"), "up");
  assert.equal(headlineTone("Bitcoin price drops below $80,000"), "down");
  assert.equal(headlineTone("Crypto market slumps as traders sell off"), "down");
  assert.equal(headlineTone("Ethereum jumps as network upgrade nears"), "up");
  assert.equal(headlineTone("BTC falls sharply after weak data"), "down");
});
