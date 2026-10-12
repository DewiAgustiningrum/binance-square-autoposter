// src/sources/narrative.mjs
// Theme 9 - Data vs Narrative: set one market-wide headline next to what the
// last 24h of data actually shows. The agreement verdict is computed here in
// code, so the LLM explains it instead of deciding it.

import { fetchHeadlines, newsEnabled } from "./news.mjs";
import { getMarketRegime } from "./market.mjs";

const UP = /\b(?:rall(?:y|ies|ied)|surg(?:e|es|ed|ing)|soar(?:s|ed|ing)?|jump(?:s|ed|ing)?|climb(?:s|ed|ing)?|ris(?:e|es|en|ing)|rebound(?:s|ed|ing)?|gain(?:s|ed|ing)?|record\s+high|all-time\s+high)\b/i;
const DOWN = /\b(?:plung(?:e|es|ed|ing)|tumbl(?:e|es|ed|ing)|slump(?:s|ed|ing)?|drop(?:s|ped|ping)?|fall(?:s|ing)?|fell|slid(?:e|es|ing)|sell-?\s?off|crash(?:es|ed|ing)?|declin(?:e|es|ed|ing)|sink(?:s|ing)?|slip(?:s|ped|ping)?)\b/i;
const MARKET_WIDE = /\b(?:Bitcoin|BTC|Ethereum|ETH|crypto(?:currency|currencies)?|crypto\s+market|market)\b/;

// Contrast, hedging or negation flips or blurs a headline's direction
// ("shrugs off outflows", "fails to rally", "rallies even as ..."), and a
// keyword matcher cannot tell which way it goes: such headlines are not used.
const AMBIGUOUS = /\b(?:shrug(?:s|ged)?|despite|even\s+(?:as|though|if)|but|however|fail(?:s|ed)?|while|though|yet|still|hold(?:s|ing)?|steady|flat|mixed|unchanged|recover(?:s|ed|y)?|no|not|never)\b|n't\b/i;

// Only words close to the market term count: "Bitcoin ... as oil falls" is about
// oil, not about the market. Window: 1 word before to 4 words after the term.
const MARKET_TERM = /^(?:Bitcoin|BTC|Ethereum|ETH|crypto(?:currency|currencies)?|market)$/;
const WINDOW_BEFORE = 1;
const WINDOW_AFTER = 4;

function marketWindow(title) {
  const words = title.split(/\s+/);
  const idx = words.findIndex((w) => MARKET_TERM.test(w.replace(/[^A-Za-z]/g, "")));
  if (idx === -1) return null;
  return words.slice(Math.max(0, idx - WINDOW_BEFORE), idx + WINDOW_AFTER + 1).join(" ");
}

/** "up", "down", or null when the headline gives no single, unambiguous direction about the market. */
export function headlineTone(title) {
  if (AMBIGUOUS.test(title)) return null;
  const near = marketWindow(title);
  if (near === null) return null;
  const up = UP.test(near);
  const down = DOWN.test(near);
  return up === down ? null : up ? "up" : "down";
}

/** Most recent market-wide headline with a single clear direction. */
export function pickNarrativeHeadline(headlines) {
  return (
    [...headlines]
      .sort((a, b) => a.ageHours - b.ageHours)
      .find((h) => MARKET_WIDE.test(h.title) && headlineTone(h.title) !== null) ?? null
  );
}

/** supports / contradicts / mixed, from BTC and the median alt only. */
export function agreement(tone, regime) {
  const { btcChangePercent: btc, altsMedianChangePercent: alts } = regime;
  const sign = tone === "up" ? 1 : -1;
  const b = Math.sign(btc) * sign;
  const a = Math.sign(alts) * sign;
  if (b > 0 && a > 0) return "supports";
  if (b < 0 && a < 0) return "contradicts";
  return "mixed";
}

export function buildNarrative(headline, regime) {
  const tone = headlineTone(headline.title);
  return {
    headline: { source: headline.source, title: headline.title, ageHours: headline.ageHours },
    headlineTone: tone,
    regime,
    agreement: agreement(tone, regime),
  };
}

/** Empty array = "nothing to post today", which generatePost skips cleanly. */
export async function getDataVsNarrative({ fetchImpl = fetchHeadlines, regimeImpl = getMarketRegime } = {}) {
  if (!newsEnabled()) return [];
  let headline;
  try {
    headline = pickNarrativeHeadline(await fetchImpl());
  } catch (err) {
    console.error(`narrative headline skipped: ${err.message}`);
    return [];
  }
  if (!headline) return [];
  const narrative = buildNarrative(headline, await regimeImpl());
  console.log(`narrative: ${headline.source} "${headline.title}" tone=${narrative.headlineTone} agreement=${narrative.agreement}`);
  return narrative;
}
