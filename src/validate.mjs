// src/validate.mjs
// Validates LLM-generated text before it's allowed anywhere near publish.mjs.
// Square's exact character cap isn't documented in the skill (only error
// code 20013 "Content length is limited") — MAX_LENGTH below is a safety
// margin under the ~500 chars we told the LLM to target, not a confirmed
// Binance limit. Tighten/loosen after a few real test posts.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const MAX_LENGTH = 560; // hard cap; prompts target 500, this catches overshoot
const MIN_LENGTH = 40; // catches empty/near-empty LLM output
// Square rejects posts with too many distinct cashtags (error 220095,
// undocumented in the skill — discovered via a real failed post referencing
// $BTC/$ETH/$BNB/$USDT). 3 is confirmed safe; not confirmed as the exact
// ceiling, so treat this as a conservative cap, not a verified max.
const MAX_CASHTAGS = 3;
const HISTORY_PATH = path.resolve("data/posts.json");
const HISTORY_KEEP = 30; // how many past posts to compare against for duplicates
const DUPLICATE_SIMILARITY_THRESHOLD = 0.6; // word-overlap ratio

// Phrases that indicate the LLM broke character (refusals, meta-commentary,
// disclaimers) instead of returning a clean post.
const BREAK_CHARACTER_PATTERNS = [
  /as an ai/i,
  /i cannot/i,
  /i'm unable to/i,
  /language model/i,
  /^note:/im,
  /^disclaimer:/im,
  /here('s| is) (a|the) post/i, // LLM prefacing instead of just returning the post
];

function normalizeForComparison(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s$]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function wordOverlapRatio(a, b) {
  const setA = new Set(normalizeForComparison(a));
  const setB = new Set(normalizeForComparison(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared++;
  return shared / Math.min(setA.size, setB.size);
}

async function loadHistory() {
  try {
    const raw = await readFile(HISTORY_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return []; // file doesn't exist yet — first run
  }
}

async function saveHistory(history) {
  await mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2));
}

/**
 * Validate generated text. Returns { valid: true } or
 * { valid: false, reason: string } — never throws, so the caller can log
 * and skip a run cleanly instead of crashing the workflow.
 */
export async function validatePost(text, theme) {
  if (!text || typeof text !== "string") {
    return { valid: false, reason: "Empty or non-string output from LLM" };
  }

  const trimmed = text.trim();

  if (trimmed.length < MIN_LENGTH) {
    return { valid: false, reason: `Too short (${trimmed.length} chars)` };
  }

  if (trimmed.length > MAX_LENGTH) {
    return { valid: false, reason: `Too long (${trimmed.length} chars, max ${MAX_LENGTH})` };
  }

  for (const pattern of BREAK_CHARACTER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason: `Broke character, matched pattern: ${pattern}` };
    }
  }

  // Em dash is explicitly forbidden in the prompt but the LLM has ignored
  // it in a real published post — enforce it here instead of trusting it.
  if (/—/.test(trimmed)) {
    return { valid: false, reason: "Contains em dash (—), forbidden by style rules" };
  }

  // Cashtag check: any theme discussing tokens should reference at least
  // one $TICKER — catches the LLM writing "Bitcoin" instead of "$BTC", or
  // a downstream step accidentally stripping the $ prefix.
  const cashtagThemes = [
    "morning-brief",
    "smart-money-setup",
    "trending-narrative",
    "smart-money-inflow",
    "meme-launch-radar",
    "hot-topic-rush",
    "tokenized-stocks",
    "daily-recap",
  ];
  const cashtags = new Set((trimmed.match(/\$[A-Z]{2,10}\b/g) ?? []).map((t) => t.toUpperCase()));

  if (cashtagThemes.includes(theme) && cashtags.size === 0) {
    return { valid: false, reason: "No $CASHTAG found in output" };
  }

  if (cashtags.size > MAX_CASHTAGS) {
    return {
      valid: false,
      reason: `Too many cashtags (${cashtags.size}: ${[...cashtags].join(", ")}), Square rejects over ${MAX_CASHTAGS}`,
    };
  }

  const history = await loadHistory();
  for (const past of history) {
    const similarity = wordOverlapRatio(trimmed, past.text);
    if (similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
      return {
        valid: false,
        reason: `Too similar (${Math.round(similarity * 100)}%) to a post from ${past.date}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Record a successfully published post so future runs can duplicate-check
 * against it. Call this AFTER a real publish succeeds, not before.
 */
export async function recordPost({ theme, text, postId, shareLink }) {
  const history = await loadHistory();
  history.unshift({
    date: new Date().toISOString(),
    theme,
    text,
    postId: postId ?? null,
    shareLink: shareLink ?? null,
  });
  await saveHistory(history.slice(0, HISTORY_KEEP));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sample = process.argv[2] ?? "test $BTC post under length";
  const result = await validatePost(sample, "morning-brief");
  console.log(JSON.stringify(result, null, 2));
}
