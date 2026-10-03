// src/http.mjs
// Shared fetch wrapper: every outbound call gets a hard timeout so a hung
// connection can never stall the whole workflow run.

export const TIMEOUTS = {
  binance: 15_000, // public market data
  llm: 60_000, // Groq / Gemini (reasoning model can be slow)
};

// Strip the query string so a URL can be logged without leaking credentials.
function safeUrl(url) {
  try {
    const u = new URL(String(url));
    return `${u.origin}${u.pathname}`;
  } catch {
    return "<invalid url>";
  }
}

/**
 * fetch() with a timeout. HTTP_TIMEOUT_MS (env) overrides every timeout,
 * which keeps tests fast without touching production defaults.
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUTS.binance) {
  const ms = Number(process.env.HTTP_TIMEOUT_MS) || timeoutMs;
  try {
    return await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(ms) });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error(`Request timed out after ${ms}ms: ${safeUrl(url)}`);
    }
    throw err;
  }
}
