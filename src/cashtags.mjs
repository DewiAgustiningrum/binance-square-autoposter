// src/cashtags.mjs
// Single source of truth for what counts as a cashtag in a post.
//
// Supports tickers containing digits ($1INCH, $1000SATS). Price shorthand
// such as $84K or $1B is NOT a cashtag, and neither are plain prices ($84,750).

const CASHTAG_RE = /\$([A-Z0-9]{2,20})(?![A-Za-z0-9])/g;
const PRICE_SHORTHAND_RE = /^\d+[KMBT]$/;

/** Returns the distinct cashtags in `text` as "$TICKER" strings (uppercase). */
export function extractCashtags(text) {
  const found = new Set();
  for (const m of text.matchAll(CASHTAG_RE)) {
    const ticker = m[1];
    if (!/[A-Z]/.test(ticker)) continue; // "$84" style price
    if (PRICE_SHORTHAND_RE.test(ticker)) continue; // "$84K" style price
    found.add(`$${ticker}`);
  }
  return found;
}

/** Text with every cashtag blanked out, so digits inside tickers aren't read as numbers. */
export function stripCashtags(text) {
  const tags = extractCashtags(text);
  let out = text;
  for (const tag of tags) out = out.split(tag).join(" ");
  return out;
}
