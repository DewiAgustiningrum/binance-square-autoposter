// src/generate.mjs
// Picks a theme, fetches its data, calls the LLM (Groq primary, Gemini fallback),
// returns the generated Square post text.

import { getMarketSnapshot } from "./sources/market.mjs";
import { getSmartMoneySignals } from "./sources/smart-money.mjs";
import { getTrendingTokens, getSmartMoneyInflow } from "./sources/market-rank.mjs";
import { getLaunchRadar, getHotTopics } from "./sources/meme.mjs";
import { getTokenizedStocksSnapshot } from "./sources/tokenized-stocks.mjs";

// ---------------------------------------------------------------------------
// Theme registry — weighted random pick, no state file needed.
// weight roughly reflects how "daily-fresh" the underlying data is.
// ---------------------------------------------------------------------------
const THEMES = [
  { id: "morning-brief", weight: 3, fetch: () => getMarketSnapshot(), label: "Morning Market Brief" },
  { id: "smart-money-setup", weight: 2, fetch: () => getSmartMoneySignals(), label: "Smart Money Setup" },
  { id: "trending-narrative", weight: 2, fetch: () => getTrendingTokens(), label: "Trending Narrative" },
  { id: "smart-money-inflow", weight: 1, fetch: () => getSmartMoneyInflow(), label: "Smart Money Inflow" },
  { id: "meme-launch-radar", weight: 1, fetch: () => getLaunchRadar(), label: "Meme Launch Radar" },
  { id: "hot-topic-rush", weight: 1, fetch: () => getHotTopics(), label: "Hot Topic Rush" },
  { id: "tokenized-stocks", weight: 1, fetch: () => getTokenizedStocksSnapshot(), label: "Tokenized Stocks Corner" },
  { id: "daily-recap", weight: 3, fetch: () => getMarketSnapshot(), label: "Daily Recap" },
];

function pickTheme() {
  const total = THEMES.reduce((sum, t) => sum + t.weight, 0);
  let r = Math.random() * total;
  for (const theme of THEMES) {
    if (r < theme.weight) return theme;
    r -= theme.weight;
  }
  return THEMES[THEMES.length - 1]; // fallback, should not hit
}

// ---------------------------------------------------------------------------
// Shared style rules — anti-"AI-sounding" instructions, cashtag format, etc.
// Appended to every theme's system prompt so they don't have to repeat it.
// ---------------------------------------------------------------------------
const TONE_EXAMPLE = `
Example of the tone to match (casual, like texting a friend an update —
not the topic, just the voice):

"BTC's sitting at $84K after tapping $85.2K then sliding back to $83.1K,
still choppy this week. ETH barely moved, hanging around $2.7K. BNB's
actually the one bleeding, down over half a percent to $775. Nothing
dramatic today, just a quiet grind lower across the board."

Notice: contractions (BTC's, isn't), plain word choices, a personal read
at the end ("nothing dramatic", "quiet grind") instead of a generic hype
phrase, and no clinical listing of every stat with formal transitions.
`.trim();

const STYLE_RULES = `
Style rules (must follow):
- Tone: write like you're texting a trader friend a quick update, not
  filing a market report. Use contractions (it's, didn't, that's, BTC's).
  Casual word choices over formal ones (e.g. "dropped" not "declined",
  "barely moved" not "exhibited minimal movement").
- Skip intros like "Today the market..." — start directly from the point.
- No hedging filler ("might", "could potentially", "it's worth noting").
- No generic adjectives ("significant", "notable", "interesting").
- Vary sentence length — mix short punchy lines with longer ones.
- If mentioning multiple tokens, do NOT repeat the same sentence template
  for each one (e.g. "$X does A on B; C keeps it going" three times in a
  row with different words). Give each token a distinct structure and
  angle — one can be a short fragment, another a longer sentence, another
  can lead with the number instead of the ticker.
- Cut generic narrative filler at the end of clauses — phrases like "fuels
  the surge", "keeps momentum alive", "steady hands push it forward",
  "traders snapping up every dip". State the number and stop; don't editorialize
  around it with stock trading-blog phrasing.
- Never use an em dash (—) anywhere in the post, under any circumstance.
  Use a period, comma, or semicolon instead.
- Reference coin/token tickers using cashtag format (e.g. $BTC, $ETH, $BNB) —
  never write the coin name without the $ prefix. This is required for
  Binance Square's chart auto-detection.
- Use AT MOST 3 different cashtags in the whole post. Square rejects posts
  referencing more than 3 coins. Pick the 3 most relevant and mention any
  others (if truly necessary) by plain name without the $ prefix.
- Use only the data provided below. Do not invent numbers. Do not give
  financial advice or tell people to buy/sell.
- No em dashes, no bullet points in the post body.
- Return ONLY the final post text, nothing else.

${TONE_EXAMPLE}
`.trim();

