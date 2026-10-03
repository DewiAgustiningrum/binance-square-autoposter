import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchWithTimeout } from "../src/http.mjs";

test("a server that never responds is aborted, and the error hides the query string", async () => {
  const server = http.createServer(() => {}); // accepts, never answers
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const started = Date.now();
  try {
    await assert.rejects(
      fetchWithTimeout(`http://127.0.0.1:${port}/v1/x?key=SUPERSECRET`, {}, 300),
      (err) => {
        assert.match(err.message, /timed out after 300ms/);
        assert.doesNotMatch(err.message, /SUPERSECRET/);
        return true;
      }
    );
    assert.ok(Date.now() - started < 3000);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

test("normal responses pass through untouched", async () => {
  const server = http.createServer((_, res) => res.end("ok"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetchWithTimeout(`http://127.0.0.1:${server.address().port}/`, {}, 1000);
    assert.equal(await res.text(), "ok");
  } finally {
    server.close();
  }
});
