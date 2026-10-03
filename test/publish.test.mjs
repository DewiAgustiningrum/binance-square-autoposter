import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { publishPost } from "../src/publish.mjs";
import { useTempHistory } from "./helpers.mjs";

const realFetch = globalThis.fetch;
const TEXT = "$BTC held $84,750 today and volume stayed active through the whole session.";
let h;

beforeEach(async () => {
  process.env.BINANCE_SQUARE_OPENAPI_KEY = "test-key";
  h = await useTempHistory();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });

test("success: entry goes pending -> published with ids", async () => {
  globalThis.fetch = async () => jsonResponse({ code: "000000", data: { id: "123", shareLink: "https://x/123" } });
  const r = await publishPost({ theme: "daily-recap", text: TEXT });
  assert.equal(r.status, "published");
  const [e] = await h.read();
  assert.equal(e.status, "published");
  assert.equal(e.postId, "123");
});

test("pending entry exists BEFORE the network call returns", async () => {
  let seen;
  globalThis.fetch = async () => {
    seen = (await h.read())[0]?.status;
    return jsonResponse({ code: "000000", data: { id: "1", shareLink: "l" } });
  };
  await publishPost({ theme: "daily-recap", text: TEXT });
  assert.equal(seen, "pending");
});

test("504 is 'unknown', not a confirmed success", async () => {
  globalThis.fetch = async () => new Response("<html>Gateway Timeout</html>", { status: 504 });
  const r = await publishPost({ theme: "daily-recap", text: TEXT });
  assert.equal(r.status, "unknown");
  assert.equal(r.id, null);
  const [e] = await h.read();
  assert.equal(e.status, "unknown");
});

test("definitive API rejection is 'failed' and rethrown", async () => {
  globalThis.fetch = async () => jsonResponse({ code: "220095", message: "too many cashtags" });
  await assert.rejects(publishPost({ theme: "daily-recap", text: TEXT }), /API error \[220095\]/);
  assert.equal((await h.read())[0].status, "failed");
});

test("502 HTML page is 'unknown' (outcome can't be known) and rethrown", async () => {
  globalThis.fetch = async () => new Response("<html>Bad Gateway</html>", { status: 502 });
  const orig = console.error;
  console.error = () => {};
  try {
    await assert.rejects(publishPost({ theme: "daily-recap", text: TEXT }), /non-JSON/);
  } finally {
    console.error = orig;
  }
  assert.equal((await h.read())[0].status, "unknown");
});