const THEME_PROMPTS = {
  "morning-brief": (data) => `
You are a Binance Square crypto analyst. Write a short morning market brief
using ONLY this data:
${JSON.stringify(data, null, 2)}

Cover overnight price action for BTC, ETH, BNB — what changed, what's worth
watching today. Keep it under 500 characters.
${STYLE_RULES}`,

  "smart-money-setup": (data) => `
You are a Binance Square crypto analyst. Write a post about recent smart-money
on-chain signals using ONLY this data:
${JSON.stringify(data, null, 2)}

Mention direction (buy/sell), notable trigger vs current price, and smart
money conviction count. Frame it as "worth watching", not a signal to act on.
Keep it under 500 characters.
${STYLE_RULES}`,

  "trending-narrative": (data) => `
You are a Binance Square crypto analyst. Write a post about which tokens are
trending right now using ONLY this data:
${JSON.stringify(data, null, 2)}

Pick 2-3 standouts and say what's driving attention (volume, holders growth,
price action). Keep it under 500 characters.
${STYLE_RULES}`,

  "smart-money-inflow": (data) => `
You are a Binance Square crypto analyst. Write a post about which tokens are
seeing the biggest smart-money net inflow using ONLY this data:
${JSON.stringify(data, null, 2)}

Highlight the top 2-3 by inflow, and mention trader count as a conviction
signal. Keep it under 500 characters.
${STYLE_RULES}`,

  "meme-launch-radar": (data) => `
You are a Binance Square crypto analyst covering the meme/launchpad scene.
Write a post about tokens close to finalizing/migrating using ONLY this data:
${JSON.stringify(data, null, 2)}

Mention bonding curve progress and liquidity for 2-3 tokens. Keep the tone
observational, not hype-y. Keep it under 500 characters.
${STYLE_RULES}`,

  "hot-topic-rush": (data) => `
You are a Binance Square crypto analyst. Write a post about the hottest
market narrative right now using ONLY this data:
${JSON.stringify(data, null, 2)}

Explain the narrative in your own words (use the AI summary as grounding,
don't quote it verbatim) and mention 1-2 associated tokens. Keep it under
500 characters.
${STYLE_RULES}`,

  "tokenized-stocks": (data) => `
You are a Binance Square crypto analyst covering tokenized equities. Write a
post about on-chain tokenized stocks using ONLY this data:
${JSON.stringify(data, null, 2)}

Compare on-chain price movement to the underlying stock fundamentals (P/E,
dividend yield, 52-week range) for 1-2 tickers. Keep it under 500 characters.
${STYLE_RULES}`,

  "daily-recap": (data) => `
You are a Binance Square crypto analyst. Write a closing daily recap using
ONLY this data:
${JSON.stringify(data, null, 2)}

Summarize what happened today for BTC/ETH/BNB and give one thing worth
watching tomorrow. Keep it under 500 characters.
${STYLE_RULES}`,
};

// ---------------------------------------------------------------------------
// LLM calls — Groq primary, Gemini fallback.
// ---------------------------------------------------------------------------
async function callGroq(prompt) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: prompt }],
      // gpt-oss-120b always reasons — it can't be turned off — and
      // reasoning tokens share the same max_tokens budget as the final
      // answer. reasoning_effort:"low" keeps more of that budget free
      // for the actual post instead of internal chain-of-thought.
      reasoning_effort: "low",
      // Real headroom beyond the ~500-char post itself, since reasoning
      // still eats into this even at "low" effort.
      max_tokens: 2000,
      temperature: 0.9,
    }),
  });

  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const choice = json.choices?.[0];
  const content = choice?.message?.content?.trim();

  if (choice?.finish_reason === "length") {
    // Hit max_tokens before finishing — content (if any) is truncated
    // mid-sentence. Treat as a failure rather than publishing a cut-off
    // post; let the caller fall back to Gemini instead.
    console.error("Groq output truncated (finish_reason=length). Raw response:", JSON.stringify(json));
    throw new Error("Groq output truncated (hit max_tokens)");
  }

  if (!content) {
    // Log the raw response once so a future empty-output case is debuggable
    // instead of silently falling through with nothing to show for it.
    console.error("Groq returned no content. Raw response:", JSON.stringify(json));
    throw new Error("Groq returned empty content");
  }

  return content;
}

async function callGemini(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1200, temperature: 0.9 },
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const candidate = json.candidates?.[0];
  const content = candidate?.content?.parts?.[0]?.text?.trim();

  if (candidate?.finishReason === "MAX_TOKENS") {
    console.error("Gemini output truncated (finishReason=MAX_TOKENS). Raw response:", JSON.stringify(json));
    throw new Error("Gemini output truncated (hit maxOutputTokens)");
  }

  if (!content) {
    console.error("Gemini returned no content. Raw response:", JSON.stringify(json));
    throw new Error("Gemini returned empty content");
  }

  return content;
}

async function callLLM(prompt) {
  try {
    return await callGroq(prompt);
  } catch (err) {
    console.error(`Groq failed, falling back to Gemini: ${err.message}`);
    return await callGemini(prompt);
  }
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------
export async function generatePost() {
  const theme = pickTheme();
  const data = await theme.fetch();
  const prompt = THEME_PROMPTS[theme.id](data);
  const text = await callLLM(prompt);

  return { theme: theme.id, themeLabel: theme.label, text, rawData: data };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await generatePost();
  console.log(JSON.stringify(result, null, 2));
}
